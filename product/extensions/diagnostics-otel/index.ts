import type { CoderClawPluginApi } from "@seanhogg/coderclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "@seanhogg/coderclaw/plugin-sdk";
import { createDiagnosticsOtelService } from "./src/service.js";

const plugin = {
  id: "diagnostics-otel",
  name: "Diagnostics OpenTelemetry",
  description: "Export diagnostics events to OpenTelemetry",
  configSchema: emptyPluginConfigSchema(),
  register(api: CoderClawPluginApi) {
    api.registerService(createDiagnosticsOtelService());
  },
};

export default plugin;
