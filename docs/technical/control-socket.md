# aiopsterm Control Socket

aiopsterm exposes a local newline-delimited JSON control socket for automation that needs to operate on terminal panels opened by aiopsterm. This is the control_compat-style automation layer: scripts talk to a socket, the main process handles routing, and renderer windows provide UI-only state such as terminal panels and xterm screen text.

## Scope

The first control-socket slice supports these terminal primitives:

- `ping`: verify that the socket is reachable.
- `system.capabilities`: return the control protocol version, process facts, socket path, and supported capability tokens.
- `system.identify`: return the same app/process identity plus optional caller context and current runtime counters.
- `agent.hooks.list`: list supported AI agent hook installers and current install status.
- `agent.hooks.setup`: install hooks for detected agent CLIs, or for selected `source` values.
- `agent.hooks.install`: install selected agent hooks even when the binary is not currently on `PATH`.
- `agent.hooks.uninstall`: remove aiopsterm-owned hooks for selected agents.
- `terminal.list`: list visible terminal panels.
- `terminal.focus`: focus a terminal panel by `panelId` or `sessionId`.
- `terminal.read_screen`: read recent visible xterm buffer text from a terminal panel.
- `terminal.send_text`: send raw text to a connected terminal session by `sessionId`, or resolve one from `panelId`/`surfaceId`.
- `terminal.send_key`: send a named key such as `enter`, `tab`, `esc`, `up`, `f1`, or `ctrl+c` to a connected terminal session.

The notification slice adds these generic notification primitives:

- `notification.create`: create an unread notification.
- `notification.list`: list queued notifications.
- `notification.open`: focus the target terminal and mark one notification read.
- `notification.jump_to_unread`: open the newest unread notification.
- `notification.mark_read`: mark one notification or all notifications read.
- `notification.dismiss`: remove one read notification, or all read notifications.
- `notification.clear`: clear the generic notification queue.

The workspace metadata slice adds read-only model snapshots:

- `workspace.snapshot`: return the current main workspace, terminal surfaces, split groups, generic notifications, managed AI session summaries, and top-bell attention items in one payload.
- `workspace.list`: list the logical aiopsterm workspaces exposed to automation. This currently returns the single shared main workspace.
- `workspace.current`: return the currently selected logical workspace metadata.
- `surface.list`: list terminal and editor surfaces in the shared main work panel.
- `surface.current`: return the currently active surface.

The workspace group slice adds control_compat-style group metadata for the shared main work panel:

- `workspace.group.list`: list automation-visible surface groups.
- `workspace.group.create`: create a group over one or more current surfaces.
- `workspace.group.ungroup`: remove a group while keeping all surfaces open.
- `workspace.group.delete`: close every surface in the group. This requires `confirm=true`.
- `workspace.group.rename`, `collapse`, `expand`, `pin`, `unpin`: update group metadata.
- `workspace.group.add`, `remove`, `set_anchor`: manage group membership and anchor surface.
- `workspace.group.new_workspace`: create a new local terminal panel and add it to the group.
- `workspace.group.focus`: focus the group anchor surface.

The session restore slice adds control_compat-style saved layouts for the shared main work panel:

- `session.save`: ask the active renderer to export the current work-panel layout and persist it.
- `session.list`: list saved session snapshots.
- `session.show`: inspect one saved snapshot, defaulting to `latest`.
- `session.restore`: restore one saved snapshot into the shared main work panel.
- `session.clear`: remove one saved snapshot.

The Agent Hibernation slice adds explicit managed-agent lifecycle controls:

- `agent-hibernation.status`: return the current hibernation config, managed session summaries, and a workspace snapshot.
- `agent-hibernation.on` and `agent-hibernation.off`: enable or disable explicit hibernation controls.
- `agent-hibernation.preview`: return the current automatic reaper candidates without hibernating anything.
- `agent-hibernation.sweep`: run one automatic reaper pass.
- `agent.status`: alias for `agent-hibernation.status`.
- `agent.hibernate`: hibernate one managed AI session by `sessionId`, with optional `source` when ids are ambiguous.
- `agent.resume`: focus one managed AI session and write its stored resume command into the owning local terminal.

