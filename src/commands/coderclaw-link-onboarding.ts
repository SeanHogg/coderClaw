import { confirm, note, password, select, spinner, text } from "@clack/prompts";
import { loadProjectContext, updateProjectContextFields } from "../coderclaw/project-context.js";
import { readSharedEnvVar, upsertSharedEnvVar } from "../infra/env-file.js";

async function clawLinkFetch<T>(
  url: string,
  opts: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...rest } = opts;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(url, { ...rest, headers });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (body.error as string) ?? (body.message as string) ?? res.statusText;
    throw new Error(`${res.status} ${msg}`);
  }
  return body as T;
}

async function ensureProjectMapping(params: {
  serverUrl: string;
  tenantJwt: string;
  projectRoot: string;
  projectName: string;
  description?: string;
  clawId: string;
}): Promise<{ projectId: string; action: "created" | "updated" } | null> {
  try {
    const upsert = await clawLinkFetch<{
      action: "created" | "updated";
      project: { id: string; name: string };
    }>(`${params.serverUrl}/api/projects/upsert`, {
      method: "POST",
      token: params.tenantJwt,
      body: JSON.stringify({
        name: params.projectName,
        description: params.description ?? `Managed from ${params.projectRoot}`,
      }),
    });

    await clawLinkFetch(
      `${params.serverUrl}/api/claws/${params.clawId}/projects/${upsert.project.id}`,
      {
        method: "PUT",
        token: params.tenantJwt,
      },
    );

    return { projectId: upsert.project.id, action: upsert.action };
  } catch {
    return null;
  }
}

