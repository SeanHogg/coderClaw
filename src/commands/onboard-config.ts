import type { CoderClawConfig } from "../config/config.js";

export function applyOnboardingLocalWorkspaceConfig(
  baseConfig: CoderClawConfig,
  workspaceDir: string,
): CoderClawConfig {
  return {
    ...baseConfig,
    agents: {
      ...baseConfig.agents,
      defaults: {
        ...baseConfig.agents?.defaults,
        workspace: workspaceDir,
      },
    },
    tools: {
      ...baseConfig.tools,
      exec: {
        ...baseConfig.tools?.exec,
        // Default to gateway execution — CoderClaw is designed to let LLMs
        // run commands.  Sandbox requires Docker/Podman which most installs
        // don't have configured out of the box.
        host: baseConfig.tools?.exec?.host ?? "gateway",
      },
    },
    gateway: {
      ...baseConfig.gateway,
      mode: "local",
    },
  };
}