The Agent Teams slice adds control_compat-style multi-agent launch primitives for aiopsterm local connection terminals:

- `agent.team.launch`: create one or more visible local terminal surfaces, start local shells, write each agent launch command through terminal command security, and group the created surfaces.

This starts agents in terminals owned by aiopsterm's main work panel. It does not manage the embedded right-side Codex panel and does not use external OS terminals.

The Agent Session slice adds control_compat-style local socket primitives for AI session manager records:

- `agent.session.list`: list managed AI sessions, optionally filtered by `source`, `state`, `query`, or `needsInput`.
- `agent.session.show` / `agent.session.get`: inspect one session by `sessionId`, with optional `source` when ids are ambiguous.
- `agent.session.reply`: record a decision such as `allow`, `always`, `bypass`, `deny`, `reply`, or `handled`.
- `agent.session.approve`, `agent.session.deny`, and `agent.session.handle`: convenience aliases over `reply`.
- `agent.session.rename`: set the user-facing managed session title.
- `agent.session.clear`: remove the managed AI session record.
- `agent.session.bulk`: run `mark-handled`, `clear-ended`, or `clear-all` over managed AI session records, optionally filtered by source/session id.

The Feed aliases expose the same managed AI queue with control_compat-style names:

- `feed.list`: list sessions that currently need input.
- `feed.mark-handled`: mark all pending managed AI requests handled.
- `feed.clear-ended`: remove ended managed AI sessions.
- `feed.clear`: clear all managed AI session records; this requires `confirm=true`.

`agent.sessions.*` and `ai.session.*` are accepted aliases for scripts that group these methods differently.

The surface resume slice adds control_compat-style resume bindings for visible work-panel surfaces:

- `surface.resume.set`: attach a resume command to the current or selected surface.
- `surface.resume.get` / `surface.resume.show`: read the selected surface's resume binding.
- `surface.resume.trust`: explicitly mark the selected resume binding as trusted for manual or automatic recovery.
- `surface.resume.preview`: list current resume bindings and explain whether each one is ready for trusted automatic recovery.
- `surface.resume.autorun`: run only trusted automatic resume bindings through terminal command security.
- `surface.resume.clear`: remove a binding, optionally guarded by checkpoint/source.
- `surface.resume.run`: explicitly write the stored command into the selected terminal through aiopsterm terminal command security.

The events slice adds a control_compat-style local JSONL stream for automation:

- `events.stream` / `event.subscribe`: take over the socket connection and stream `ack`, replayed `event`, live `event`, and `heartbeat` frames.
- `events.list`: list retained events for simple polling and tests.

The synchronization slice adds control_compat-style automation rendezvous:

- `sync.wait_for`: wait for or signal a named local token. `wait-for` and `wait_for` are aliases.

The terminal buffer slice adds tmux/control_compat-style runtime text buffers:

- `terminal.buffer.set`, `terminal.buffer.list`, `terminal.buffer.paste`: set, list, and paste named text buffers.

The terminal history slice adds renderer-owned scrollback cleanup:

- `terminal.clear_history` / `surface.clear_history`: clear a selected terminal surface's visible buffer and retained panel output.

The terminal respawn slice adds a control_compat-compatible restart-command bridge:

- `terminal.respawn` / `surface.respawn`: send a restart command to a selected terminal surface through terminal command security.

The sidebar metadata slice adds control_compat-style status channels for local automation:

- `sidebar.status.set`, `sidebar.status.clear`, `sidebar.status.list`: manage keyed status entries.
- `sidebar.progress.set`, `sidebar.progress.clear`: manage a workspace progress value.
- `sidebar.log.append`, `sidebar.log.clear`, `sidebar.log.list`: manage bounded log entries.
- `sidebar.state`: return status, progress, and log metadata in one payload.

The Agent Vault slice adds custom agent launch metadata for visible local-terminal automation:

- `agent.vault.register`: register a custom agent id and command templates.
- `agent.vault.list`: list registered custom agents.
- `agent.vault.get`: read one custom agent definition.
- `agent.vault.render`: render a launch, resume, or fork command from a template.
- `agent.vault.identify`: match a supplied process snapshot against registered detection rules and render resume/fork commands when a session id is available.
- `agent.vault.scan`: inspect descendants of aiopsterm visible local-terminal shell processes, match them against Vault registrations, and render resume/fork commands.
- `agent.vault.remove`: remove one custom agent definition.

