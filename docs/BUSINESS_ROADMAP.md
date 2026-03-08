# CoderClaw Business Roadmap

> Last updated: 2026-03-04  
> Scope: Monetization strategy, go-to-market, and milestone plan

---

## 1. Market Opportunity

The AI developer tools market is growing rapidly. Key segments:

| Segment                     | TAM estimate  | Current leaders                  |
| --------------------------- | ------------- | -------------------------------- |
| IDE AI assistants           | $3B+ (2025)   | GitHub Copilot, Cursor, Windsurf |
| Autonomous coding agents    | $800M+ (2025) | Devin, SWE-agent, OpenHands      |
| CI/CD AI review             | $500M+ (2025) | CodeRabbit, Ellipsis             |
| Enterprise AI orchestration | $2B+ (2026)   | Devin, custom                    |

**CoderClaw's differentiated position**: The only open-source, self-hosted, multi-agent coding orchestration platform that works across all messaging channels and any model provider.

---

## 2. Business Model

### 2.1 Free Tier (Community / Open Source)

- **Product**: Self-hosted CoderClaw gateway (MIT licensed, always free)
- **Target**: Individual developers, open-source projects
- **Includes**: All 7 agent roles, local workflows, basic memory, 53 skills, all channels
- **Limits**: Local execution only, no Builderforce portal, community support only
- **Goal**: Maximum adoption, community contributions, brand recognition

### 2.2 Builderforce Pro (SaaS Subscription)

- **Product**: Builderforce cloud portal (builderforce.ai)
- **Target**: Individual developers and small teams (2–20 developers)
- **Pricing model**: Per-seat/month subscription

| Plan          | Price           | Features                                                                                 |
| ------------- | --------------- | ---------------------------------------------------------------------------------------- |
| **Developer** | $19/month       | 1 claw, workflow portal, spec storage, memory timeline, 100K tokens/day via coderClawLLM |
| **Team**      | $49/user/month  | Unlimited claws, fleet management, shared personas, PR review bot, 1M tokens/day         |
| **Business**  | $149/user/month | RBAC, audit trail, SSO, SLA, dedicated support, unlimited tokens                         |

- **Key features unlocked by Pro**:
  - Live workflow DAG visualization
  - Spec review + approval portal
  - Fleet capability management dashboard
  - Agent run audit trail (tool-level logging)
  - Context window token usage dashboard
  - Cross-claw memory sharing
  - Approval workflows for destructive actions
  - PR review GitHub App integration

### 2.3 coderClawLLM (AI Compute API)

- **Product**: OpenAI-compatible API at `api.builderforce.ai/llm/v1`
- **Target**: Developers who want managed model access without vendor accounts
- **Model**: Pay-per-token (usage-based)

| Pool          | Pricing                 | Features                                |
| ------------- | ----------------------- | --------------------------------------- |
| **Free pool** | Free (rate-limited)     | Shared capacity, community models       |
| **Pro pool**  | $0.002–$0.015/1K tokens | Claude Sonnet/Opus, GPT-4o, Gemini Pro  |
| **GPU pool**  | Custom pricing          | Dedicated GPU for local model inference |

- **Revenue share**: 20% margin on model API pass-through
- **Strategic value**: Removes the barrier of obtaining 10+ API keys; one credential for everything

### 2.4 Enterprise License

- **Product**: Self-hosted Builderforce (Docker/Kubernetes)
- **Target**: Enterprises with data residency requirements (HIPAA, SOC 2, FedRAMP-adjacent)
- **Pricing**: Annual contract, starts at $50K/year
- **Includes**:
  - On-premises Builderforce deployment
  - Dedicated Postgres/Cloudflare Workers deployment kit
  - SLA with 99.9% uptime guarantee
  - Dedicated support channel (Slack)
  - Custom RBAC and SSO integration
  - Air-gapped model support (Ollama/vLLM)
  - Compliance documentation

