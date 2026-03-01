/**
 * claw_fleet tool — discover peer CoderClaw instances in the same tenant.
 *
 * Uses the claw-authenticated GET /api/claws/fleet endpoint so no user JWT is
 * needed. Returns each claw's ID, name, online status, and capabilities.
 *
 * Use the returned claw IDs with the "remote:<clawId>" workflow step role to
 * delegate tasks to specific peer claws.
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { readSharedEnvVar } from "../../infra/env-file.js";
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
});

type ClawFleetParams = {
  projectRoot: string;
  onlineOnly?: boolean;
};

type FleetEntry = {
  id: number;
  name: string;
  slug: string;
  online: boolean;
  connectedAt: string | null;
  lastSeenAt: string | null;
  capabilities: string[];
};

export const clawFleetTool: AgentTool<typeof ClawFleetSchema, string> = {
  name: "claw_fleet",
  label: "Claw Fleet",
  description:
    "List peer CoderClaw instances in the same tenant. Returns each claw's ID, name, connection status, and capabilities. Use the claw ID with 'remote:<clawId>' workflow step roles to delegate tasks to specific claws. Requires CODERCLAW_LINK_API_KEY and clawLink.instanceId to be configured.",
  parameters: ClawFleetSchema,
  async execute(_toolCallId: string, params: ClawFleetParams) {
    const { projectRoot, onlineOnly = false } = params;

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
      const fleet = onlineOnly ? data.fleet.filter((c) => c.online) : data.fleet;

      return jsonResult({
        ok: true,
        fleet,
        total: data.fleet.length,
        online: data.fleet.filter((c) => c.online).length,
        tip: "Use 'remote:<id>' as the agentRole in an orchestrate workflow step to delegate a task to a specific claw.",
      }) as AgentToolResult<string>;
    } catch (error) {
      return jsonResult({
        error: `Failed to query fleet: ${error instanceof Error ? error.message : String(error)}`,
      }) as AgentToolResult<string>;
    }
  },
};