Aliases are accepted for control_compat-compatible scripts where useful:

- `tree` and `top` map to `workspace.snapshot`.
- `list_workspaces` and `list-workspaces` map to `workspace.list`.
- `list_surfaces` and `list-surfaces` map to `surface.list`.
- `list_terminals` and `debug.terminals` map to `terminal.list`.
- `focus_terminal` and `focus-panel` map to `terminal.focus`.
- `read-screen`, `capture-pane`, and `surface.read_text` map to `terminal.read_screen`.
- `clear-history` and `surface.clear_history` map to `terminal.clear_history`.
- `respawn-pane` and `surface.respawn` map to `terminal.respawn`.
- `send`, `send-panel`, and `surface.send_text` map to `terminal.send_text`.
- `send-key`, `send-key-panel`, and `surface.send_key` map to `terminal.send_key`.
- `wait-for` maps to `sync.wait_for`.
- `display-message` maps to `notification.create`; `display-message -p` prints locally without using the socket.
- `set-buffer`, `paste-buffer`, and `list-buffers` map to `terminal.buffer.*`.
- `set-status`, `clear-status`, `list-status`, `set-progress`, `clear-progress`, `log`, `clear-log`, `list-log`, and `sidebar-state` map to `sidebar.*` metadata methods.
- `notify` maps to `notification.create`.
- `list-notifications` maps to `notification.list`.
- `open-notification` maps to `notification.open`.
- `jump-to-unread` maps to `notification.jump_to_unread`.
- `mark-notification-read` maps to `notification.mark_read`.
- `dismiss-notification` maps to `notification.dismiss`.
- `clear-notifications` maps to `notification.clear`.

## Socket Discovery

When aiopsterm starts, it creates a per-process socket under the app user-data directory:

- Linux/macOS: `<userData>/control/aiopsterm-control-<pid>.sock`
- Windows: `\\.\pipe\aiopsterm-control-<pid>`

Local terminal sessions launched through aiopsterm receive:

- `AIOPSTERM_CONTROL_SOCKET`: control socket path.
- `AIOPSTERM_TERMINAL_SESSION_ID`: current terminal backend session id.
- `AIOPSTERM_PANEL_ID` and `AIOPSTERM_SURFACE_ID`: owning terminal panel id when known.

## Protocol

Requests and responses are one JSON object per line.

Request:

```json
{"id":"request-1","method":"terminal.list","params":{}}
```

Response:

```json
{"id":"request-1","ok":true,"data":{"terminals":[],"count":0}}
```

Errors use the common mutation shape:

```json
{"id":"request-1","ok":false,"errorCode":"TERMINAL_PANEL_NOT_FOUND","errorMessage":"Terminal panel not found."}
```

## CLI Helper

The packaged helper is `resources/aiopsterm-control.js`. It defaults to `AIOPSTERM_CONTROL_SOCKET`, so it works naturally inside an aiopsterm local terminal:

