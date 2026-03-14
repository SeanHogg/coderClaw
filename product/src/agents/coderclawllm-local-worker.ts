import { parentPort } from "node:worker_threads";
import {
  runCoderClawLlmLocalRequest,
  type CoderClawLlmLocalRunRequest,
} from "./coderclawllm-local-stream.js";

type WorkerRunMessage = {
  type: "run";
  id: string;
  request: CoderClawLlmLocalRunRequest;
};

if (!parentPort) {
  throw new Error("Local brain worker started without a parent port");
}

let queue = Promise.resolve();

parentPort.on("message", (message: WorkerRunMessage) => {
  if (!message || message.type !== "run" || !message.id) {
    return;
  }

  queue = queue
    .catch(() => undefined)
    .then(async () => {
      try {
        const finalText = await runCoderClawLlmLocalRequest(message.request);
        parentPort?.postMessage({ type: "result", id: message.id, finalText });
      } catch (error) {
        parentPort?.postMessage({
          type: "error",
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
});
