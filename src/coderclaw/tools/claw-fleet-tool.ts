/**
 * claw_fleet tool — discover peer CoderClaw instances in the same tenant.
 *
 * Uses the claw-authenticated GET /api/claws/fleet endpoint so no user JWT is
 * needed. Returns each claw's ID, name, online status, and capabilities.
 *
 * Use the returned claw IDs with the "remote:<clawId>" workflow step role to
 * delegate tasks to specific peer claws. Use "remote:auto" to let the
 * orchestrator automatically select the best available online claw, or
 * "remote:auto[cap1,cap2]" to require specific capabilities.
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { readSharedEnvVar } from "../../infra/env-file.js";
import type { FleetEntry } from "../../infra/remote-subagent.js";
import { loadProjectContext } from "../project-context.js";

const ClawFleetSchema = Type.Object({
  projectRoot: Type.String({
    description: "Absolute path to the workspace root",
  }),
  onlineOnly: Type.Optional(
    Type.Boolean({
      description: "If true, return only currently connected (online) claws. Default: false.",
    }),
  ),
  requireCapabilities: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Filter to claws that have all listed capabilities. Example: ['gpu', 'high-memory'].",
    }),
  ),
});

type ClawFleetParams = {
  projectRoot: string;
  onlineOnly?: boolean;
  requireCapabilities?: string[];
};

export const clawFleetTool: AgentTool<typeof ClawFleetSchema, string> = {
  name: "claw_fleet",
  label: "Claw Fleet",
  description:
    "List peer CoderClaw instances in the same tenant. Returns each claw's ID, name, connection status, and capabilities. Use the claw ID with 'remote:<clawId>' to delegate tasks, 'remote:auto' to auto-select the best online claw, or 'remote:auto[cap1,cap2]' to require specific capabilities. Requires CODERCLAW_LINK_API_KEY and clawLink.instanceId to be configured.",
  parameters: ClawFleetSchema,
  async execute(_toolCallId: string, params: ClawFleetParams) {
    const { projectRoot, onlineOnly = false, requireCapabilities } = params;

    try {
      const apiKey = readSharedEnvVar("CODERCLAW_LINK_API_KEY");
      const baseUrl = readSharedEnvVar("CODERCLAW_LINK_URL") ?? "https://api.coderclaw.ai";

      if (!apiKey) {
        return jsonResult({
          ok: false,
          error:
            "CODERCLAW_LINK_API_KEY not configured. Set it in ~/.coderclaw/.env to enable fleet discovery.",
        }) as AgentToolResult<string>;
      }

      const ctx = await loadProjectContext(projectRoot);
      const clawId = ctx?.clawLink?.instanceId;

      if (!clawId) {
        return jsonResult({
          ok: false,
          error:
            "clawLink.instanceId not found in .coderClaw/context.yaml. Run 'coderclaw init' and register this claw first.",
        }) as AgentToolResult<string>;
      }

      const url = `${baseUrl.replace(/\/$/, "")}/api/claws/fleet?from=${clawId}&key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });

      if (!res.ok) {
        const body = await res.text();
        return jsonResult({
          ok: false,
          error: `Fleet API error ${res.status}: ${body}`,
        }) as AgentToolResult<string>;
      }

      const data = (await res.json()) as { fleet: FleetEntry[] };
      let fleet = onlineOnly ? data.fleet.filter((c) => c.online) : data.fleet;

      // Apply capability filter if requested
      if (requireCapabilities && requireCapabilities.length > 0) {
        fleet = fleet.filter((c) =>
          requireCapabilities.every((cap) => c.capabilities.includes(cap)),
        );
      }

      const autoTip =
        requireCapabilities && requireCapabilities.length > 0
          ? `Use 'remote:auto[${requireCapabilities.join(",")}]' to auto-select a claw with these capabilities.`
          : "Use 'remote:<id>' or 'remote:auto' as the agentRole in an orchestrate workflow step.";

      return jsonResult({
        ok: true,
        fleet,
        total: data.fleet.length,
        online: data.fleet.filter((c) => c.online).length,
        filtered: fleet.length,
        tip: autoTip,
      }) as AgentToolResult<string>;
    } catch (error) {
      return jsonResult({
        error: `Failed to query fleet: ${error instanceof Error ? error.message : String(error)}`,
      }) as AgentToolResult<string>;
    }
  },
};
