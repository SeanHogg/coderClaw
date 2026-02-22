---
summary: "Understanding the relationship between CoderClaw and CoderClaw"
read_when:
  - Deciding between CoderClaw and CoderClaw
  - Understanding Phase 2 enhancements
title: "CoderClaw vs CoderClaw"
---

# CoderClaw vs CoderClaw

Understanding the relationship between CoderClaw and CoderClaw, and when to use each.

## TL;DR

**CoderClaw** is the multi-channel AI gateway foundation.  
**CoderClaw** = CoderClaw + Phase 2 distributed runtime + security enhancements.

If you need basic personal AI assistant across messaging apps → **Use CoderClaw**  
If you need team collaboration, RBAC, audit logs, and distributed execution → **Use CoderClaw**

## What is CoderClaw?

[CoderClaw](https://github.com/SeanHogg/coderClaw) is a **self-hosted multi-channel gateway** that connects messaging apps (WhatsApp, Telegram, Discord, Slack, Signal, iMessage) to AI coding agents.

**Key Features:**

- Multi-channel messaging gateway
- WebSocket control plane
- Single-sender sessions
- Basic security (allowlists, pairing)
- Tool system and plugins
- Mobile nodes (iOS/Android)
- Canvas and voice features

**Best For:**

- Personal AI assistant
- Single-user or small team (trusted environment)
- Local execution only
- Basic security requirements

## What is CoderClaw Phase 2?

**CoderClaw** is a fork and extension of CoderClaw that adds **Phase 2 capabilities** for distributed AI runtime with secure orchestration.

**Additional Features (Phase 2):**

- 🔄 **Transport Abstraction Layer** - Execute tasks locally or remotely
- 📊 **Distributed Task Lifecycle** - Formal state machine with persistence
- 🔐 **Enhanced Security** - RBAC, device trust, comprehensive audit logs
- 🎯 **Team Collaboration** - Multi-session isolation, shared registries
- 🏢 **Enterprise Ready** - CI/CD integration, deterministic execution

**Best For:**

- Development teams
- Enterprise deployments
- Remote/distributed execution
- Advanced security requirements
- CI/CD automation
- Compliance and audit trails

## Feature Comparison

| Feature                                    | CoderClaw | CoderClaw   |
| ------------------------------------------ | --------- | ----------- |
| **Core Gateway**                           |           |             |
| Multi-channel messaging                    | ✅        | ✅          |
| WebSocket control plane                    | ✅        | ✅          |
| Plugin system                              | ✅        | ✅          |
| Mobile nodes                               | ✅        | ✅          |
| Canvas & voice                             | ✅        | ✅          |
| **Execution**                              |           |             |
| Local task execution                       | ✅        | ✅          |
| Remote task execution                      | ❌        | ✅          |
| Transport abstraction                      | ❌        | ✅          |
| Distributed runtime                        | ❌        | ✅          |
| **Task Management**                        |           |             |
| Basic task execution                       | ✅        | ✅          |
| Task lifecycle management                  | ❌        | ✅          |
| Task persistence                           | ❌        | ✅          |
| Task resumability                          | ❌        | ✅          |
| Audit trail                                | ❌        | ✅          |
| **Security**                               |           |             |
| Allowlists                                 | ✅        | ✅          |
| Device pairing                             | ✅        | ✅          |
| Token authentication                       | ✅        | ✅          |
| RBAC                                       | ❌        | ✅          |
| Device trust levels                        | ❌        | ✅          |
| Comprehensive audit logs                   | ❌        | ✅          |
| Multi-provider auth (OIDC, GitHub, Google) | ❌        | ✅          |
| Granular permissions                       | ❌        | ✅          |
| **Collaboration**                          |           |             |
| Single-user sessions                       | ✅        | ✅          |
| Multi-session isolation                    | ❌        | ✅          |
| Shared agent registries                    | ❌        | ✅          |
| Team policy enforcement                    | ❌        | ✅          |
| CI/CD integration                          | Basic     | ✅ Advanced |
| **Developer Experience**                   |           |             |
| CLI tools                                  | ✅        | ✅          |
| Web Control UI                             | ✅        | ✅          |
| macOS/iOS/Android apps                     | ✅        | ✅          |
| Project knowledge engine                   | ❌        | ✅          |
| Multi-agent workflows                      | Basic     | ✅ Advanced |

## Architecture Comparison

### CoderClaw Architecture

```
┌─────────────────────────────────────┐
│      Multi-Channel Gateway          │
│  (WhatsApp, Telegram, Discord...)   │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│       WebSocket Control Plane       │
│     (Clients, Nodes, Control UI)    │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│         Pi Agent Runtime            │
│       (Local execution only)        │
└─────────────────────────────────────┘
```

### CoderClaw Architecture (Phase 2)

```
┌─────────────────────────────────────┐
│      Multi-Channel Gateway          │
│  (WhatsApp, Telegram, Discord...)   │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│       WebSocket Control Plane       │
│     (Clients, Nodes, Control UI)    │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│     CoderClaw Runtime Layer         │
│  ┌───────────────────────────────┐  │
│  │  Transport Abstraction Layer  │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ Distributed Task Engine       │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  Security Service (RBAC)      │  │
│  └───────────────────────────────┘  │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│   Pi Agent Runtime + Task Executor  │
│   (Local or Remote execution)       │
└─────────────────────────────────────┘
```

## Migration Path

### From CoderClaw to CoderClaw

CoderClaw is **100% backward compatible** with CoderClaw. Your existing setup continues to work:

1. **Install CoderClaw** (uses same `coderclaw` npm package name)
2. **Phase 2 features are opt-in** - no breaking changes
3. **Existing configuration works** - no migration needed
4. **Enable Phase 2 gradually** - add features as needed

```bash
# Your existing CoderClaw setup
npm install -g coderclaw@latest
coderclaw gateway --port 18789

# After switching to CoderClaw (same commands!)
npm install -g coderclaw@latest  # CoderClaw version
coderclaw gateway --port 18789   # Same gateway command

# Opt-in to Phase 2 features
mkdir -p ~/.coderclaw/.coderClaw
# Add runtime.yaml and security.yaml as needed
```

### Staying on CoderClaw

If you're happy with CoderClaw's feature set, **stay on CoderClaw**. It's actively maintained and receives security updates.

CoderClaw is for teams that need:

- Distributed execution
- Advanced security (RBAC, audit logs)
- Team collaboration features
- CI/CD integration

## Use Cases

### Use CoderClaw When

✅ Personal AI assistant for messaging apps
✅ Small trusted team (2-5 people)
✅ Local execution is sufficient
✅ Basic allowlist security is enough
✅ No need for audit trails
✅ Simple deployment model

**Example**: "I want an AI assistant I can message on WhatsApp from my phone that runs on my Mac at home."

### Use CoderClaw Phase 2 When

✅ Development team (5+ people)  
✅ Need remote/distributed execution  
✅ Require RBAC and granular permissions  
✅ Need comprehensive audit logs  
✅ CI/CD automation requirements  
✅ Enterprise compliance needs  
✅ Multi-tenant deployments

**Example**: "Our team needs an AI assistant that runs on a shared server, with different permission levels for developers, reviewers, and CI pipelines, plus full audit logs for compliance."

## Pricing & Licensing

Both projects are **MIT licensed** and **free to use**.

- CoderClaw: [github.com/SeanHogg/coderClaw](https://github.com/SeanHogg/coderClaw)
- CoderClaw: [github.com/SeanHogg/coderClaw](https://github.com/SeanHogg/coderClaw)

## Getting Started

### Starting with CoderClaw

```bash
npm install -g coderclaw@latest
coderclaw onboard --install-daemon
coderclaw gateway --port 18789
```

Documentation: [docs.coderclaw.ai](https://docs.coderclaw.ai)

### Starting with CoderClaw Phase 2

```bash
npm install -g coderclaw@latest
coderclaw onboard --install-daemon
coderclaw gateway --port 18789

# Optional: Enable Phase 2 features
# See Phase 2 Quick Start guide
```

Documentation: [docs.coderclaw.ai](https://docs.coderclaw.ai) (this site)

## Contributing

Both projects welcome contributions:

- **CoderClaw**: Core gateway features, channels, tools
- **CoderClaw**: Phase 2 runtime, security, distributed features

If you're building something that benefits both projects, contribute to CoderClaw first, then CoderClaw can merge upstream changes.

## Community

Both projects share the same Discord community:

[Join Discord](https://discord.gg/coderclaw)

## FAQ

**Q: Can I run both CoderClaw and CoderClaw on the same machine?**

A: Not recommended. They use the same gateway port (18789) and state directory. Choose one.

**Q: Will CoderClaw get Phase 2 features eventually?**

A: Unknown. CoderClaw was created to experiment with enterprise features. If successful, they may merge back into CoderClaw.

**Q: Is CoderClaw more expensive to run?**

A: No. Phase 2 features add minimal overhead. API costs are the same (same AI models).

**Q: Can I switch between them easily?**

A: Yes! They share the same configuration format. Backup your `~/.coderclaw` directory and you can switch back and forth.

**Q: Which one should I start with?**

A: If you're just exploring → Start with **CoderClaw** (simpler)  
 If you know you need team features → Start with **CoderClaw**

## Summary

**CoderClaw** = Multi-channel AI gateway (proven, stable, great for personal use)  
**CoderClaw** = CoderClaw + Distributed runtime + Security + Team features

Both are excellent projects. Choose based on your requirements:

- **Solo/small team + local only** → CoderClaw
- **Team/enterprise + distributed + security** → CoderClaw

---

_This guide is maintained by the CoderClaw project. For CoderClaw-specific questions, see [docs.coderclaw.ai](https://docs.coderclaw.ai)._
