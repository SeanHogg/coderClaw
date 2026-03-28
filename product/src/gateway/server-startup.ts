import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import {
  getModelRefStatus,
  resolveConfiguredModelRef,
  resolveHooksGmailModel,
} from "../agents/model-selection.js";
import { resolveAgentSessionDirs } from "../agents/session-dirs.js";
import { cleanStaleLockFiles } from "../agents/session-write-lock.js";
import type { CliDeps } from "../cli/deps.js";
import { registerPlatformPersonasAsRoles } from "../coderclaw/agent-roles.js";
import { globalOrchestrator } from "../coderclaw/orchestrator.js";
import { loadProjectContext } from "../coderclaw/project-context.js";
import type { loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { startGmailWatcherWithLogs } from "../hooks/gmail-watcher-lifecycle.js";
import {
  clearInternalHooks,
  createInternalHookEvent,
  triggerInternalHook,
} from "../hooks/internal-hooks.js";
import { loadInternalHooks } from "../hooks/loader.js";
import { initApprovalGate } from "../infra/approval-gate.js";
import { syncCoderClawDirectoryOnStartup } from "../infra/builderforce-directory-sync.js";
import { BuilderforceRelayService } from "../infra/builderforce-relay.js";
import { CronPollerService } from "../infra/cron-poller.js";
import { readSharedEnvVar } from "../infra/env-file.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { KnowledgeLoopService, setKnowledgeLoopService } from "../infra/knowledge-loop.js";
import {
  LocalResultBrokerAdapter,
  RemoteAgentDispatcherAdapter,
  SsmMemoryAdapter,
  WorkflowTelemetryAdapter,
} from "../infra/orchestrator-ports-adapter.js";
import { fetchPlatformPersonas } from "../infra/platform-persona-sync.js";
import { pushProjectContextToBuilderforce } from "../infra/project-context-push.js";
import { checkAndWarnQuota } from "../infra/quota-monitor.js";
import { fetchAndLoadSkills } from "../infra/skill-registry.js";
import { initSsmMemoryService } from "../infra/ssm-memory-service.js";
import type { loadCoderClawPlugins } from "../plugins/loader.js";
import { type PluginServicesHandle, startPluginServices } from "../plugins/services.js";
import { startBrowserControlServerIfEnabled } from "./server-browser.js";
import {
  scheduleRestartSentinelWake,
  shouldWakeFromRestartSentinel,
} from "./server-restart-sentinel.js";
import { startGatewayMemoryBackend } from "./server-startup-memory.js";

const SESSION_LOCK_STALE_MS = 30 * 60 * 1000;

export async function startGatewaySidecars(params: {
  cfg: ReturnType<typeof loadConfig>;
  pluginRegistry: ReturnType<typeof loadCoderClawPlugins>;
  defaultWorkspaceDir: string;
  deps: CliDeps;
  startChannels: () => Promise<void>;
  log: { warn: (msg: string) => void };
  logHooks: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  logChannels: { info: (msg: string) => void; error: (msg: string) => void };
  logBrowser: { error: (msg: string) => void };
}) {
  try {
    const stateDir = resolveStateDir(process.env);
    const sessionDirs = await resolveAgentSessionDirs(stateDir);
    for (const sessionsDir of sessionDirs) {
      await cleanStaleLockFiles({
        sessionsDir,
        staleMs: SESSION_LOCK_STALE_MS,
        removeStale: true,
        log: { warn: (message) => params.log.warn(message) },
      });
    }
  } catch (err) {
    params.log.warn(`session lock cleanup failed on startup: ${String(err)}`);
  }

  // Enable workflow persistence — sets .coderClaw/ as the storage root and
  // re-hydrates any incomplete workflows that survived a prior crash/restart.
  // clawId is populated later (after credentials are loaded) via a second call.
  globalOrchestrator.setProjectRoot(params.defaultWorkspaceDir);
  // Wire domain ports early — telemetry and local result broker are always needed.
  globalOrchestrator.setTelemetryService(new WorkflowTelemetryAdapter());
  globalOrchestrator.setLocalResultBroker(new LocalResultBrokerAdapter());
  const incompleteWorkflows = await globalOrchestrator.loadPersistedWorkflows();
  if (incompleteWorkflows.length > 0) {
    params.log.warn(
      `[orchestrator] ${incompleteWorkflows.length} incomplete workflow(s) restored: ${incompleteWorkflows.join(", ")}`,
    );
  }

  // Start CoderClaw browser control server (unless disabled via config).
  let browserControl: Awaited<ReturnType<typeof startBrowserControlServerIfEnabled>> = null;
  try {
    browserControl = await startBrowserControlServerIfEnabled();
  } catch (err) {
    params.logBrowser.error(`server failed to start: ${String(err)}`);
  }

  // Start Gmail watcher if configured (hooks.gmail.account).
  await startGmailWatcherWithLogs({
    cfg: params.cfg,
    log: params.logHooks,
  });

  // Validate hooks.gmail.model if configured.
  if (params.cfg.hooks?.gmail?.model) {
    const hooksModelRef = resolveHooksGmailModel({
      cfg: params.cfg,
      defaultProvider: DEFAULT_PROVIDER,
    });
    if (hooksModelRef) {
      const { provider: defaultProvider, model: defaultModel } = resolveConfiguredModelRef({
        cfg: params.cfg,
        defaultProvider: DEFAULT_PROVIDER,
        defaultModel: DEFAULT_MODEL,
      });
      const catalog = await loadModelCatalog({ config: params.cfg });
      const status = getModelRefStatus({
        cfg: params.cfg,
        catalog,
        ref: hooksModelRef,
        defaultProvider,
        defaultModel,
      });
      if (!status.allowed) {
        params.logHooks.warn(
          `hooks.gmail.model "${status.key}" not in agents.defaults.models allowlist (will use primary instead)`,
        );
      }
      if (!status.inCatalog) {
        params.logHooks.warn(
          `hooks.gmail.model "${status.key}" not in the model catalog (may fail at runtime)`,
        );
      }
    }
  }

  // Load internal hook handlers from configuration and directory discovery.
  try {
    // Clear any previously registered hooks to ensure fresh loading
    clearInternalHooks();
    const loadedCount = await loadInternalHooks(params.cfg, params.defaultWorkspaceDir);
    if (loadedCount > 0) {
      params.logHooks.info(
        `loaded ${loadedCount} internal hook handler${loadedCount > 1 ? "s" : ""}`,
      );
    }
  } catch (err) {
    params.logHooks.error(`failed to load hooks: ${String(err)}`);
  }

  // Launch configured channels so gateway replies via the surface the message came from.
  // Tests can opt out via CODERCLAW_SKIP_CHANNELS (or legacy CODERCLAW_SKIP_PROVIDERS).
  const skipChannels =
    isTruthyEnvValue(process.env.CODERCLAW_SKIP_CHANNELS) ||
    isTruthyEnvValue(process.env.CODERCLAW_SKIP_PROVIDERS);
  if (!skipChannels) {
    try {
      await params.startChannels();
    } catch (err) {
      params.logChannels.error(`channel startup failed: ${String(err)}`);
    }
  } else {
    params.logChannels.info(
      "skipping channel start (CODERCLAW_SKIP_CHANNELS=1 or CODERCLAW_SKIP_PROVIDERS=1)",
    );
  }

  if (params.cfg.hooks?.internal?.enabled) {
    const hookEvent = createInternalHookEvent("gateway", "startup", "gateway:startup", {
      cfg: params.cfg,
      deps: params.deps,
      workspaceDir: params.defaultWorkspaceDir,
    });
    void triggerInternalHook(hookEvent);
  }

  let pluginServices: PluginServicesHandle | null = null;
  try {
    pluginServices = await startPluginServices({
      registry: params.pluginRegistry,
      config: params.cfg,
      workspaceDir: params.defaultWorkspaceDir,
    });
  } catch (err) {
    params.log.warn(`plugin services failed to start: ${String(err)}`);
  }

  void startGatewayMemoryBackend({ cfg: params.cfg, log: params.log }).catch((err) => {
    params.log.warn(`qmd memory startup initialization failed: ${String(err)}`);
  });

  // Initialise SSMjs hippocampus memory layer — non-fatal if unavailable.
  void initSsmMemoryService({
    checkpointPath: `${params.defaultWorkspaceDir}/.coderClaw/model.bin`,
    modelSize: "small",
  })
    .then((svc) => {
      if (svc) {
        params.log.warn(`[ssm-memory] hippocampus layer started (gpu=${svc.gpuAvailable})`);
        // Wire memory port now that the SSM service is initialised.
        globalOrchestrator.setMemoryService(new SsmMemoryAdapter());
      }
    })
    .catch((err) => {
      params.log.warn(`[ssm-memory] startup failed: ${String(err)}`);
    });

  if (shouldWakeFromRestartSentinel()) {
    void scheduleRestartSentinelWake({ deps: params.deps });
  }

  // Start the Builderforce upstream relay and knowledge loop if credentials are configured.
  // Both the upstream WS and local gateway bridge retry independently on failure.
  let builderforceRelay: BuilderforceRelayService | null = null;
  let knowledgeLoop: KnowledgeLoopService | null = null;
  try {
    const apiKey = readSharedEnvVar("BUILDERFORCE_API_KEY");
    const baseUrl = readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai";
    if (apiKey) {
      const ctx = await loadProjectContext(params.defaultWorkspaceDir);
      const clawId = ctx?.builderforce?.instanceId;
      const projectId = ctx?.builderforce?.projectId ? Number(ctx.builderforce.projectId) : undefined;

      if (clawId) {
        // Re-init telemetry now that the claw ID is known so all subsequent
        // workflow spans are tagged with this claw's identity and forwarded to Builderforce.ai.
        globalOrchestrator.setProjectRoot(
          params.defaultWorkspaceDir,
          String(clawId),
          baseUrl,
          apiKey,
        );

        // Approval gate: enables requestApproval() to POST to Builderforce and
        // await manager decisions delivered via the relay WebSocket.
        initApprovalGate({ baseUrl, clawId: String(clawId), apiKey });

        builderforceRelay = new BuilderforceRelayService({
          baseUrl,
          clawId: String(clawId),
          apiKey,
          workspaceDir: params.defaultWorkspaceDir,
        });
        builderforceRelay.start();
        params.log.warn(`[builderforce] relay started for claw ${clawId}`);

        // Wire the relay's remote dispatch options so result callbacks work.
        builderforceRelay.setRemoteDispatchOptions({ baseUrl, myClawId: String(clawId), apiKey });

        // Fetch platform personas and register them as available agent roles.
        void fetchPlatformPersonas({ baseUrl, clawId: String(clawId), apiKey }).then((personas) => {
          if (personas.length > 0) {
            params.log.warn(`[platform-personas] loaded ${personas.length} platform persona(s)`);
            registerPlatformPersonasAsRoles(personas);
          }
        });

        // Check token quota and warn if approaching limits.
        void checkAndWarnQuota({ baseUrl, clawId: String(clawId), apiKey });

        // Push project context (governance docs) to Builderforce — reuse ctx already loaded above.
        void (async () => {
          try {
            if (ctx?.builderforce?.projectId && ctx.description) {
              await pushProjectContextToBuilderforce(
                { baseUrl, clawId: String(clawId), apiKey },
                {
                  projectId: Number(ctx.builderforce.projectId),
                  governance: ctx.description,
                },
              );
            }
          } catch (err) {
            params.log.warn(`[project-context-push] failed: ${String(err)}`);
          }
        })();

        // Fetch assigned skills from the portal and populate the local registry.
        void fetchAndLoadSkills({ baseUrl, clawId: String(clawId), apiKey });

        // Start the cron poller: pulls scheduled jobs from Builderforce and
        // executes them locally according to their cron expressions.
        const cronPoller = new CronPollerService({ baseUrl, clawId: String(clawId), apiKey });
        void cronPoller.start();
        params.log.warn("[cron-poller] started");
        void syncCoderClawDirectoryOnStartup({
          workspaceDir: params.defaultWorkspaceDir,
          log: params.log,
        });
        // Enable remote claw-to-claw dispatch in the orchestrator via the port interface.
        globalOrchestrator.setRemoteDispatcher(
          new RemoteAgentDispatcherAdapter({ baseUrl, myClawId: String(clawId), apiKey }),
        );
        // Wire relay service for cross-claw context fetching (P4-2)
        if (builderforceRelay) {
          globalOrchestrator.setRelayService(builderforceRelay);
        }
      }

      // Knowledge loop runs whenever an API key is present; sync is skipped internally
      // when clawId is absent.
      knowledgeLoop = new KnowledgeLoopService({
        workspaceDir: params.defaultWorkspaceDir,
        apiKey,
        baseUrl,
        clawId: clawId ? String(clawId) : null,
        projectId,
      });
      knowledgeLoop.start();
      setKnowledgeLoopService(knowledgeLoop);
      params.log.warn("[knowledge-loop] started");
    } else {
      params.log.warn(
        "[builderforce] standalone mode — BUILDERFORCE_API_KEY not set; " +
          "Builderforce connection and claw-to-claw dispatch are disabled. " +
          "Set BUILDERFORCE_API_KEY in ~/.coderclaw/.env to enable them.",
      );
    }
  } catch (err) {
    params.log.warn(`[builderforce/knowledge-loop] startup failed: ${String(err)}`);
  }

  return { browserControl, pluginServices, builderforceRelay, knowledgeLoop };
}
