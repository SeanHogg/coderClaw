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
import { syncCoderClawDirectoryOnStartup } from "../infra/clawlink-directory-sync.js";
import { ClawLinkRelayService } from "../infra/clawlink-relay.js";
import { readSharedEnvVar } from "../infra/env-file.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { KnowledgeLoopService } from "../infra/knowledge-loop.js";
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
  globalOrchestrator.setProjectRoot(params.defaultWorkspaceDir);
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
    setTimeout(() => {
      const hookEvent = createInternalHookEvent("gateway", "startup", "gateway:startup", {
        cfg: params.cfg,
        deps: params.deps,
        workspaceDir: params.defaultWorkspaceDir,
      });
      void triggerInternalHook(hookEvent);
    }, 250);
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

  if (shouldWakeFromRestartSentinel()) {
    setTimeout(() => {
      void scheduleRestartSentinelWake({ deps: params.deps });
    }, 750);
  }

  // Start the ClawLink upstream relay and knowledge loop if credentials are configured.
  // Both the upstream WS and local gateway bridge retry independently on failure.
  let clawLinkRelay: ClawLinkRelayService | null = null;
  let knowledgeLoop: KnowledgeLoopService | null = null;
  try {
    const apiKey = readSharedEnvVar("CODERCLAW_LINK_API_KEY");
    const baseUrl = readSharedEnvVar("CODERCLAW_LINK_URL") ?? "https://api.coderclaw.ai";
    if (apiKey) {
      const ctx = await loadProjectContext(params.defaultWorkspaceDir);
      const clawId = ctx?.clawLink?.instanceId;
      const projectId = ctx?.clawLink?.projectId ? Number(ctx.clawLink.projectId) : undefined;

      if (clawId) {
        clawLinkRelay = new ClawLinkRelayService({ baseUrl, clawId: String(clawId), apiKey });
        clawLinkRelay.start();
        params.log.warn(`[clawlink] relay started for claw ${clawId}`);
        void syncCoderClawDirectoryOnStartup({
          workspaceDir: params.defaultWorkspaceDir,
          log: params.log,
        });
        // Enable remote claw-to-claw dispatch in the orchestrator
        globalOrchestrator.setRemoteDispatchOptions({
          baseUrl,
          myClawId: String(clawId),
          apiKey,
        });
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
      params.log.warn("[knowledge-loop] started");
    }
  } catch (err) {
    params.log.warn(`[clawlink/knowledge-loop] startup failed: ${String(err)}`);
  }

  return { browserControl, pluginServices, clawLinkRelay, knowledgeLoop };
}