```bash
node /path/to/resources/aiopsterm-control.js terminal list
node /path/to/resources/aiopsterm-control.js capabilities
node /path/to/resources/aiopsterm-control.js identify --panel "$AIOPSTERM_PANEL_ID" --session "$AIOPSTERM_TERMINAL_SESSION_ID"
node /path/to/resources/aiopsterm-control.js rpc terminal.list --params-json '{"limit":2}'
node /path/to/resources/aiopsterm-control.js hooks list
node /path/to/resources/aiopsterm-control.js hooks setup
node /path/to/resources/aiopsterm-control.js hooks setup --agent codex
node /path/to/resources/aiopsterm-control.js hooks uninstall codex
node /path/to/resources/aiopsterm-control.js workspace snapshot
node /path/to/resources/aiopsterm-control.js workspace-group list
node /path/to/resources/aiopsterm-control.js workspace-group create --name "deploy" --from panel-1,panel-2
node /path/to/resources/aiopsterm-control.js workspace-group focus workspace_group:1
node /path/to/resources/aiopsterm-control.js session save --id latest --name "Work Layout"
node /path/to/resources/aiopsterm-control.js session list
node /path/to/resources/aiopsterm-control.js session restore --id latest
node /path/to/resources/aiopsterm-control.js surface list
node /path/to/resources/aiopsterm-control.js surface resume set --kind tmux --checkpoint work --shell "tmux attach -t work"
node /path/to/resources/aiopsterm-control.js surface resume trust --panel panel-main --policy auto --reason "trusted tmux session"
node /path/to/resources/aiopsterm-control.js surface resume preview --panel panel-main
node /path/to/resources/aiopsterm-control.js surface resume autorun --panel panel-main
node /path/to/resources/aiopsterm-control.js surface resume show --json
node /path/to/resources/aiopsterm-control.js surface resume run --panel panel-main
node /path/to/resources/aiopsterm-control.js surface resume clear --checkpoint work
node /path/to/resources/aiopsterm-control.js agent-hibernation status
node /path/to/resources/aiopsterm-control.js agent-hibernation on
node /path/to/resources/aiopsterm-control.js agent-hibernation preview
node /path/to/resources/aiopsterm-control.js agent-hibernation sweep
node /path/to/resources/aiopsterm-control.js agent hibernate --session codex-session-1 --source codex
node /path/to/resources/aiopsterm-control.js agent resume --session codex-session-1 --source codex
node /path/to/resources/aiopsterm-control.js agent session list --needs-input
node /path/to/resources/aiopsterm-control.js agent session show claude-session-1 --source claude-code
node /path/to/resources/aiopsterm-control.js agent session approve claude-session-1 --source claude-code
node /path/to/resources/aiopsterm-control.js agent session deny claude-session-1 --source claude-code --message "Use staging first"
node /path/to/resources/aiopsterm-control.js agent session rename claude-session-1 --source claude-code --title "Deploy review"
node /path/to/resources/aiopsterm-control.js agent session clear claude-session-1 --source claude-code
node /path/to/resources/aiopsterm-control.js feed list
node /path/to/resources/aiopsterm-control.js feed mark-handled
node /path/to/resources/aiopsterm-control.js feed clear-ended
node /path/to/resources/aiopsterm-control.js feed clear --yes
node /path/to/resources/aiopsterm-control.js agent team launch --source codex --count 3 --cwd "$PWD" --prompt "review this repo"
node /path/to/resources/aiopsterm-control.js agent team launch --source claude-code --count 2 --cwd "$PWD" --prompt "investigate flaky tests"
node /path/to/resources/aiopsterm-control.js agent team launch --source custom --count 2 --command "my-agent --role reviewer --index {{index}}"
node /path/to/resources/aiopsterm-control.js agent vault register --id my-agent --name "My Agent" --process-name my-agent --session-option --session --launch-command "my-agent --cwd {{cwd}} --index {{index}} {{prompt}}" --resume-command "my-agent --session {{sessionId}}"
node /path/to/resources/aiopsterm-control.js agent vault render --id my-agent --kind resume --session session-1
node /path/to/resources/aiopsterm-control.js agent vault identify --process-name my-agent --argv /usr/local/bin/my-agent --argv --session --argv session-1
node /path/to/resources/aiopsterm-control.js agent vault scan --source my-agent --panel panel-main
node /path/to/resources/aiopsterm-control.js agent team launch --source my-agent --count 3 --cwd "$PWD" --prompt "review this repo"
node /path/to/resources/aiopsterm-control.js events --category notification --cursor-file ~/.cache/aiopsterm/events.seq --limit 10
node /path/to/resources/aiopsterm-control.js tree
node /path/to/resources/aiopsterm-control.js terminal read-screen --lines 40
node /path/to/resources/aiopsterm-control.js capture-pane --panel panel-main --lines 200
node /path/to/resources/aiopsterm-control.js pipe-pane --panel panel-main --command "grep ERROR"
node /path/to/resources/aiopsterm-control.js clear-history --panel panel-main
node /path/to/resources/aiopsterm-control.js respawn-pane --panel panel-main --command 'exec ${SHELL:-/bin/bash} -l'
node /path/to/resources/aiopsterm-control.js terminal focus --panel panel-main
node /path/to/resources/aiopsterm-control.js terminal send --session "$AIOPSTERM_TERMINAL_SESSION_ID" --text $'pwd\n'
node /path/to/resources/aiopsterm-control.js terminal send-key --session "$AIOPSTERM_TERMINAL_SESSION_ID" ctrl+c
node /path/to/resources/aiopsterm-control.js send-panel --panel panel-main "echo hello\n"
node /path/to/resources/aiopsterm-control.js send-key-panel --panel panel-main enter
node /path/to/resources/aiopsterm-control.js wait-for build-ready --timeout 30
node /path/to/resources/aiopsterm-control.js wait-for --signal build-ready
node /path/to/resources/aiopsterm-control.js display-message "deploy done"
node /path/to/resources/aiopsterm-control.js display-message --print "deploy done"
node /path/to/resources/aiopsterm-control.js set-buffer --name deploy "kubectl rollout status deploy/api"
node /path/to/resources/aiopsterm-control.js list-buffers
node /path/to/resources/aiopsterm-control.js paste-buffer --name deploy --panel panel-main
node /path/to/resources/aiopsterm-control.js set-status build compiling --priority 80
node /path/to/resources/aiopsterm-control.js set-progress 0.5 --label "Building"
node /path/to/resources/aiopsterm-control.js log --level success --source test "All green"
node /path/to/resources/aiopsterm-control.js sidebar-state
node /path/to/resources/aiopsterm-control.js notify --title "Build done" --body "All tests passed"
node /path/to/resources/aiopsterm-control.js list-notifications
node /path/to/resources/aiopsterm-control.js jump-to-unread
```

