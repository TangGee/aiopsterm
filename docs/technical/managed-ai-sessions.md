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

Claude Code `PermissionRequest` and `AskUserQuestion` hooks are actionable. The installed command passes `--wait-decision`, so the helper can wait up to roughly two minutes for the AI session panel to reply, then prints Claude's native `hookSpecificOutput` JSON. Timeout or missing aiopsterm still falls back to `{}` so Claude's own terminal prompt remains usable. Codex hook-level `PermissionRequest` remains timeline visibility because stock Codex performs its own approval flow outside the hook response path. It is shown in the AI session list as local handling, but it does not create an unread bell item or desktop approval notification.

aiopsterm normalizes hook activity into Feed-style request semantics before it stores or displays a session:

- `requestKind`: `permission`, `question`, `plan`, `notification`, or `telemetry`
- `decisionMode`: `blocking`, `local`, or `telemetry`

Claude Code requests launched with `--wait-decision` can be `blocking`, which lets the AI session panel answer the waiting hook. Codex stock hooks remain local visibility or telemetry; aiopsterm records and routes them but does not preempt Codex's native approval UI or mark the session as needing user input.

## Hook Installer

Settings -> AI Preferences includes an `Agent Hook 安装器` section.
The renderer reaches `listAgentHookInstallers`, `installAgentHook`, and `uninstallAgentHook` through `src/renderer/src/services/agentHookClient.ts` before crossing the preload/main `agent-hooks:*` boundary, so Settings state owns UI application while the client owns bridge lookup and binding.

- Codex installation merges aiopsterm-owned commands into `~/.codex/hooks.json` and enables the Codex hooks feature in `~/.codex/config.toml` inside an aiopsterm-marked block.
- Codex installation also writes matching `hooks.state."<hooks.json path>:<event>:<group>:<handler>"` trust entries into `config.toml`. This is required because Codex disables user hooks whose current hash is new or modified. The trust hash follows Codex's command-hook identity format, including the normalized event label, command, timeout, type, and matcher when present.
- Codex `config.toml` migration handles both `[features] hooks = ...` and dotted `features.hooks = ...` syntax, and removes the legacy `codex_hooks` key so the generated TOML does not conflict with newer Codex releases.
- Claude Code installation merges aiopsterm-owned commands into `~/.claude/settings.json`.
- JSON-based installers are also available for Cursor, Gemini, Copilot, Grok, CodeBuddy, Factory, Qoder, and Kiro. They follow the target agent's flat, nested, or Kiro agent hook JSON shape and still only insert aiopsterm-owned commands.
- Plugin/extension installers are available for OpenCode, Amp, Pi, and OMP. They write aiopsterm-marked plugin or extension files that report lifecycle and tool events only when the agent is running inside an aiopsterm-managed local terminal. OpenCode installation also registers the generated plugin in `opencode.json` and removes only that registration on uninstall.
- Rovo Dev installation writes an aiopsterm-marked block into `~/.rovodev/config.yml`; uninstall removes only that marked block.
- Install/reinstall first removes only commands containing the aiopsterm marker, then appends the current helper command.
- Uninstall removes only aiopsterm-owned hook commands and preserves user hooks in the same event group.
- Hook commands print `{}` and exit zero outside an aiopsterm-managed local terminal, so external terminals keep their native Codex/Claude behavior.
- Antigravity and Hermes Agent remain recognized event sources when they report compatible events, but aiopsterm does not yet install their custom hook files automatically.

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

Optional fields such as `panelId`, `terminalSessionId`, `cwd`, `project_dir`, `title`, `summary`, `message`, `transcriptPath`, `launchCommand`, `resumeCommand`, `pid`, `ppid`, `pgid`, and `agentLifecycle` improve terminal focusing, display text, manual restore behavior, and lifecycle visibility.

When hooks omit a display title, aiopsterm derives one from project/workspace fields or the basename of `cwd`/`project_dir`, for example `Codex · api-service` or `Claude Code · release-api`. Claude Code `AskUserQuestion` payloads can also derive the row summary from `tool_input.questions[0].question`, and tool payloads with `tool_name` plus `tool_input.command` are shown as `tool: command`.

`toolName`/`tool_name` is also used to classify dedicated agent requests. `AskUserQuestion` becomes `requestKind: "question"` and `ExitPlanMode` becomes `requestKind: "plan"` even when they arrive through a generic `PermissionRequest` hook. `waitTimeoutMs` records the soft wait window for blocking hooks.