export async function promptCoderClawLinkOnboarding(params: {
  projectRoot: string;
  defaultInstanceName: string;
  forcePrompt?: boolean;
}): Promise<string | null> {
  const existingKey = readSharedEnvVar("CODERCLAW_LINK_API_KEY");
  if (existingKey) {
    const existingUrl = readSharedEnvVar("CODERCLAW_LINK_URL") ?? "https://api.coderclaw.ai";
    const existingTenantId = readSharedEnvVar("CODERCLAW_LINK_TENANT_ID");
    const existingCtx = await loadProjectContext(params.projectRoot).catch(() => null);
    const clawLabel =
      existingCtx?.clawLink?.instanceSlug ??
      existingCtx?.clawLink?.instanceName ??
      existingCtx?.clawLink?.instanceId ??
      "(registered)";
    note(
      [
        `URL:    ${existingUrl}`,
        `Tenant: ${existingTenantId ?? "unknown"}`,
        `Claw:   ${clawLabel}`,
        "",
        "Run 'coderclaw init --reconnect' to link a different account.",
      ].join("\n"),
      "Already connected to coderClawLink",
    );
    return `coderClawLink: already connected (${existingUrl})`;
  }

  if (!params.forcePrompt) {
    const skipped = readSharedEnvVar("CODERCLAW_LINK_SKIPPED");
    if (skipped === "1") {
      return null;
    }
  }

  const connect = await confirm({
    message:
      "Connect to coderClawLink? (optional — manage projects, tasks & agents across your mesh)",
    initialValue: true,
  });
  if (typeof connect === "symbol" || !connect) {
    upsertSharedEnvVar({ key: "CODERCLAW_LINK_SKIPPED", value: "1" });
    return null;
  }

  const urlInput = await text({
    message: "coderClawLink server URL:",
    initialValue: "https://api.coderclaw.ai",
  });
  if (typeof urlInput === "symbol") {
    return null;
  }
  const serverUrl = urlInput.trim().replace(/\/+$/, "") || "https://api.coderclaw.ai";

  const authMode = await select({
    message: "Do you have a coderClawLink account?",
    options: [
      { value: "login", label: "Yes — log in" },
      { value: "register", label: "No  — create a free account" },
    ],
  });
  if (typeof authMode === "symbol") {
    return null;
  }

  const emailInput = await text({ message: "Email:" });
  if (typeof emailInput === "symbol" || !emailInput.trim()) {
    return null;
  }
  const email = emailInput.trim();

  let usernameForReg = "";
  if (authMode === "register") {
    const usernameInput = await text({
      message: "Username:",
      initialValue: params.defaultInstanceName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    });
    if (typeof usernameInput === "symbol" || !usernameInput.trim()) {
      return null;
    }
    usernameForReg = usernameInput.trim();
  }

  const passwordInput = await password({ message: "Password:" });
  if (typeof passwordInput === "symbol" || !passwordInput.trim()) {
    return null;
  }
  const rawPassword = passwordInput.trim();

  let webToken = "";
  const authSpin = spinner();
  try {
    if (authMode === "register") {
      authSpin.start("Creating account…");
      const res = await clawLinkFetch<{ token: string }>(`${serverUrl}/api/auth/web/register`, {
        method: "POST",
        body: JSON.stringify({
          email,
          username: usernameForReg,
          password: rawPassword,
        }),
      });
      webToken = res.token;
      authSpin.stop("Account created");
    } else {
      authSpin.start("Authenticating…");
      const res = await clawLinkFetch<{ token: string }>(`${serverUrl}/api/auth/web/login`, {
        method: "POST",
        body: JSON.stringify({ email, password: rawPassword }),
      });
      webToken = res.token;
      authSpin.stop("Authenticated");
    }
  } catch (err) {
    authSpin.stop("Authentication failed");
    note(String(err instanceof Error ? err.message : err), "Error");
    return null;
  }

  let tenantId = 0;
  const tenantSpin = spinner();
  tenantSpin.start("Loading workspaces…");
  let tenants: Array<{ id: number; name: string; slug: string }> = [];
  try {
    const res = await clawLinkFetch<{ tenants: Array<{ id: number; name: string; slug: string }> }>(
      `${serverUrl}/api/auth/my-tenants`,
      { token: webToken },
    );
    tenants = res.tenants;
    tenantSpin.stop(`${tenants.length} workspace(s) found`);
  } catch (err) {
    tenantSpin.stop("Could not load workspaces");
    note(String(err instanceof Error ? err.message : err), "Error");
    return null;
  }

  if (tenants.length === 0) {
    const wsNameInput = await text({
      message: "Create your first workspace:",
      initialValue: params.defaultInstanceName,
    });
    if (typeof wsNameInput === "symbol" || !wsNameInput.trim()) {
      return null;
    }
    const wsSpin = spinner();
    wsSpin.start("Creating workspace…");
    try {
      const created = await clawLinkFetch<{ id: number; name: string }>(
        `${serverUrl}/api/tenants/create`,
        {
          method: "POST",
          token: webToken,
          body: JSON.stringify({ name: wsNameInput.trim() }),
        },
      );
      tenantId = created.id;
      wsSpin.stop(`Workspace "${created.name}" created`);
    } catch (err) {
      wsSpin.stop("Could not create workspace");
      note(String(err instanceof Error ? err.message : err), "Error");
      return null;
    }
  } else if (tenants.length === 1) {
    tenantId = tenants[0].id;
    note(`Using workspace: ${tenants[0].name}`, "Workspace");
  } else {
    const picked = await select({
      message: "Select workspace:",
      options: tenants.map((tenant) => ({
        value: tenant.id,
        label: tenant.name,
        hint: tenant.slug,
      })),
    });
    if (typeof picked === "symbol") {
      return null;
    }
    tenantId = picked;
  }

  let tenantJwt = "";
  try {
    const res = await clawLinkFetch<{ token: string }>(`${serverUrl}/api/auth/tenant-token`, {
      method: "POST",
      token: webToken,
      body: JSON.stringify({ tenantId }),
    });
    tenantJwt = res.token;
  } catch (err) {
    note(String(err instanceof Error ? err.message : err), "Could not get workspace token");
    return null;
  }

  const clawNameInput = await text({
    message: "Claw instance name (shown in dashboard):",
    initialValue: params.defaultInstanceName,
  });
  if (typeof clawNameInput === "symbol") {
    return null;
  }
  const clawName = clawNameInput.trim() || params.defaultInstanceName;

  const clawSpin = spinner();
  clawSpin.start("Registering claw instance…");
  let clawId = "";
  let clawSlug = "";
  let apiKey = "";
  let projectId = "";
  let projectAction: "created" | "updated" | "unknown" = "unknown";
  try {
    const res = await clawLinkFetch<{
      claw: { id: number; name: string; slug: string };
      apiKey: string;
    }>(`${serverUrl}/api/claws`, {
      method: "POST",
      token: tenantJwt,
      body: JSON.stringify({ name: clawName }),
    });
    clawId = String(res.claw.id);
    clawSlug = res.claw.slug;
    apiKey = res.apiKey;

    const mapped = await ensureProjectMapping({
      serverUrl,
      tenantJwt,
      clawId,
      projectRoot: params.projectRoot,
      projectName: params.defaultInstanceName,
      description: `coderClaw project at ${params.projectRoot}`,
    });
    if (mapped) {
      projectId = mapped.projectId;
      projectAction = mapped.action;
    }

    clawSpin.stop(`Claw "${res.claw.name}" registered`);
  } catch (err) {
    clawSpin.stop("Claw registration failed");
    note(String(err instanceof Error ? err.message : err), "Error");
    return null;
  }

  upsertSharedEnvVar({ key: "CODERCLAW_LINK_URL", value: serverUrl });
  upsertSharedEnvVar({ key: "CODERCLAW_LINK_WEB_TOKEN", value: webToken });
  upsertSharedEnvVar({ key: "CODERCLAW_LINK_TENANT_ID", value: String(tenantId) });
  upsertSharedEnvVar({ key: "CODERCLAW_LINK_API_KEY", value: apiKey });
  upsertSharedEnvVar({ key: "CODERCLAW_LINK_SKIPPED", value: "0" });

  try {
    await updateProjectContextFields(params.projectRoot, {
      clawLink: {
        instanceId: clawId,
        instanceSlug: clawSlug,
        instanceName: clawName,
        ...(projectId ? { projectId } : {}),
        tenantId,
        url: serverUrl,
      },
    });
  } catch {}

  note(
    [
      "Claw API key saved to ~/.coderclaw/.env",
      "This key was shown once — it is hashed on the server.",
      `Instance slug: ${clawSlug}  ·  tenant: ${tenantId}`,
      projectId ? `Project ${projectAction}: ${projectId}` : "Project mapping: not available",
    ].join("\n"),
    "coderClawLink connected",
  );

  return `coderClawLink: ${clawName} (${clawSlug}) on tenant ${tenantId}`;
}