Use `--json` for scripting:

```bash
node /path/to/resources/aiopsterm-control.js --json workspace snapshot
```

## Safety Boundary

`system.capabilities`, `system.identify`, and CLI `rpc` are automation plumbing. The first two are read-only probes. `rpc` does not grant extra permission; it sends exactly the requested method and JSON object params through the same control socket dispatcher and inherits that method's safety policy.

`agent.hooks.*` reuses the same explicit installer used by Settings -> AI Preferences. It only writes aiopsterm-owned hook commands, plugin files, or marked config blocks, and uninstall removes only those owned entries. `setup` mirrors control_compat's convenience behavior by skipping installers whose agent binary is not on `PATH`; `install` is for an explicit selected source when the user wants the config written anyway. Hook commands fail open outside aiopsterm-managed local connection terminals and do not take over external OS terminals.

`terminal.send_text` and `terminal.send_key` are raw terminal input primitives, equivalent to typed text or a physical key press in the terminal. They do not run the existing AI command security approval flow, because they may need to send non-command input, prompts, or control sequences. Command-generation and AI-command execution still use the existing renderer security path.

`terminal.read_screen`, `capture-pane`, and `surface.read_text` read visible terminal buffer text from the renderer. The control event stream does not copy that text into event payloads. `pipe-pane` is a CLI-helper convenience: after reading the screen through the socket, the helper runs the user-provided shell command locally with the captured text on stdin.

Future higher-level automation commands should use the control socket but must choose their own safety policy explicitly. For example, a future `terminal.run_command` command can route through command security, while `terminal.send_text` remains raw input.

`sync.wait_for` is an in-process local rendezvous primitive for scripts talking to the same running aiopsterm app. Token names are limited to letters, numbers, `.`, `_`, `:`, and `-`; they are not filesystem paths and are not shared across app restarts. Signaling wakes all current waiters and leaves a bounded one-shot signal for a later waiter. Timeouts return `WAIT_FOR_TIMEOUT`.

`terminal.buffer.*` stores named text snippets in memory in the running main process. It is a tmux/control_compat compatibility primitive, not the OS clipboard and not persisted across app restarts. `paste-buffer` writes the stored text through the same raw-input boundary as `terminal.send_text`.

`terminal.clear_history` is renderer-owned because xterm state lives in the active window. It clears the selected terminal surface's visible buffer and aiopsterm's retained panel output; it does not send a command to the shell and does not close or restart the PTY/SSH session.

`terminal.respawn` is also renderer-owned. Unlike raw `terminal.send_text`, it routes the restart command through aiopsterm terminal command security and may return a `needs-approval` decision instead of writing to the shell. It does not close the PTY or SSH channel by itself; the command text controls whether the running shell process is replaced.

