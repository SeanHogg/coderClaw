# CoderClaw CI/CD Platform Consolidation Review (2026-02-22)

## Current CI/CD Platform Footprint

### Consolidation status

- ✅ Phase 1 started: unified release workflow added at `.github/workflows/release.yml`.
- ✅ Legacy split release workflows removed:
  - `.github/workflows/npm-release.yml`
  - `.github/workflows/docker-release.yml`
- ✅ Phase 2 completed: smoke/sanity workflows merged into `.github/workflows/ci.yml` and removed as standalone files:
  - `.github/workflows/install-smoke.yml`
  - `.github/workflows/sandbox-common-smoke.yml`
  - `.github/workflows/workflow-sanity.yml`
- ✅ Community ops consolidated: auto-response merged into `.github/workflows/labeler.yml` (renamed workflow to **Community Ops**) and `.github/workflows/auto-response.yml` removed.
- ✅ Current workflow count in this repo: **4** (`ci`, `release`, `community-ops`, `stale`).

### CI/automation orchestrator

- **GitHub Actions** is the central orchestrator for all build, test, release, and repo automation.
- Workflows currently split across:
  - `ci.yml` (core multi-OS/test matrix)
  - `install-smoke.yml`
  - `sandbox-common-smoke.yml`
  - `npm-release.yml`
  - `docker-release.yml`
  - `workflow-sanity.yml`
  - `stale.yml`, `labeler.yml`, `auto-response.yml` (repo ops)

### Package and container distribution

- **npm registry** via `release.yml`
- **GitHub Container Registry (GHCR)** via `release.yml`

### Runtime/deployment targets

- **Docker Compose** local/self-hosted deployment (`docker-compose.yml`)
- **Podman** optional self-hosted setup scripts (`setup-podman.sh` and related docs/changelog references)
- Managed runtime platform configs (`fly*.toml`, `render.yaml`) were removed from this repo during consolidation.

### Documentation hosting

- Documentation has moved to a separate project directory: **`coderclaw.io/`**.
- Docs hosting and docs CI/CD are now out of scope for this repository’s CI/CD consolidation.

## Consolidation Opportunities

1. **Release workflow split**
   - `npm-release.yml` and `docker-release.yml` duplicate release trigger logic and build setup.
   - Both execute on `main` and tags, increasing release complexity and runner minutes.

2. **Smoke workflow split**
   - `install-smoke.yml` and `sandbox-common-smoke.yml` are separate workflows that could run as jobs under `ci.yml` with path filters.

3. **Release workflow split (resolved)**

- Consolidated into `.github/workflows/release.yml`.
- No separate npm/docker release workflow files remain.

4. **Self-hosted runner use for non-build automation**
   - `stale.yml`, `labeler.yml`, `auto-response.yml` run on self-hosted runners.
   - These are not build/deploy blockers but increase operational platform dependencies.

## Recommended Target Platform Set (Smaller, Pragmatic)

Keep:

1. **GitHub Actions** as the only CI/CD orchestrator.
2. **npm** for package distribution.
3. **GHCR** for container distribution.
4. **Docker Compose / Podman** as self-hosted runtime options.

Note: docs platform ownership is in `coderclaw.io/`; this repo should only keep references, not docs deployment automation.

Removed from this repo:

- **Fly.io** (`fly.toml`, `fly.private.toml`)
- **Render** (`render.yaml`)

## Proposed Workflow Topology After Consolidation

### Keep as core

- `ci.yml`
  - Include current test matrix and checks.
  - Absorb install/sandbox smoke jobs with existing path/doc filters.

- `release.yml` (new unified file)
  - Build once.
  - Publish npm package and GHCR image in coordinated jobs.
  - Prefer tag-driven production release; optional main-branch prerelease behavior if needed.

### Keep as repository operations (non-CD)

- `labeler.yml`
- `auto-response.yml`
- `stale.yml`
- `workflow-sanity.yml`

## Migration Plan (Low Risk)

### Phase 1: Standardize release triggers

- ✅ Created unified `release.yml` combining npm + docker release logic.
- ✅ Removed old split release workflows.
- Next hardening option: limit production publish to tags (`v*`) only if you want stricter release gating.

### Phase 2: Merge smoke checks into CI

- Move jobs from `install-smoke.yml` and `sandbox-common-smoke.yml` into `ci.yml` as conditional jobs.
- Remove standalone smoke workflows once green for at least 1 week.

### Phase 3: Cloud target reduction

- Keep docs-hosting ownership in `coderclaw.io/` and remove docs deployment assumptions from this repo.
- Keep this repo runtime guidance focused on self-hosted Docker/Podman.
- Update operator guides in this repo to point to: `coderclaw.io` docs + self-hosted Docker/Podman.

### Phase 4: Self-hosted runner dependency trim (optional)

- Evaluate moving repo-ops workflows (`stale`, `labeler`, `auto-response`) to GitHub-hosted runners if secrets/token model permits.
- If not, leave as-is; this step is optional and separate from CI/CD consolidation.

## Immediate Action Checklist

1. Approve target set: **GitHub Actions + npm + GHCR + self-hosted Docker/Podman**.
2. Implement unified release workflow and dry-run on a prerelease tag.
3. Fold smoke workflows into `ci.yml`.
4. Remove stale docs/references that still mention Fly/Render deployment config in this repo.
5. Monitor one full release cycle for `release.yml` reliability.

## Risks and Mitigations

- **Risk:** Some users still expect Fly/Render config files in this repo.
  - **Mitigation:** announce removal in changelog and direct users to current deployment guidance.

- **Risk:** Unified release workflow blast radius.
  - **Mitigation:** Gate publish jobs with explicit conditions and required secrets checks.

- **Risk:** CI runtime increase when smoke jobs move into `ci.yml`.
  - **Mitigation:** Keep path-based conditional execution and docs-only short-circuiting.