When `launchCommand` is present, the backend stores only a sanitized display form. Model, sandbox, approval, permission-mode, config/profile, and cwd-like flags are preserved. Prompts, credentials, previous session selectors, and noninteractive execution verbs are dropped. If no trusted `resumeCommand` is provided, aiopsterm builds a native resume command from `source`, `sessionId`, and `cwd`, for example:

```sh
cd '/work/project' && codex resume 'codex-session-1'
cd '/work/project' && claude --resume 'claude-session-1'
```

## Persistent Session Store

The main process keeps the managed-session fact store in the app user data directory:

```text
agent-sessions/managed-ai-sessions.json
agent-sessions/managed-ai-sessions.audit.jsonl
```

The store is capped to 200 sessions, 200 timeline events per session, and 40 local decisions per session. Each session record includes:

- source, session id, state, title, summary, cwd, transcript path, terminal panel id, and terminal session id
- request kind, decision mode, optional wait timeout, and optional tool name
- a chronological event timeline with compact raw payload previews
- local decisions such as `allow`, `deny`, `reply`, or `handled`
- `pendingRequestId` and `actionable` fields for live Claude Code permission/question hooks
- `autoTitle` and `userTitle` fields so automatic names do not overwrite manual names
- auto-naming attempt metadata (`autoTitleEventCount`, `autoTitleAttemptedAt`, `autoTitleGeneratedAt`) so turn-end summarization is throttled across restarts
- sanitized `launchCommand` and native `resumeCommand` metadata when the agent source supports session resume
- agent process facts (`processId`, `parentProcessId`, `processGroupId`) and normalized lifecycle (`running`, `idle`, `needsInput`, `ended`, or `unknown`)
- owning local terminal process and activity facts (`terminalProcessId`, `terminalActivityAt`) when the terminal backend reports them

The renderer hydrates from this store on startup through `listManagedAiSessions()`. Incoming hook events update the in-memory UI immediately and are persisted by the main process.

`managed-ai-sessions.audit.jsonl` is an append-only audit stream inspired by control_compat Feed's workstream log. It records compact entries for incoming hook events, socket completion status, local replies, decision resolution or timeout, renames, clears, and bulk operations. Entries include non-secret routing and state fields such as source, session id, event name, request kind, decision mode, state, request id, decision kind, status, title, and a bounded summary. The audit log does not store full raw hook payloads; detailed payload previews remain bounded inside the capped session timeline.

The current implementation records lifecycle and process facts for visibility, restore, and later automation. It does not hibernate agents or kill agent process groups. Disconnecting or closing a terminal still uses the normal terminal lifecycle path and marks matching managed AI sessions ended.

## Event Stream

The same `AIOPSTERM_AGENT_SOCKET_PATH` socket also supports a reconnectable managed-AI event stream. Clients send one newline-delimited JSON request and then keep reading frames:

```json
{"method":"events.stream","params":{"after_seq":0,"categories":["agent","managed-ai"],"include_heartbeats":false}}
```

The first frame is an `ack` with protocol `aiopsterm-agent-events`, a process `boot_id`, replay count, latest sequence, and cursor gap metadata. Subsequent `event` frames include monotonically increasing `seq`, `name`, `category`, `source`, `workspace_id`, `surface_id`, `terminal_session_id`, and a compact payload. Supported categories are:

- `agent`: incoming hook events, named as `agent.hook.<EventName>`, for example `agent.hook.PermissionRequest`.
- `managed-ai`: local session mutations such as `managed_ai.decision.created`, `managed_ai.session.renamed`, `managed_ai.session.cleared`, `managed_ai.sessions.bulk`, and notification operations such as `managed_ai.notification.opened`, `managed_ai.notification.mark_read`, and `managed_ai.notification.dismissed`.

Agent and managed-AI payloads include the normalized `requestKind`, `decisionMode`, optional `waitTimeoutMs`, and optional `toolName` so MCP clients and UI consumers do not have to infer behavior from raw hook names.

Clients can filter by `name`/`names` and `category`/`categories`, resume with `after_seq` or `after`, and disable heartbeat frames with `include_heartbeats: false`. Replay is kept in a bounded in-memory ring of recent events; the JSONL audit file remains the durable long-term record.

The main process also forwards live `managed-ai` stream frames to renderer windows through the preload `onManagedAiSessionEvent()` channel. The renderer treats that notification as an invalidation signal and reloads `listManagedAiSessions()` instead of trusting the event payload as state. This keeps local UI rows synchronized with backend-only mutations such as auto-naming, notification clearing, and external MCP decisions.

## Actions And Bulk API

The preload boundary exposes:

