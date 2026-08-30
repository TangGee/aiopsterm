# aiopsterm

[中文](README.md) | English

aiopsterm is a desktop terminal for AI-assisted operations. It brings terminals, SSH and bastion hosts, host agents, AI sessions, files, assets, MCP, database AI, Kubernetes, and themes into one workspace.

## Install And Develop

Download an installer for your platform from https://aiopsterm.com. For source builds, see [the installation guide](docs/usage/installation.md).

```bash
npm ci
npm run dev
npm run typecheck
npm test
```

Platform builds and release audits are documented in [development commands](docs/usage/development-commands.md) and [technical development notes](docs/technical/development.md).

## Privacy

Anonymous telemetry is enabled by default and can be disabled in Settings. Telemetry is limited to version, platform, architecture, launch, and feature-usage statistics. It does not include terminal content, commands, paths, logs, SSH credentials, or AI conversation content.

## Feedback And License

Please report issues at https://github.com/TangGee/aiopsterm/issues. aiopsterm-owned code is licensed under the Apache License 2.0; see [LICENSE](LICENSE). Third-party dependency notices are listed in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
