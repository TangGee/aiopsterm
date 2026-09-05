# aiopsterm

[中文](README.md) | English

aiopsterm is a desktop terminal for AI-assisted operations. It brings terminals, SSH and bastion hosts, host agents, AI sessions, files, assets, MCP, database AI, Kubernetes, and themes into one workspace.

## User Documentation

The complete documentation is included with desktop packages and can also be read from the [website documentation index](https://aiopsterm.com/docs) or directly on GitHub:

- [Usage documentation index](docs/usage/index.md)
- [Bilingual task-oriented guide](docs/usage/best-practices/index.md)
- [Product tour and getting started](docs/usage/best-practices/en-US/01-getting-started.md)
- [Terminal and main workspace](docs/usage/best-practices/en-US/02-terminal-workspace.md)
- [Host Agent](docs/usage/best-practices/en-US/03-host-agent.md)
- [AI session management](docs/usage/best-practices/en-US/05-ai-sessions.md)
- [Quick Commands and macros](docs/usage/best-practices/en-US/06-quick-commands.md)
- [Complete keyboard shortcut reference](docs/usage/best-practices/en-US/07-shortcuts.md)
- [Troubleshooting](docs/usage/best-practices/en-US/17-troubleshooting.md)

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
