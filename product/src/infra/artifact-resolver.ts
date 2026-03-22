/**
 * ArtifactResolver — resolve effective artifact set for the current task context.
 *
 * Fetches from Builderforce the merged artifact hierarchy (task > project > claw > tenant)
 * and returns skills, personas, and content assigned at any level.
 */

import { logDebug } from "../logger.js";

export type ResolvedArtifact = {
  artifactType: "skill" | "persona" | "content";
  artifactSlug: string;
  scope: "tenant" | "claw" | "project" | "task";
  scopeId: number;
  config: string | null;
};

export type ResolvedArtifacts = {
  skills: ResolvedArtifact[];
  personas: ResolvedArtifact[];
  content: ResolvedArtifact[];
};

export type ArtifactResolveOptions = {
  baseUrl: string;
  clawId: string;
  apiKey: string;
};

/**
 * Resolve the effective artifact set for a claw + optional task/project context.
 * Returns empty sets if the endpoint is unavailable.
 */
export async function resolveTaskArtifacts(
  opts: ArtifactResolveOptions,
  context: { taskId?: number; projectId?: number },
): Promise<ResolvedArtifacts> {
  const empty: ResolvedArtifacts = { skills: [], personas: [], content: [] };
  const params = new URLSearchParams();
  if (context.taskId != null) {
    params.set("taskId", String(context.taskId));
  }
  if (context.projectId != null) {
    params.set("projectId", String(context.projectId));
  }
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/claws/${opts.clawId}/artifacts/resolve?${params}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logDebug(`[artifact-resolver] resolve failed: HTTP ${res.status}`);
      return empty;
    }
    const data = (await res.json()) as ResolvedArtifacts;
    return data;
  } catch (err) {
    logDebug(`[artifact-resolver] resolve error: ${String(err)}`);
    return empty;
  }
}
