# Managed AI Sessions

aiopsterm tracks coding-agent sessions that run inside aiopsterm-created local shell terminals.

This is separate from the embedded right-side Codex panel. The first implementation covers visible local shell terminals opened through aiopsterm's workspace/assets flows; external OS terminals and SSH remote shells are not tracked yet.

## Managed Terminal Context

Every aiopsterm-created local shell receives these environment variables:

- `AIOPSTERM_MANAGED_TERMINAL=1`
- `AIOPSTERM_TERMINAL_SESSION_ID`
- `AIOPSTERM_PANEL_ID`
- `AIOPSTERM_SURFACE_ID`
- `AIOPSTERM_WORKSPACE_ID`
- `AIOPSTERM_AGENT_SOCKET_PATH`
- `AIOPSTERM_AGENT_HOOK_PATH`

Agent hooks can use `AIOPSTERM_AGENT_SOCKET_PATH` to send newline-delimited JSON events to the running app.

`AIOPSTERM_AGENT_HOOK_PATH` points to aiopsterm's helper script. The helper is intentionally explicit and fail-open: users or future UI flows can wire it into Codex/Claude hooks, but aiopsterm does not silently modify global agent configuration.

Example hook command shape:

```sh
node "$AIOPSTERM_AGENT_HOOK_PATH" --source codex --event PermissionRequest
```

The helper reads hook JSON from stdin, adds the managed terminal identifiers, posts the event to `AIOPSTERM_AGENT_SOCKET_PATH`, prints `{}`, and exits zero when it is not running inside an aiopsterm-managed terminal. This keeps agent CLI execution from blocking or failing when aiopsterm is not present.

## Event Shape

The socket accepts one JSON object per line. The renderer also exposes the same boundary through `publishAiAgentSessionEvent`.

Required fields:

- `source`: `codex`, `claude`, or `claude-code`
- `sessionId` or `session_id`
- `event`, `hookEventName`, or `hook_event_name`

Supported events:

- `SessionStart` / `session_start`
- `UserPromptSubmit` / `prompt_submit`
- `PreToolUse` / `pre_tool_use`
- `PermissionRequest` / `permission_request`
- `AskUserQuestion` / `question`
- `Notification` / `notification`
- `Stop` / `stop`
- `SessionEnd` / `session_end`

Optional fields such as `panelId`, `terminalSessionId`, `cwd`, `title`, `summary`, `message`, and `transcriptPath` improve terminal focusing and display text.

## UI Behavior

- The `AI 会话` module is a left-side manager, like workspace/assets navigation. It lists managed sessions by state while the shared main work area remains the terminal workspace.
- `permission_request`, `question`, and `notification` create top-bar bell entries.
- Clicking the bell focuses the AI session manager and selects the owning terminal when `panelId` or `terminalSessionId` is known. It does not mark the session handled.
- The AI session row stays selected until the user explicitly marks that pending item handled. Handling clears the unread count and lets the next bell click move to the next pending managed session.
- `stop`, `session_end`, and terminal close/error events clear pending attention for that session.
