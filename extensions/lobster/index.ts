import type {
  AnyAgentTool,
  CoderClawPluginApi,
  CoderClawPluginToolFactory,
} from "../../src/plugins/types.js";
import { createLobsterTool } from "./src/lobster-tool.js";

export default function register(api: CoderClawPluginApi) {
  api.registerTool(
    ((ctx) => {
      if (ctx.sandboxed) {
        return null;
      }
      return createLobsterTool(api) as AnyAgentTool;
    }) as CoderClawPluginToolFactory,
    { optional: true },
  );
}
