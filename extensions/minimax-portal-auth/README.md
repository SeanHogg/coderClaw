# MiniMax OAuth (CoderClaw plugin)

OAuth provider plugin for **MiniMax** (OAuth).

## Enable

Bundled plugins are disabled by default. Enable this one:

```bash
coderclaw plugins enable minimax-portal-auth
```

Restart the Gateway after enabling.

```bash
coderclaw gateway restart
```

## Authenticate

```bash
coderclaw models auth login --provider minimax-portal --set-default
```

You will be prompted to select an endpoint:

- **Global** - International users, optimized for overseas access (`api.minimax.io`)
- **China** - Optimized for users in China (`api.minimaxi.com`)

## Notes

- MiniMax OAuth uses a user-code login flow.
- Currently, OAuth login is supported only for the Coding plan