`sidebar.*` metadata is a lightweight automation state source, not a command runner. It is stored in memory in the main process, exposed through the socket and events stream, and scoped by `workspaceId` with the current shared work panel defaulting to `main`. The current slice does not force a new right-sidebar UI; renderer surfaces or future MCP tools can consume the metadata through `sidebar.state`.

Agent Hibernation is off by default and only targets coding-agent sessions that were discovered inside aiopsterm-created local connection terminals. `agent.hibernate` asks the renderer to close the owning terminal backend session and then records hibernation metadata in the managed AI session store. It refuses sessions that currently need input or have no resume command. `agent.resume` writes the stored resume command through the same renderer terminal command path used by AI session recovery, so risky commands still pass through terminal command safety approval before any bytes are written to the shell.

The automatic reaper follows the same safety boundary. `agent-hibernation.sweep` only considers live restorable managed AI sessions with resume commands. It never touches the currently visible terminal panes, sessions that need input, running/working sessions, ended sessions, or non-aiopsterm terminal processes. It only selects candidates when live restorable sessions exceed `maxLiveTerminals`, then chooses the oldest idle background candidates just far enough to get back under the limit.

By default `sweep` uses the configured `confirmationSeconds` settle window. The first pass records a compact fingerprint based on session id, terminal session id, lifecycle, state, terminal process id, and agent process facts. A later pass hibernates only if the same candidate is still selected and the fingerprint is unchanged after the confirmation deadline. Terminal text and command output are not stored in this fingerprint or event payload. Scripts can use `agent-hibernation.preview` to inspect candidates without changing state, or `agent-hibernation sweep --no-confirm` for deterministic test automation.

`agent.team.launch` is visible automation. Every created team member is a real local terminal surface, and every launch command is written through the existing renderer terminal command path. If command security requires approval, the member is returned with `status: "needs-approval"` and the normal terminal security prompt is shown. The command builder supports `source=codex`, `source=claude-code`, and `source=custom`. Custom commands may use `{{index}}`, `{{cwd}}`, `{{prompt}}`, `{{role}}`, and `{{model}}` placeholders.

The current Teams slice intentionally stops at visible local-terminal orchestration. control_compat's deeper Codex Teams app-server watcher, which bridges Codex private app-server approvals into Feed, is a separate integration because it owns a private Codex websocket lifecycle and approval response mapping.

`agent.session.*` operates only on the managed AI session store built from hooks/events emitted by agents running in aiopsterm-created local connection terminals. It does not close terminal panels, kill agent processes, disconnect SSH sessions, or take ownership of the visible terminal connection. `clear` removes the AI session manager record only. `reply` records a compact decision; for blocking Claude Code hooks it may resolve the waiting hook through the existing managed-session backend, while stock Codex permission events remain visibility-only because Codex keeps its native approval path. Session summaries intentionally omit raw hook payloads, terminal screen text, typed input, and command output.

`agent.session.bulk` and `feed.*` are batch operations over the same managed session records. `mark-handled` can resolve waiting Claude Code hooks as locally handled, while `clear-ended` and `clear-all` remove only aiopsterm's AI session records. `clear-all` requires an explicit confirmation flag (`confirm=true` or CLI `--yes`) and still does not kill agent processes or terminal panels.

`surface.resume.*` is restore metadata, not a live process checkpoint. aiopsterm stores a bounded command binding on a visible surface and exposes it through `surface.list`, `surface.current`, and `workspace.snapshot`. Public CLI/socket-created bindings are manual by default; setting `autoResume=true` alone does not authorize automatic execution. A binding becomes auto-runnable only after `surface.resume.trust --policy auto`, which records a command fingerprint and trust metadata on that binding. `surface.resume.preview` reports `ready`, `manual`, `untrusted`, or `terminal-not-connected` reasons before anything runs.

`surface.resume.run` and `surface.resume.autorun` both use the same terminal command security path as AI-generated terminal commands. If the configured command policy requires approval, the normal terminal approval prompt appears before any bytes are written to the shell. Environment values supplied with the binding are optional and obvious sensitive keys such as token, password, secret, credential, auth, bearer, and API key names are dropped before storage.

