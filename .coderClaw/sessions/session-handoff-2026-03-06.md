# Session Handoff — 2026-03-06

**Branch:** `copilot/integrate-smollm2-1-7b`  
**PR:** [#36 — feat: CoderClawLLM local brain — SmolLM2 ONNX, .coderclaw memory, two-tier routing, tools, RAG](https://github.com/SeanHogg/coderClaw/pull/36)  
**Date:** 2026-03-05 → 2026-03-06 (EST)

---

## Summary

This session completed multiple phases of the SmolLM2 local brain integration and surrounding infrastructure. Key accomplishments: (1) diagnosed and fixed local brain not routing requests — `/localbrain on` now sets `agents.defaults.model.primary` to `coderclawllm-local/{amygdalaModelId}` so `resolveModel()` yields `api:"transformers"` and the brain pipeline activates; (2) fixed the exec host error message to show the _requested_ host rather than the configured one; (3) changed `tools.exec.host` default from `sandbox` to `gateway` across code (bash-tools.exec.ts, directive-handling.impl.ts, onboard-config.ts) and documentation (5 doc files in coderclaw.ai, EN + ZH); (4) added `[brain-routing]` logging in attempt.ts and coderclawllm-local-stream.ts; (5) fixed TUI message duplication by noting `user-${clientRunId}` variant in dedup guard; (6) fixed execution hang from missing path separator bug (`fixMissingRootSeparator()` in pi-tools.read.ts); (7) renamed `.coderClaw/` → `.coderclaw/` directory constant and all doc references. On the coderClawLink side: added unified artifact likes system (`artifact_likes` table, `marketplaceStatsRoutes.ts`), wired likes/installs into marketplace, personas, skills, and content views with real API stats.

---

## Decisions

1. **exec.host defaults to `gateway`** — CoderClaw is designed to let LLMs execute commands via skills, personas, and MCP. Sandbox requires Docker/Podman which most installs don't have. The old sandbox default was misleading since without a sandbox runtime it ran on gateway anyway.

2. **`/localbrain on` sets primary model** — The local brain provider (`coderclawllm-local`) must be the primary model for `resolveModel()` to yield `api:"transformers"`. The user's cloud model is demoted to first fallback (used as "cortex" for DELEGATE). `/localbrain off` reverses this.

3. **Error message shows requested host, not configured** — When exec host mismatch throws, the suggestion now says `configure tools.exec.host=<requested>` so the user knows what to set.

4. **`fixMissingRootSeparator()` for LLM path bugs** — LLMs sometimes emit `C:\code\project.coderclaw\file` instead of `C:\code\project\.coderclaw\file`. The fix inserts the missing separator at the tool param normalization layer.

5. **Unified artifact likes in coderClawLink** — Single `artifact_likes` table + `artifact_assignments` replaces per-type like tracking. Stats fetched via batch `GET /api/marketplace-stats/stats?type=skill&slugs=a,b,c`.

6. **`.coderClaw/` → `.coderclaw/`** — The project context directory constant (`CODERCLAW_DIR`) was renamed to lowercase for consistency. All planning docs updated to match.

---

## Next Steps

1. **Run full test suite** — Tests haven't been run after the exec host default change and path separator fix. Some tests may reference the old `"sandbox"` default. Run `pnpm vitest run --config vitest.unit.config.ts` and fix any failures.

2. **Verify local brain end-to-end** — Start the gateway, send a message through TUI, and confirm `[brain-routing]` logs show `api=transformers localBrain=enabled → amygdala/hippocampus pipeline`. Verify model download triggers if not cached.

3. **Run coderClawLink migration** — Migrations `0020_artifact_assignments.sql` and `0021_artifact_likes.sql` need to be applied to the database. Then verify the marketplace stats routes work end-to-end.

4. **Build verification** — Run `npm run build:windows` in coderClaw and `npx tsc --noEmit` in coderClawLink to confirm clean builds.

5. **PR description update** — PR #36 description should be updated to reflect the exec host default change, brain routing fix, and all the new coderClawLink marketplace features.

6. **Consider onboarding UX** — The onboarding flow now sets `tools.exec.host = "gateway"` explicitly. Verify this works for fresh installs by testing the onboarding wizard path.

---

## Open Questions

1. **Should `/localbrain off` fully remove the coderclawllm-local provider config?** — Currently it just sets `localBrain.enabled = false` and restores the primary model. The provider config entry remains in the config file.

2. **Are the ONNX model files actually cached?** — Could not verify whether SmolLM2-1.7B and Phi-4-mini ONNX files exist at `~/.coderclaw/models/`. First real request triggers lazy download.

3. **Flaky gateway-lock test** — One test (`gateway-lock`) has been intermittently failing across sessions. Needs investigation.

4. **coderClawLink build output** — The `index.html` diff shows only whitespace/formatting changes but the built assets reference specific hashes (`index-oL-O1KNO.js`, `index-nqgKTvWh.css`). Need to rebuild after the marketplace/stats changes.

---

## Artifacts

### coderClaw (branch: `copilot/integrate-smollm2-1-7b`)

**Modified:**

- `src/agents/bash-tools.exec.ts` — exec host default `sandbox` → `gateway`, error message fix
- `src/agents/coderclawllm-local-stream.ts` — `[brain-routing]` logging at cortex fallback and amygdala HANDLE/DELEGATE
- `src/agents/pi-embedded-runner/run/attempt.ts` — `[brain-routing]` logging at stream selection
- `src/agents/pi-tools.read.ts` — `fixMissingRootSeparator()` + wired into normalization/guard wrappers
- `src/agents/pi-tools.ts` — pass `workspaceRoot` to read/write/edit tool wrappers
- `src/agents/pi-tools.param-normalization.test.ts` — tests for `fixMissingRootSeparator()`
- `src/auto-reply/reply/directive-handling.impl.ts` — exec host default `sandbox` → `gateway`
- `src/coderclaw/project-context.ts` — `CODERCLAW_DIR` → `.coderclaw`
- `src/commands/onboard-config.ts` — explicit `host: "gateway"` in onboarding config
- `src/infra/knowledge-loop.ts` — doc comment update `.coderClaw/` → `.coderclaw/`
- `src/tui/tui-command-handlers.ts` — `/localbrain on` sets primary model, `/localbrain off` restores, TUI dedup fix
- `.coderClaw/planning/ROADMAP.md` — path references updated
- `.coderClaw/planning/CAPABILITY_GAPS.md` — path references updated
- `.coderClaw/planning/CODERCLAW_LINK_GAPS.md` — path references updated
- `.coderClaw/planning/CRON.md` — path references updated
- `.coderClaw/planning/REMINDERS.md` — path references updated

**Created:**

- `.coderClaw/sessions/92fd1b7d-cc32-4825-acb7-787899c3171a.yaml` — session handoff from brain trace
- `.coderClaw/memory/2026-03-06-0059.md` — memory entry
- `.coderClaw/memory/2026-03-06-provider-error-heartbeat.md` — memory entry

### coderclaw.ai (branch: `main`)

**Modified:**

- `docs-site/src/content/docs/tools/exec.md` — default `sandbox` → `gateway`, updated Important note
- `docs-site/src/content/docs/zh-cn/tools/exec.md` — same (Chinese)
- `docs-site/src/content/docs/gateway/security/index.md` — sandboxing note rewritten for gateway default
- `docs-site/src/content/docs/zh-cn/gateway/security/index.md` — same (Chinese)
- `docs-site/src/content/docs/zh-cn/refactor/exec-host.md` — default security updated

### coderClawLink (branch: `main`)

**Modified:**

- `api/src/index.ts` — added `marketplaceStatsRoutes`
- `api/src/infrastructure/database/schema.ts` — added `artifactLikes` table
- `api/src/presentation/routes/marketplaceStatsRoutes.ts` — **created** — batch stats + toggle like
- `api/migrations/0020_artifact_assignments.sql` — **created** — unified assignments table
- `api/migrations/0021_artifact_likes.sql` — **created** — unified likes table
- `app/src/api.ts` — added `marketplaceStats` client + `ArtifactStats` type
- `app/src/views/marketplace.ts` — real likes/installs, install/uninstall buttons, sticky search
- `app/src/views/personas.ts` — 3-tab layout (assigned/marketplace/my-personas), create form, real stats
- `app/src/views/skills.ts` — real stats, install/uninstall via artifact assignments, tags support
- `app/src/views/content.ts` — like buttons, stats, sticky filters, artifact-assigner integration
- `app/static/index.html` — whitespace normalization
