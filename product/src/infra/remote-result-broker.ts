/**
 * RemoteResultBroker — resolves pending remote dispatch callbacks.
 *
 * When the orchestrator dispatches a task to a remote claw, it registers a
 * pending callback keyed by correlationId. When the remote claw sends the
 * result back (via remote.task.result relay message), the relay calls
 * resolveRemoteResult() to unblock the waiting orchestrator task.
 */

type PendingCallback = {
  resolve: (result: string) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, PendingCallback>();

/**
 * Wait up to timeoutMs for a result keyed by correlationId.
 * Rejects with a timeout error if no result arrives in time.
 */
export function awaitRemoteResult(correlationId: string, timeoutMs = 300_000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      pending.delete(correlationId);
      reject(
        new Error(
          `Remote task timed out after ${timeoutMs / 1000}s (correlationId=${correlationId})`,
        ),
      );
    }, timeoutMs);
    pending.set(correlationId, { resolve, reject, timeoutHandle });
  });
}

/**
 * Resolve a pending remote result. Called by the relay when remote.task.result arrives.
 */
export function resolveRemoteResult(correlationId: string, result: string): boolean {
  const cb = pending.get(correlationId);
  if (!cb) {
    return false;
  }
  clearTimeout(cb.timeoutHandle);
  pending.delete(correlationId);
  cb.resolve(result);
  return true;
}

/** How many pending callbacks are waiting. */
export function pendingRemoteCount(): number {
  return pending.size;
}