`session.restore` restores layout and metadata; it does not checkpoint arbitrary live process state. Local terminal panels are recreated as new local shells in the saved working directory. SSH panels are restored as disconnected surfaces with their connection metadata so the user can explicitly reconnect. Saved resume bindings are restored for inspection and manual `surface.resume.run`, but aiopsterm does not automatically run resume commands from a session snapshot.

## Events

`events.stream` mirrors the useful part of control_compat's event stream contract for local tools. A client sends one request line and then keeps reading newline-delimited JSON frames on that same socket. The first frame is always:

```json
{"type":"ack","protocol":"aiopsterm-events","version":1}
```

After the ack, aiopsterm sends retained replay events whose `seq` is greater than `after_seq`, then live events and optional heartbeat frames. The stream supports `after_seq` / `after`, `names` / `name`, `categories` / `category`, and `include_heartbeats=false`. `events.list` accepts the same filters plus `limit`.

Current event categories are:

- `notification`: generic control notifications created, opened, marked read, dismissed, or cleared.
- `terminal`: control-socket terminal focus and raw text-send effects. Text payloads include lengths/byte counts only, not the raw terminal input.
- `workspace`: workspace-group mutations.
- `surface`: surface resume mutations.
- `agent`: hibernation and visible agent-team automation mutations.

Events are appended to `<userData>/control/events.jsonl` and the app reloads the newest 4,096 events on startup for replay. `seq` continues from the largest durable event sequence, so cursor files remain useful across app restarts. Clients should still refresh state from `workspace.snapshot`, `surface.list`, and `notification.list` when `ack.resume.gap` is true, because the replay window is bounded.

Notification event payloads include bounded title previews and content lengths; they do not copy full notification bodies into the event stream or JSONL audit log. Terminal input events store lengths and byte counts only, not raw terminal text.

## Agent Vault

Agent Vault is aiopsterm's custom-agent registry for local-terminal automation. It is inspired by control_compat Vault's custom agent registrations. The current aiopsterm slice stores command templates plus process-detection metadata, can identify an agent from a process snapshot supplied by the caller, and can scan visible aiopsterm local terminals on Linux. Pi and OMP are registered by default with `piSessionFile` session ids and `{{executable}} --session {{sessionId}}` resume/fork commands.

`agent.vault.scan` asks the renderer for current visible local terminal summaries, including shell `processId`, optional `processGroupId`, shell name, cwd, panel id, and terminal session id. On Linux, the main process then reads `/proc` only for descendant processes of those known shell PIDs. It does not scan unrelated process trees, SSH remote shells, external OS terminals, or the embedded right-side Codex panel. On non-Linux platforms the command returns an empty unsupported result until a platform-specific process reader is added.

For agents that use `sessionIdSource: { "type": "piSessionFile" }`, scan also checks each matched descendant's open file descriptors under the registered `sessionDirectory` to recover the exact session path. This is a bounded read-only inspection used only for resume/fork command rendering.

Definitions are stored under the app user-data control directory as `agent-vault.json`. A definition includes:

- `id`: stable lowercase id used by `agent team launch --source <id>`.
- `name`: display name used for generated workspace group titles.
- `builtIn`: true for built-in defaults such as Pi and OMP. Built-in entries appear in `agent.vault.list` but are not written as user records when the vault file is persisted.
- `executable`: optional executable placeholder value.
- `detect`: optional process detection rule with `processName`, `argvContains`, `executableContains`, and `commandContains`.
- `sessionIdSource`: optional native session id source. Supported types are `provided`, `argvOption`, `env`, `fixed`, and `piSessionFile`.
- `launchCommand`: template used by visible team launch.
- `resumeCommand`: template for external scripts that need to resume a native session.
- `forkCommand`: template for external scripts that support branching a session.
- `sessionDirectory`: optional default for `{{sessionDir}}`.
- `cwd`: `preserve` or `ignore` for whether identified process cwd should be passed into resume/fork template rendering.

