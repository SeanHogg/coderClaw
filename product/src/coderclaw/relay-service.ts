/**
 * Abstraction over the upstream relay so domain code (AgentOrchestrator)
 * is not coupled to the concrete BuilderforceRelayService infrastructure class.
 */
export interface IRelayService {
  /** Fetch the remote context bundle for a peer claw into the local .coderClaw/remote-context/ dir. */
  fetchRemoteContext(targetClawId: string): Promise<void>;
}
