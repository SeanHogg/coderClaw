# Local Claw Registration Analysis Mirror

This local mirror exists to avoid `../` path resolution failures in automated tool reads.

Canonical source: workspace-root CLAW_REGISTRATION_ANALYSIS.md
Last synced: 2026-02-28

## Key conclusions
- Registration flow works end-to-end (`coderclaw init` -> login -> tenant -> claw registration -> key persisted).
- `CODERCLAW_LINK_API_KEY` is saved in shared env (`~/.coderclaw/.env`).
- Common integration gaps are transport alignment and upstream WS wiring, not registration itself.

## Related runtime/auth notes
- Provider `coderclawllm` auth can resolve from shared env key `CODERCLAW_LINK_API_KEY`.
- Model checks should use unified auth resolution (profiles + env + shared env) to avoid false "No auth configured" warnings.