`agent.vault.identify` accepts fields such as `processName`, `executable`, `argv`, `commandLine`, `cwd`, `env`, `pid`, `ppid`, `pgid`, `sessionId`, and `sessionPath`, or the same fields under a `process` object. It returns matched agents, the extracted `sessionId`, and rendered `resumeCommand`/`forkCommand` when possible. `agent.vault.scan` returns the same match shape plus terminal ownership fields such as `panelId`, `terminalSessionId`, `terminalTitle`, and `terminalProcessId`. Both commands are read-only and do not grant Vault authority to kill, close, or resume any terminal.

Supported placeholders are `{{agentId}}`, `{{agentName}}`, `{{executable}}`, `{{cwd}}`, `{{prompt}}`, `{{role}}`, `{{model}}`, `{{index}}`, `{{count}}`, `{{sessionId}}`, `{{sessionPath}}`, and `{{sessionDir}}`.

When `agent team launch --source <registered-id>` is called, the main process renders static placeholders and forwards the request to the existing renderer `agent.team.launch` path as `source=custom`. Dynamic placeholders such as `{{index}}` are preserved for the renderer to expand per visible terminal. The final command is still written through aiopsterm terminal command security, so risky commands keep the same approval behavior as built-in team launch.

## Generic Notifications

Generic notifications are stored in the main process memory queue. They are separate from managed AI session notifications, but both feed the same top-bar attention bell:

- Unread generic notifications become `control-notification` attention items.
- Opening a generic notification marks it read in the main queue.
- If the notification has a `panelId` or `sessionId`, opening it focuses that terminal panel.
- If no target terminal is available, aiopsterm still marks it read and shows a top notice.

The queue is intentionally not persisted in this slice. Session restore and persisted notification history will be handled by the later restore/metadata slices.

## Workspace Snapshot

`workspace.snapshot` is the canonical read model for later control_compat-style workspace groups, session restore, and team automation. It is intentionally read-only in this slice. The payload contains summaries only:

- `workspaces`: one logical `main` workspace for the shared work panel.
- `surfaces`: terminal panels and knowledge editor panels with active/split metadata.
- `terminals`: terminal-only summaries with connection, cwd, SSH target, and xterm size when available.
- `splitGroups`: grouped panel ids for split layouts.
- `workspaceGroups`: control_compat-style surface group metadata for the shared main work panel.
- `resumeBinding` / `resume_binding`: optional surface-level resume command metadata for each surface.
- `agentHibernation`: explicit hibernation config for managed AI sessions.
- `notifications`: generic control notifications currently held by the main process and synced into the renderer.
- `managedAiSessions`: Claude/Codex session summaries without full event transcripts.
- `attention`: top-bell pending items, including managed AI requests and unread generic notifications.
- `counts`: stable totals for scripts that only need status checks.

The snapshot does not include terminal screen text. Use `terminal.read_screen` for screen content after selecting a target `panelId` or `sessionId` from the snapshot.

## Workspace Groups

aiopsterm keeps the user's design constraint that the AI session manager and SSH/local terminal work share one main work panel. Because of that, `workspace.group.*` does not create a second primary workspace surface. It groups existing main-panel surfaces so external automation can name, focus, and restore related terminal/editor panels.

Group members are `panelId` values. For compatibility, CLI flags still use control_compat wording such as `--workspace`; aiopsterm resolves those values as either `panelId` or `sessionId`.

`workspace.group.delete` is destructive because it closes the member panels and attempts to kill any backing terminal sessions. It fails unless the request includes `confirm=true`, or the CLI uses `--confirm`. Use `workspace.group.ungroup` when the intent is only to remove grouping metadata.

Group state is renderer memory in this slice. The later session restore slice will persist and restore group metadata alongside terminal/session state.

## Session Restore

Session snapshots are stored under `<userData>/control/session-snapshots.json`. A snapshot contains:

- terminal and knowledge surface ids, titles, working directories, split metadata, and active panel id.
- workspace group metadata for the shared main work panel.
- SSH connection metadata needed for explicit reconnect.
- surface resume bindings.

Snapshots do not include terminal screen text, typed input, command history, or full managed AI event transcripts. Restoring a snapshot replaces the visible main work-panel layout, closes existing live terminal sessions best-effort, starts saved local shell panels, and leaves saved SSH panels disconnected. This keeps restore visible and avoids silently reconnecting to remote hosts or running saved agent commands.
