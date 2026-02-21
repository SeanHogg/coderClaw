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
    gateway: {
      ...baseConfig.gateway,
      mode: "local",
    },
  };
}
