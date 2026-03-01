# Local Claw Registration Analysis Mirror

This local mirror exists to avoid `../` path resolution failures in automated tool reads.

Canonical source: workspace-root CLAW_REGISTRATION_ANALYSIS.md
Last synced: 2026-03-01 (session timeline update)

## Key conclusions

- Registration flow works end-to-end (`coderclaw init` -> login -> tenant -> claw registration -> key persisted).
- `CODERCLAW_LINK_API_KEY` is saved in shared env (`~/.coderclaw/.env`).
- Upstream relay is implemented (`ClawLinkRelayService`) and keeps claw connection/heartbeat live.
- `ClawLinkTransportAdapter` is aligned to live runtime execution routes (`/api/runtime/executions*`) and uses authenticated discovery routes (`/api/agents`, `/api/skills`).
- Session execution visibility is now implemented: executions persist `sessionId` and runtime API supports `GET /api/runtime/executions?sessionId=<id>` and `GET /api/runtime/sessions/:sessionId/executions`.
- Remaining registration-adjacent gaps are now: claw domain modeling and claw-scoped effective skill sync.

## Related runtime/auth notes

- Provider `coderclawllm` auth can resolve from shared env key `CODERCLAW_LINK_API_KEY`.
- Model checks should use unified auth resolution (profiles + env + shared env) to avoid false "No auth configured" warnings.
