# AI Preferences

This page controls AI chat and Agent loop behavior.

## Agent Hook Installer

- Session Management Hook: Writes the aiopsterm Hook Helper into supported agent user-level hook configuration so the `AI Sessions` panel can discover AI sessions launched from aiopsterm local-connection terminals.
- CLI: Shows whether the matching command is visible in the current `PATH`, such as `codex`, `claude`, `cursor-agent`, `gemini`, `copilot`, `grok`, `opencode`, `codebuddy`, `droid`, `qodercli`, `amp`, `pi`, `omp`, `kiro-cli`, or `acli`.
- Hook Config: Codex uses `~/.codex/hooks.json`; Claude Code uses `~/.claude/settings.json`. Cursor, Gemini, Copilot, Grok, OpenCode, CodeBuddy, Factory, Qoder, Amp, Pi, OMP, Kiro, and Rovo Dev use their own hook or plugin configuration. The installer only inserts aiopsterm-marked commands and preserves other user hooks.
- Extra Config: Codex also receives a marked block in `~/.codex/config.toml` to enable hooks. Uninstall removes that marked block and tries to restore the previous `hooks` line.
- Hook Helper: Shows the packaged `aiopsterm-agent-hook.js` path. Hook commands invoke it through `node`, so executable file mode is not required.
- Install / Reinstall: Removes old aiopsterm-owned hook commands first, then writes the current helper path. This is never run silently; it requires an explicit click in Settings.
- Uninstall: Removes only aiopsterm-owned hook commands. Other hooks for the same event remain intact.
- Scope: The helper reports events only inside aiopsterm local-connection terminals with `AIOPSTERM_MANAGED_TERMINAL=1` and `AIOPSTERM_AGENT_SOCKET_PATH`. External system terminals return `{}` and exit normally.
- Management: Sessions are persisted under the app data directory. The panel can inspect timelines, decisions, manual titles, handled state, and cleanup. `Allow`, `Deny`, and `Reply` are local management decisions unless the agent hook supports a native blocking response.

## AI Session Hibernation

- Enable Agent Hibernation: Allows aiopsterm to hibernate eligible background local-connection terminals when too many AI sessions are live. It skips the visible terminal, sessions waiting for input, and sessions without a resume command.
- Idle Time (seconds): A terminal must be inactive for this many seconds before it can become a hibernation candidate. Range: `5` to `604800`.
- Max Live Terminals: Hibernation starts only when the number of live restorable AI terminals exceeds this value. Range: `1` to `256`.
- Confirmation Countdown (seconds): How long the UI keeps the hibernation confirmation window. `0` means eligible background candidates are hibernated immediately. Range: `0` to `3600`.
- Restore: Hibernated sessions remain in the AI Sessions panel and are restored from aiopsterm local-connection terminals with the saved `resumeCommand`.

## Notifications

- Desktop Notifications: Controls system desktop notifications from the external notification protocol and AI session events. In-app notification history, AI Sessions, and event records remain available when this is off.
- Top Bell for Control Notifications: Controls whether unread notifications from the external notification protocol enter the top bell queue. AI session approval, question, and pending-input reminders are always kept.

## Automation & Developer

- Control Socket: aiopsterm local-connection terminals receive `AIOPSTERM_CONTROL_SOCKET`. Scripts and CLI helpers use it to call the control protocol for notifications, notification focus, automation requests, and managed AI sessions.
- CLI Helper: `resources/aiopsterm-control.js` is the Node.js helper for the control protocol. It must run in an environment that has `AIOPSTERM_CONTROL_SOCKET`, normally an aiopsterm local-connection terminal.
- External Codex MCP: MCP bridge for external Codex. It is not bound to a terminal and is intended for Codex running from a system terminal.
- `AIOPSTERM_EXTERNAL_CODEX_MCP_ENABLE=1`: Enables the external Codex MCP bridge. This is a startup environment variable, so changing it requires restarting aiopsterm.
- `AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN`: Optional access token. When set, external MCP clients must use the same token.
- `AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET`: Optional socket path. When omitted, aiopsterm uses the default path under the app data directory.
- Control protocol documentation: See [Control Socket](../../../technical/control-socket.md).
- External Codex MCP documentation: See [External Codex MCP](../../../technical/external-codex-mcp.md).

## General

- Enable Extended Thinking: Enables additional reasoning-budget configuration.
- Budget: Token budget for Extended Thinking. Higher budgets can improve complex reasoning, but may increase cost and latency.
- Auto Execute Read-Only Commands: Allows low-risk read-only commands to run automatically within the confirmed scope. It does not bypass high-risk command approval.
- Command Output Filtering: Compresses the middle of long command output when sending it back to Agent context. The UI still keeps the full output.
- Knowledge Base Search: Automatically searches and attaches relevant knowledge-base documents for normal AI chat.
- Experience Extraction: Controls whether AI responses extract reusable operations experience.
- Auto Approval: Allows low-risk read-only actions to pass automatically. High-risk commands still require approval.
- Security Config: Opens `security-config.json`, where command security policy, blacklist, whitelist, and risk approval rules are maintained.

## Features

- OpenAI Reasoning Effort: Sets OpenAI reasoning intensity. `Low` is faster and cheaper; `High` favors complex reasoning.

## AI Model Proxy

- Enable Proxy: Routes AI model API requests through a proxy.
- Proxy Type: HTTP, HTTPS, SOCKS4, or SOCKS5.
- Host: Proxy server host.
- Port: Proxy server port.
- Enable Proxy Identity: Enables username/password authentication for the proxy.
- Username / Password: Proxy credentials.

## Terminal

- Shell Integration Timeout: Default time, in seconds, that Agent waits for terminal command output.