### 2.5 CoderClaw Marketplace (ClawHub)

- **Product**: Skill and agent marketplace at `clawhub.ai`
- **Target**: Skill developers, enterprise customers
- **Revenue model**:
  - Free community skills: listed for free
  - Paid skills: 30% revenue share on skill purchases
  - Enterprise skill bundles: curated packs for frameworks (e.g., "React Native Pack", "AWS Pack")
- **Timeline**: Q3 2026

---

## 3. Go-to-Market Strategy

### Phase 1: Community Growth (Now → Q2 2026)

**Goal**: 10,000 GitHub stars, 1,000 Discord members, 500 active daily users

**Actions**:

1. Submit to Hacker News "Show HN" with a live demo video showing multi-agent workflow
2. Post workflow demos on YouTube (feature dev, bug fix, adversarial review)
3. Create "CoderClaw vs. Cursor" and "CoderClaw vs. Aider" comparison blog posts
4. Engage Aider, Goose, Continue.dev communities with integration guides
5. Launch Discord community with #showcase channel for user demos
6. Produce screencasts for each workflow type (planning, feature, bugfix, refactor)

**Key messages**:

- "Run AI agents on your own machine. No cloud, no subscriptions, no IDE tether."
- "7 specialized agents in one workflow — not one model doing everything"
- "Works in WhatsApp, Telegram, Slack, Discord — wherever you already work"

### Phase 2: Developer Acquisition (Q2 → Q3 2026)

**Goal**: 100 paying Pro users, 5,000 active daily users

**Actions**:

1. Launch Builderforce Pro with live workflow DAG (P0 feature gap)
2. Ship inline diff / pair programming mode (P1 gap — targets Aider switchers)
3. MCP semantic codebase search (targets Cursor/Continue.dev switchers)
4. GitHub issue → PR end-to-end workflow (killer demo feature)
5. "Migrate from Cursor/Copilot" guide with zero-config setup
6. Product Hunt launch
7. Influencer outreach: AI/developer YouTube channels

### Phase 3: Team Adoption (Q3 → Q4 2026)

**Goal**: 10 enterprise pilots, 500 paying Team users

**Actions**:

1. Launch Team plan with shared personas and fleet management
2. PR review GitHub App (competes with CodeRabbit — free for open source)
3. Linear / Jira / GitHub Issues → spec import (P3-4)
4. SOC 2 Type I audit (enables enterprise sales)
5. Dedicated Sales Engineer for enterprise pilots
6. Publish case studies: "How [startup] replaced Copilot with CoderClaw"

### Phase 4: Enterprise Scale (Q1 2027+)

**Goal**: $1M ARR, 3 enterprise contracts

**Actions**:

1. Enterprise license GA with on-premises deployment
2. FedRAMP-adjacent compliance documentation
3. Partnerships with SI/GSI partners
4. Custom model fine-tuning for enterprise codebases
5. ClawHub Marketplace launch

---

## 4. Milestone Plan

### Q1 2026 (Now)

| Item                         | Description                   | Revenue impact |
| ---------------------------- | ----------------------------- | -------------- |
| ✅ Multi-agent orchestration | 7 roles, DAG workflows        | Foundation     |
| ✅ Builderforce relay        | Cloud portal integration      | Foundation     |
| ✅ Knowledge loop            | Memory, semantic summaries    | Foundation     |
| 🔲 Live workflow UI (P0)     | DAG + task progress in portal | Pro unlock     |
| 🔲 MCP semantic search (P0)  | Vector codebase search        | Retention      |

### Q2 2026

| Item                          | Description                     | Revenue impact |
| ----------------------------- | ------------------------------- | -------------- |
| 🔲 Inline diff / pair mode    | Accept/reject diff workflow     | Acquisition    |
| 🔲 GitHub issue → PR workflow | End-to-end issue resolution     | Acquisition    |
| 🔲 Builderforce Pro launch    | Subscription billing            | $19–149/mo     |
| 🔲 Persona profiles           | Per-session model+system prompt | Retention      |
| 🔲 Session auto-checkpoint    | Auto-save on exit               | Retention      |

