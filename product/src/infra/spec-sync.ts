/**
 * SpecSync — fetch assigned specs and push new specs to Builderforce.ai.
 */

import { logDebug, logWarn } from "../logger.js";

export type AssignedSpec = {
  id: string;
  goal: string;
  status: string;
  prd: string | null;
  archSpec: string | null;
  taskList: string | null;
  projectId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type SpecSyncOptions = {
  baseUrl: string;
  clawId: string;
  apiKey: string;
};

/**
 * Fetch the active spec assigned to this claw's primary project.
 * Returns null if no spec is found or the endpoint is unavailable.
 */
export async function fetchAssignedSpec(opts: SpecSyncOptions): Promise<AssignedSpec | null> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/claws/${opts.clawId}/spec`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      logDebug(`[spec-sync] fetch failed: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { spec: AssignedSpec | null };
    return data.spec ?? null;
  } catch (err) {
    logDebug(`[spec-sync] fetch error: ${String(err)}`);
    return null;
  }
}

/**
 * Push a spec (PRD / arch spec / task list) to Builderforce.
 * Used by the /spec command to persist the generated spec in the cloud.
 */
export async function pushSpec(
  opts: SpecSyncOptions,
  spec: {
    id?: string;
    projectId?: number;
    goal: string;
    status?: "draft" | "reviewed" | "approved" | "in_progress" | "done";
    prd?: string;
    archSpec?: string;
    taskList?: unknown;
  },
): Promise<AssignedSpec | null> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/specs`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
        "X-Claw-From": opts.clawId,
      },
      body: JSON.stringify({ ...spec, clawId: Number(opts.clawId) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logWarn(`[spec-sync] push failed: HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as AssignedSpec;
  } catch (err) {
    logWarn(`[spec-sync] push error: ${String(err)}`);
    return null;
  }
}