- `listManagedAiSessions()`
- `replyManagedAiSession({ source, sessionId, kind, message })`
- `renameManagedAiSession({ source, sessionId, title })`
- `clearManagedAiSession({ source, sessionId })`
- `bulkManagedAiSessions({ operation })`
- `listManagedAiNotifications({ query, source, unread, read, limit })`
- `markManagedAiNotificationRead({ id, source, sessionId, all })`
- `dismissManagedAiNotification({ id, source, sessionId, allRead })`
- `clearManagedAiNotifications()`
- `openManagedAiNotification({ id, source, sessionId })`
- `jumpToUnreadManagedAiNotification()`

Bulk operations currently support `mark-handled`, `clear-ended`, and `clear-all`. For actionable Claude Code hooks, `allow`, `always`, `bypass`, `deny`, and `reply` resolve the waiting hook with Claude-native output. Stock Codex `PermissionRequest` hooks remain local visibility only: they can be inspected and focused from the AI session manager, but they are not unread notifications and are not answered by aiopsterm.

The external Codex MCP gateway exposes the same decision path through Feed-style aliases: `list_ai_approvals`, `approve_ai_session`, `deny_ai_session`, `answer_ai_question`, and `handle_ai_session`. These tools are derived from managed session records and report per-session capabilities. They do not add a second approval queue, and they keep stock Codex hook approvals local-only unless aiopsterm owns a future Codex app-server watcher.

The notification API is derived from managed session records rather than a separate notification store. Notification ids use `managed-ai:<source>:<sessionId>`. A session is unread while its state is `needsInput` and it has not been handled. `open` and `jump` return a focus request for the renderer to select the AI session panel and the owning visible terminal. `dismiss` only removes read notifications; unread notifications must be marked read first so an active approval or question is not hidden accidentally. `clear` removes all managed AI notification records, matching control_compat's bulk clear semantics, but it still does not kill the owning terminal or agent process.

## Auto Title

On `stop`, aiopsterm can derive a short 2-5 word title from the current turn summary when it is useful. Generic completion text such as `Turn complete` and tool summaries such as `shell: ...` are ignored, and manual titles are never overwritten.

AI-powered auto-naming is controlled by Settings -> AI Preferences -> `AI 会话自动命名` and is off by default. When enabled, the main process builds a bounded context from recent managed session events and asks the currently configured AI model provider for a concise title. The request uses the existing model settings, proxy preferences, and provider timeout path; it does not create AI chat messages, mutate todo state, call Codex/Claude directly, or block the agent hook response. If no model is configured, the provider fails, the title is empty, the session is too short, or the session was manually renamed, aiopsterm keeps the existing title and records only compact audit metadata.

Auto-naming emits `managed_ai.session.renamed` with `auto: true` when it changes a title, records `session.auto_named` in the append-only audit log, and records `session.auto_name_skipped` for non-fatal skips that are useful for diagnostics.

## UI Behavior

- The `AI 会话` module is a left-side manager, like workspace/assets navigation. It lists managed sessions by state while the shared main work area remains the terminal workspace.
- Session rows show the project title, state, latest summary, and project path when the hook payload provides one.
- Selecting a row opens details inside the left AI session panel. The shared main work area remains the terminal workspace.
- Details show metadata, a timeline of recent events, local decisions, manual title editing, reply notes, clear actions, and quick focus back to the owning terminal.
- Details also show normalized agent lifecycle, agent PID/PPID/PGID, terminal PID, and latest terminal activity when those facts are available from hooks or the local terminal backend.
- When a session has a `resumeCommand`, the detail header shows a resume action. Clicking it writes the resume command into the owning aiopsterm local-connection terminal. It does not create a new terminal, close an existing terminal, or touch SSH connections.
- Manual resume uses the same terminal command security pipeline as direct command execution. If the configured security policy requires approval, the normal terminal approval prompt appears before anything is written to the shell.
- Only requests that genuinely need user attention create top-bar bell entries: blocking Claude Code permission/question/plan requests, actionable local questions/plans, and notification requests. Stock Codex `PermissionRequest` hooks stay as timeline rows and do not increment the bell.
- The main process emits a desktop notification only for those same attention-worthy events when Electron notifications are supported.
- Clicking the bell focuses the AI session manager and selects the owning terminal when `panelId` or `terminalSessionId` is known. It does not mark the session handled.
- The AI session row stays selected until the user explicitly marks that pending item handled. Handling clears the unread count and lets the next bell click move to the next pending managed session.
- The owning terminal tab and pane receive a subtle highlight while a managed AI session needs attention.
- `stop`, `session_end`, and terminal close/error events clear pending attention for that session.
