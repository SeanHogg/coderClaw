/**
 * RemoteResultBroker — resolves pending remote dispatch callbacks.
 *
 * When the orchestrator dispatches a task to a remote claw, it registers a
 * pending callback keyed by correlationId. When the remote claw sends the
 * result back (via remote.task.result relay message), the relay calls
 * resolveRemoteResult() to unblock the waiting orchestrator task.
 *
 * P4-3: Adds backpressure — when more than maxConcurrentRemote pending tasks
 * exist, new awaits are queued (FIFO) until a slot becomes available.
 */

type PendingCallback = {
  resolve: (result: string) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, PendingCallback>();

// ── Backpressure queue (P4-3) ────────────────────────────────────────────────

/** Queue of resolve-callbacks waiting for a dispatch slot. */
const waitQueue: Array<() => void> = [];

/** Maximum number of simultaneously active remote result awaits. Configurable via setMaxConcurrentRemote(). */
let maxConcurrentRemote = 5;

/** Update the maximum concurrent remote task limit. */
export function setMaxConcurrentRemote(max: number): void {
  maxConcurrentRemote = Math.max(1, max);
}

/**
 * Acquire a dispatch slot, waiting in a FIFO queue if the concurrency limit
 * has been reached.  Must be paired with a releaseSlot() call.
 */
async function acquireSlot(): Promise<void> {
  if (pending.size < maxConcurrentRemote) {
    return; // slot available immediately
  }
  // Wait until a slot opens
  await new Promise<void>((resolve) => {
    waitQueue.push(resolve);
  });
}

/** Release a dispatch slot, unblocking the next waiter if any. */
function releaseSlot(): void {
  const next = waitQueue.shift();
  if (next) {
    next();
  }
}

/**
 * Wait up to timeoutMs for a result keyed by correlationId.
 * Rejects with a timeout error if no result arrives in time.
 *
 * If the number of in-flight remote tasks already equals maxConcurrentRemote,
 * this call blocks (FIFO queue) until a slot opens.
 */
export async function awaitRemoteResult(
  correlationId: string,
  timeoutMs = 300_000,
): Promise<string> {
  await acquireSlot();

  return new Promise<string>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      pending.delete(correlationId);
      releaseSlot();
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
  releaseSlot();
  cb.resolve(result);
  return true;
}

/** How many pending callbacks are waiting. */
export function pendingRemoteCount(): number {
  return pending.size;
}
