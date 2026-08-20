# Hook Behavior

aiopsterm can install agent hooks for tools such as Codex so agent lifecycle events become managed AI notifications inside the desktop app.

## Codex Hook Paths

The Codex hook installer writes persistent hook configuration to the Codex home used by the shell environment. For Codex this is `CODEX_HOME` when set, otherwise `$HOME/.codex`.

The hook command must not point at an AppImage temporary mount such as `/tmp/.mount_*/resources/aiopsterm-agent-hook.js`. That mount changes when the app restarts. At runtime aiopsterm stages the helper script at:

```text
<userData>/agent-hooks/aiopsterm-agent-hook.js
```

Installed hook files should reference that stable userData copy.

Hook commands run that helper with aiopsterm's packaged JavaScript runtime, not a user-installed `node` command. The command sets `ELECTRON_RUN_AS_NODE=1` and launches the stable aiopsterm executable path; AppImage builds prefer the original `APPIMAGE` path instead of a temporary `/tmp/.mount_*` executable. Older hooks installed with `node <helper>` remain fail-open, but the installer reports a warning so the user can reinstall them onto the packaged runtime.

On Windows, command-based hooks use the staged PowerShell launcher with UTF-8 explicitly selected for both stdin and native-process output. Windows PowerShell 5.1 otherwise decodes and re-encodes hook JSON through legacy console/ASCII encodings, which can corrupt non-ASCII messages and invalidate the JSON. The shared launcher covers every command-based agent and event; plugin-based integrations pass UTF-8 JSON directly to the helper.

## Codex Event Timing

Opening Codex with `codex resume` restores the TUI and selected conversation, but it does not reliably produce an aiopsterm notification by itself. The installed Codex hooks are event-driven. Notifications are expected after Codex emits hook events such as `UserPromptSubmit`, `PreToolUse`, or `Stop`, which normally requires the user to submit at least one message in the resumed session.

Codex `request_user_input` prompts are different from normal hook events. Stock Codex can write those prompts into the session transcript without emitting a matching aiopsterm hook. After a managed Codex `UserPromptSubmit` event, aiopsterm watches the reported `transcriptPath` for the active turn and promotes `request_user_input` entries into a local managed-AI `question` event. If a Codex `PreToolUse` hook does include a structured `request_user_input` tool name and question payload, aiopsterm preserves the tool metadata and promotes that hook event directly to managed-AI pending state. Both paths create the normal pending notification and bell attention, but they do not answer Codex from the sidebar; opening the notification focuses the owning terminal so the user can respond in the Codex TUI.

The Codex transcript monitor is fail-open and scoped to aiopsterm-managed local terminals. It stops after the matching turn completes, after `Stop` or `SessionEnd`, or after its bounded monitor lifetime. If the transcript path is missing or temporarily unavailable, the agent keeps running and the monitor retries without blocking Codex.

## Runtime Environment

Local terminals created by aiopsterm receive managed-terminal environment variables:

- `AIOPSTERM_MANAGED_TERMINAL=1`
- `AIOPSTERM_AGENT_SOCKET_PATH`
- `AIOPSTERM_AGENT_HOOK_PATH`
- `AIOPSTERM_JS_RUNTIME`
- `AIOPSTERM_TERMINAL_SESSION_ID`
- `AIOPSTERM_PANEL_ID` / `AIOPSTERM_SURFACE_ID`
- `AIOPSTERM_WORKSPACE_ID`

`AIOPSTERM_AGENT_HOOK_PATH` is a runtime convenience for agents that can load plugins from the running terminal environment. It is not the preferred persistent path for JSON hook configuration. Persistent Codex hook commands should use the staged userData helper path so they survive app restarts.

## Home Resolution

Hook installation and local terminal startup should resolve the same shell home. aiopsterm prefers `process.env.HOME` and falls back to Electron `app.getPath('home')`. This keeps installed Codex hooks aligned with the `codex` process a user starts inside an aiopsterm terminal.

## Agent-Specific Notification Notes

Claude Code has explicit `PermissionRequest` and `AskUserQuestion` hooks. aiopsterm installs those with `--wait-decision`, so the managed-session backend can block the hook briefly and return Claude-native approval or question output.

Codex permission hooks become local pending notifications because stock Codex owns the approval UI but the user still needs to return to that terminal. aiopsterm can focus the owning terminal and mark the item handled, but it does not send allow/deny decisions back to stock Codex. Codex question prompts are covered by the transcript monitor above because they are not guaranteed to arrive through the normal hook channel.

Cursor, Gemini, Copilot, Grok, CodeBuddy, Factory, Qoder, and Kiro currently report lifecycle, notification, and tool-related hook events through the generic managed-session normalization path. OpenCode, Amp, Pi, OMP, and Rovo Dev use plugin or config hooks for lifecycle/tool events. No second transcript-style question monitor is installed for those agents because their supported aiopsterm hook definitions do not expose a Codex-like hidden `request_user_input` transcript path.

Kimi Code uses its native `[[hooks]]` entries in `~/.kimi-code/config.toml`. The installer owns only the block between the aiopsterm markers and preserves model settings and user-created hooks. Kimi exposes session, prompt, turn, tool, permission, notification, completion, failure, and exit events through this path.

DeepSeek Harness uses the official `@deepseek-ai/dsh-hooks-codex` bridge. The installer adds the dependency to both the `web` and `headless` profiles, stores the Codex-shaped hook configuration in `~/.dsh/aiopsterm/hooks.json`, and inserts a marked block into each profile's `cordis.patch.yml`. The bridge currently exposes session, prompt, tool, and completion events; it does not expose a native approval event, so aiopsterm cannot raise approval notifications for DeepSeek Harness until the upstream bridge provides one.

Antigravity and Hermes Agent are recognized event sources when compatible events are reported. aiopsterm does not yet install their hook files automatically; compatible approval or notification events are still normalized if they reach the managed-agent socket.