### Q3 2026

| Item                           | Description               | Revenue impact |
| ------------------------------ | ------------------------- | -------------- |
| 🔲 PR review GitHub App        | Auto-review on PR events  | Acquisition    |
| 🔲 Team plan                   | Shared personas, fleet UI | $49/user/mo    |
| 🔲 coderClawLLM Pro pool       | Dedicated model compute   | $0.002/1K      |
| 🔲 Multi-model role routing    | Per-step model assignment | Retention      |
| 🔲 Spec import (GitHub/Linear) | Issue tracker → spec      | Acquisition    |

### Q4 2026

| Item                         | Description             | Revenue impact  |
| ---------------------------- | ----------------------- | --------------- |
| 🔲 Enterprise license GA     | On-prem deployment      | $50K+ contracts |
| 🔲 ClawHub marketplace       | Skill/agent marketplace | 30% rev share   |
| 🔲 Cross-claw memory sharing | Team memory mesh        | Team plan       |
| 🔲 SOC 2 Type I              | Compliance cert         | Enterprise gate |

---

## 5. Key Metrics

### Acquisition

- GitHub stars (target: 10K by Q2 2026)
- NPM weekly downloads (target: 5K by Q2 2026)
- Discord members (target: 2K by Q2 2026)

### Activation

- Projects with `.coderClaw/` initialized (target: 500 active projects)
- Workflows executed per day (target: 1K/day by Q2 2026)
- MCP connections (target: 200 by Q3 2026)

### Retention

- DAU/MAU ratio (target: 30%+)
- Weekly active claws connected to Builderforce
- Average sessions per user per week

### Revenue

| Period  | Target ARR | Key driver                   |
| ------- | ---------- | ---------------------------- |
| Q2 2026 | $10K       | Early Pro subscribers        |
| Q3 2026 | $50K       | Team plan + coderClawLLM     |
| Q4 2026 | $200K      | Enterprise pilots + ClawHub  |
| Q1 2027 | $500K      | Enterprise + marketplace     |
| Q2 2027 | $1M        | Scale + enterprise contracts |

---

## 6. Competitive Pricing Analysis

| Tool           | Pricing                                  | Our response                                         |
| -------------- | ---------------------------------------- | ---------------------------------------------------- |
| GitHub Copilot | $19/user/mo (Individual), $39 (Business) | Match Individual; beat Business with more value      |
| Cursor Pro     | $20/user/mo                              | Match on price; win on self-hosting + multi-agent    |
| Devin          | $500/month (early access)                | Undercut massively; comparable autonomous capability |
| CodeRabbit Pro | $15/user/mo                              | Free for open source; match for private              |
| Continue.dev   | Free (OSS)                               | Match free tier; win on portal + cloud features      |

**Pricing principle**: Match or undercut Cursor/Copilot at the Developer tier. At the Team tier, provide more value (fleet management, adversarial review, audit trail) that justifies $49 vs. $39 for Copilot Business.

---

## 7. Risk Register

| Risk                                        | Probability | Impact | Mitigation                                                    |
| ------------------------------------------- | ----------- | ------ | ------------------------------------------------------------- |
| Anthropic/OpenAI ships multi-agent IDE tool | High        | High   | Double down on self-hosting + open source moat                |
| Cursor/Windsurf adds MCP + multi-agent      | Medium      | High   | Ship live workflow UI and claw mesh — unique differentiators  |
| Model API costs too high for free tier      | Medium      | Medium | Aggressive rate limiting + coderClawLLM margin                |
| Enterprise sales cycle too long             | High        | Low    | Focus on SMB Team plan first; use as reference for enterprise |
| Community fragmentation (forks)             | Low         | Medium | Engage contributors early; offer ClawHub as incentive         |
