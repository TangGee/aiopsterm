# Security Policy

## Supported Versions

Only the latest release line of aiopsterm receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.1.x (latest) | Yes |
| Older releases | No |

Please reproduce suspected issues against the newest published build from
[aiopsterm.com](https://aiopsterm.com) or the
[GitHub releases](https://github.com/TangGee/aiopsterm/releases) page before
reporting.

## Reporting a Vulnerability

**Do not open a public GitHub issue for a vulnerability.** Public issues are
visible to everyone, including attackers, before a fix is available.

Report privately through either channel:

- **Email:** security@aiopsterm.com
- **GitHub Security Advisory:**
  [https://github.com/TangGee/aiopsterm/security/advisories/new](https://github.com/TangGee/aiopsterm/security/advisories/new)

Include in your report:

- The affected version and platform (macOS, Linux, or Windows, plus architecture).
- Steps to reproduce, with proof-of-concept details where possible.
- The potential impact and attack scenario.
- Whether any credentials, tokens, or user data are involved.

Never include real credentials, private keys, certificates, or user data in a
report; use redacted or synthetic examples instead.

## Response Commitment

- We acknowledge new reports within **72 hours**.
- We investigate, develop a fix, and coordinate a disclosure timeline with the
  reporter.
- Once the fix is released, we credit the reporter in the release notes or
  advisory (unless the reporter prefers to remain anonymous).

## Scope

This policy covers:

- The aiopsterm desktop application (Electron main, preload, and renderer
  processes).
- The built-in agent runtimes shipped with the application, including the
  embedded Codex runtime and the Cline agent sidecar.
- The packaged helper scripts, MCP bridges, and the control socket interface.

Third-party components have their own upstream security processes; we still
want to hear about exploitable issues that surface through aiopsterm's
integration of them.

感谢：请不要在公开 Issue 中发布未修复漏洞、凭据或可利用细节。请通过
security@aiopsterm.com 或 GitHub Security Advisory 私下报告受影响版本、平台、
复现步骤和影响范围。凭据不得写入源码、日志、截图或测试夹具。
