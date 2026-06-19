# Managed AI Sessions

aiopsterm tracks coding-agent sessions that run inside aiopsterm-created local shell terminals.

This is separate from the embedded right-side Codex panel. The implementation covers visible local shell terminals opened through aiopsterm's workspace/assets flows; external OS terminals and SSH remote shells are not tracked yet.

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

`AIOPSTERM_AGENT_HOOK_PATH` points to aiopsterm's helper script. The helper is intentionally explicit and fail-open: the Settings -> AI Preferences hook installer can wire it into Codex/Claude user hooks, but aiopsterm does not silently modify global agent configuration.

Example hook command shape:

```sh
node "$AIOPSTERM_AGENT_HOOK_PATH" --source codex --event PermissionRequest
```

The helper reads hook JSON from stdin, adds the managed terminal identifiers, posts the event to `AIOPSTERM_AGENT_SOCKET_PATH`, prints `{}`, and exits zero when it is not running inside an aiopsterm-managed terminal. In installed fail-open mode it still waits for aiopsterm to acknowledge the socket event before returning, so the agent keeps running while the notification is not lost. This keeps agent CLI execution from blocking or failing when aiopsterm is not present.

Claude Code `PermissionRequest` and `AskUserQuestion` hooks are actionable. The installed command passes `--wait-decision`, so the helper can wait up to roughly two minutes for the AI session panel to reply, then prints Claude's native `hookSpecificOutput` JSON. Timeout or missing aiopsterm still falls back to `{}` so Claude's own terminal prompt remains usable. Codex hook-level `PermissionRequest` remains telemetry because stock Codex performs its own approval flow outside the hook response path.

## Hook Installer

Settings -> AI Preferences includes an `Agent Hook 安装器` section.

- Codex installation merges aiopsterm-owned commands into `~/.codex/hooks.json` and enables the Codex hooks feature in `~/.codex/config.toml` inside an aiopsterm-marked block.
- Codex installation also writes matching `hooks.state."<hooks.json path>:<event>:<group>:<handler>"` trust entries into `config.toml`. This is required because Codex disables user hooks whose current hash is new or modified. The trust hash follows Codex's command-hook identity format, including the normalized event label, command, timeout, type, and matcher when present.
- Codex `config.toml` migration handles both `[features] hooks = ...` and dotted `features.hooks = ...` syntax, and removes the legacy `codex_hooks` key so the generated TOML does not conflict with newer Codex releases.
- Claude Code installation merges aiopsterm-owned commands into `~/.claude/settings.json`.
- JSON-based installers are also available for Cursor, Gemini, Copilot, Grok, CodeBuddy, Factory, and Qoder. They follow the target agent's flat or nested hook JSON shape and still only insert aiopsterm-owned commands.
- Install/reinstall first removes only commands containing the aiopsterm marker, then appends the current helper command.
- Uninstall removes only aiopsterm-owned hook commands and preserves user hooks in the same event group.
- Hook commands print `{}` and exit zero outside an aiopsterm-managed local terminal, so external terminals keep their native Codex/Claude behavior.
- Plugin/YAML-style agents such as OpenCode, Amp, Pi, OMP, Antigravity, Kiro, Hermes Agent, and Rovo Dev are recognized as event sources when they report compatible events, but aiopsterm does not yet install their custom plugin/YAML hook files automatically.

To verify against real local agent binaries, run:

```sh
AIOPSTERM_REAL_AGENT_SMOKE=1 npm test -- tests/agent-hook-real-cli-smoke.test.ts
```

The smoke test uses temporary home directories. It asks real Codex to list hook trust state, runs a real Codex `exec` turn against a local fake Responses API, and runs a minimal real Claude Code print-mode turn. Normal test runs skip this file unless the environment variable is set.

## Event Shape

The socket accepts one JSON object per line. The renderer also exposes the same boundary through `publishAiAgentSessionEvent`.

Required fields:

- `source`: `codex`, `claude-code`, or another supported source such as `cursor`, `gemini`, `copilot`, `grok`, `opencode`, `codebuddy`, `factory`, `qoder`, `antigravity`, `kiro`, `hermes-agent`, `rovodev`, `amp`, `pi`, or `omp`
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

Optional fields such as `panelId`, `terminalSessionId`, `cwd`, `project_dir`, `title`, `summary`, `message`, and `transcriptPath` improve terminal focusing and display text.

When hooks omit a display title, aiopsterm derives one from project/workspace fields or the basename of `cwd`/`project_dir`, for example `Codex · api-service` or `Claude Code · release-api`. Claude Code `AskUserQuestion` payloads can also derive the row summary from `tool_input.questions[0].question`, and tool payloads with `tool_name` plus `tool_input.command` are shown as `tool: command`.

## Persistent Session Store

The main process keeps the managed-session fact store in the app user data directory:

```text
agent-sessions/managed-ai-sessions.json
```

The store is capped to 200 sessions, 200 timeline events per session, and 40 local decisions per session. Each session record includes:

- source, session id, state, title, summary, cwd, transcript path, terminal panel id, and terminal session id
- a chronological event timeline with compact raw payload previews
- local decisions such as `allow`, `deny`, `reply`, or `handled`
- `pendingRequestId` and `actionable` fields for live Claude Code permission/question hooks
- `autoTitle` and `userTitle` fields so automatic names do not overwrite manual names

The renderer hydrates from this store on startup through `listManagedAiSessions()`. Incoming hook events update the in-memory UI immediately and are persisted by the main process.

## Actions And Bulk API

The preload boundary exposes:

- `listManagedAiSessions()`
- `replyManagedAiSession({ source, sessionId, kind, message })`
- `renameManagedAiSession({ source, sessionId, title })`
- `clearManagedAiSession({ source, sessionId })`
- `bulkManagedAiSessions({ operation })`

Bulk operations currently support `mark-handled`, `clear-ended`, and `clear-all`. For actionable Claude Code hooks, `allow`, `always`, `bypass`, `deny`, and `reply` resolve the waiting hook with Claude-native output. Codex hook approvals remain telemetry/visibility unless the agent itself asks through its native approval path.

## Auto Title

On `stop`, aiopsterm can derive a short 2-5 word title from the current turn summary when it is useful. Generic completion text such as `Turn complete` and tool summaries such as `shell: ...` are ignored, and manual titles are never overwritten.

## UI Behavior

- The `AI 会话` module is a left-side manager, like workspace/assets navigation. It lists managed sessions by state while the shared main work area remains the terminal workspace.
- Session rows show the project title, state, latest summary, and project path when the hook payload provides one.
- Selecting a row opens details inside the left AI session panel. The shared main work area remains the terminal workspace.
- Details show metadata, a timeline of recent events, local decisions, manual title editing, reply notes, clear actions, and quick focus back to the owning terminal.
- `permission_request`, `question`, and `notification` create top-bar bell entries.
- The main process also emits a desktop notification for `permission_request`, `question`, and `notification` events when Electron notifications are supported.
- Clicking the bell focuses the AI session manager and selects the owning terminal when `panelId` or `terminalSessionId` is known. It does not mark the session handled.
- The AI session row stays selected until the user explicitly marks that pending item handled. Handling clears the unread count and lets the next bell click move to the next pending managed session.
- The owning terminal tab and pane receive a subtle highlight while a managed AI session needs attention.
- `stop`, `session_end`, and terminal close/error events clear pending attention for that session.
