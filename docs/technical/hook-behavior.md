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

## Codex Event Timing

Opening Codex with `codex resume` restores the TUI and selected conversation, but it does not reliably produce an aiopsterm notification by itself. The installed Codex hooks are event-driven. Notifications are expected after Codex emits hook events such as `UserPromptSubmit`, `PreToolUse`, or `Stop`, which normally requires the user to submit at least one message in the resumed session.

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
