# aiopsterm Control Socket

aiopsterm exposes a local newline-delimited JSON control socket for automation that needs to operate on terminal panels opened by aiopsterm. This is the control_compat-style automation layer: scripts talk to a socket, the main process handles routing, and renderer windows provide UI-only state such as terminal panels and xterm screen text.

## Scope

The first control-socket slice supports these terminal primitives:

- `ping`: verify that the socket is reachable.
- `terminal.list`: list visible terminal panels.
- `terminal.focus`: focus a terminal panel by `panelId` or `sessionId`.
- `terminal.read_screen`: read recent visible xterm buffer text from a terminal panel.
- `terminal.send_text`: send raw text to a connected terminal session by `sessionId`.

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

The Agent Hibernation slice adds explicit managed-agent lifecycle controls:

- `agent-hibernation.status`: return the current hibernation config, managed session summaries, and a workspace snapshot.
- `agent-hibernation.on` and `agent-hibernation.off`: enable or disable explicit hibernation controls.
- `agent.status`: alias for `agent-hibernation.status`.
- `agent.hibernate`: hibernate one managed AI session by `sessionId`, with optional `source` when ids are ambiguous.
- `agent.resume`: focus one managed AI session and write its stored resume command into the owning local terminal.

The Agent Teams slice adds control_compat-style multi-agent launch primitives for aiopsterm local connection terminals:

- `agent.team.launch`: create one or more visible local terminal surfaces, start local shells, write each agent launch command through terminal command security, and group the created surfaces.

This starts agents in terminals owned by aiopsterm's main work panel. It does not manage the embedded right-side Codex panel and does not use external OS terminals.

The surface resume slice adds control_compat-style resume bindings for visible work-panel surfaces:

- `surface.resume.set`: attach a resume command to the current or selected surface.
- `surface.resume.get` / `surface.resume.show`: read the selected surface's resume binding.
- `surface.resume.clear`: remove a binding, optionally guarded by checkpoint/source.
- `surface.resume.run`: explicitly write the stored command into the selected terminal through aiopsterm terminal command security.

The events slice adds a control_compat-style local JSONL stream for automation:

- `events.stream` / `event.subscribe`: take over the socket connection and stream `ack`, replayed `event`, live `event`, and `heartbeat` frames.
- `events.list`: list retained events for simple polling and tests.

The Agent Vault slice adds custom agent launch metadata for visible local-terminal automation:

- `agent.vault.register`: register a custom agent id and command templates.
- `agent.vault.list`: list registered custom agents.
- `agent.vault.get`: read one custom agent definition.
- `agent.vault.render`: render a launch, resume, or fork command from a template.
- `agent.vault.remove`: remove one custom agent definition.

Aliases are accepted for control_compat-compatible scripts where useful:

- `tree` and `top` map to `workspace.snapshot`.
- `list_workspaces` and `list-workspaces` map to `workspace.list`.
- `list_surfaces` and `list-surfaces` map to `surface.list`.
- `list_terminals` and `debug.terminals` map to `terminal.list`.
- `focus_terminal` and `focus-panel` map to `terminal.focus`.
- `read-screen` maps to `terminal.read_screen`.
- `send` and `send-panel` map to `terminal.send_text`.
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
node /path/to/resources/aiopsterm-control.js workspace snapshot
node /path/to/resources/aiopsterm-control.js workspace-group list
node /path/to/resources/aiopsterm-control.js workspace-group create --name "deploy" --from panel-1,panel-2
node /path/to/resources/aiopsterm-control.js workspace-group focus workspace_group:1
node /path/to/resources/aiopsterm-control.js surface list
node /path/to/resources/aiopsterm-control.js surface resume set --kind tmux --checkpoint work --shell "tmux attach -t work"
node /path/to/resources/aiopsterm-control.js surface resume show --json
node /path/to/resources/aiopsterm-control.js surface resume run --panel panel-main
node /path/to/resources/aiopsterm-control.js surface resume clear --checkpoint work
node /path/to/resources/aiopsterm-control.js agent-hibernation status
node /path/to/resources/aiopsterm-control.js agent-hibernation on
node /path/to/resources/aiopsterm-control.js agent hibernate --session codex-session-1 --source codex
node /path/to/resources/aiopsterm-control.js agent resume --session codex-session-1 --source codex
node /path/to/resources/aiopsterm-control.js agent team launch --source codex --count 3 --cwd "$PWD" --prompt "review this repo"
node /path/to/resources/aiopsterm-control.js agent team launch --source claude-code --count 2 --cwd "$PWD" --prompt "investigate flaky tests"
node /path/to/resources/aiopsterm-control.js agent team launch --source custom --count 2 --command "my-agent --role reviewer --index {{index}}"
node /path/to/resources/aiopsterm-control.js agent vault register --id my-agent --name "My Agent" --launch-command "my-agent --cwd {{cwd}} --index {{index}} {{prompt}}" --resume-command "my-agent --session {{sessionId}}"
node /path/to/resources/aiopsterm-control.js agent vault render --id my-agent --kind resume --session session-1
node /path/to/resources/aiopsterm-control.js agent team launch --source my-agent --count 3 --cwd "$PWD" --prompt "review this repo"
node /path/to/resources/aiopsterm-control.js events --category notification --cursor-file ~/.cache/aiopsterm/events.seq --limit 10
node /path/to/resources/aiopsterm-control.js tree
node /path/to/resources/aiopsterm-control.js terminal read-screen --lines 40
node /path/to/resources/aiopsterm-control.js terminal focus --panel panel-main
node /path/to/resources/aiopsterm-control.js terminal send --session "$AIOPSTERM_TERMINAL_SESSION_ID" --text $'pwd\n'
node /path/to/resources/aiopsterm-control.js notify --title "Build done" --body "All tests passed"
node /path/to/resources/aiopsterm-control.js list-notifications
node /path/to/resources/aiopsterm-control.js jump-to-unread
```

Use `--json` for scripting:

```bash
node /path/to/resources/aiopsterm-control.js --json workspace snapshot
```

## Safety Boundary

`terminal.send_text` is a raw terminal input primitive, equivalent to text typed into the terminal. It does not run the existing AI command security approval flow, because it may need to send non-command input, prompts, or key sequences. Command-generation and AI-command execution still use the existing renderer security path.

Future higher-level automation commands should use the control socket but must choose their own safety policy explicitly. For example, a future `terminal.run_command` command can route through command security, while `terminal.send_text` remains raw input.

Agent Hibernation is also explicit. It is off by default and only targets coding-agent sessions that were discovered inside aiopsterm-created local connection terminals. `agent.hibernate` asks the renderer to close the owning terminal backend session and then records hibernation metadata in the managed AI session store. It refuses sessions that currently need input or have no resume command. `agent.resume` writes the stored resume command through the same renderer terminal command path used by AI session recovery, so risky commands still pass through terminal command safety approval before any bytes are written to the shell.

This hibernation slice does not implement an automatic idle reaper. Automatic hibernation needs reliable terminal activity sampling and a user-visible confirmation window before aiopsterm kills a process group.

`agent.team.launch` is visible automation. Every created team member is a real local terminal surface, and every launch command is written through the existing renderer terminal command path. If command security requires approval, the member is returned with `status: "needs-approval"` and the normal terminal security prompt is shown. The command builder supports `source=codex`, `source=claude-code`, and `source=custom`. Custom commands may use `{{index}}`, `{{cwd}}`, `{{prompt}}`, `{{role}}`, and `{{model}}` placeholders.

The current Teams slice intentionally stops at visible local-terminal orchestration. control_compat's deeper Codex Teams app-server watcher, which bridges Codex private app-server approvals into Feed, is a separate integration because it owns a private Codex websocket lifecycle and approval response mapping.

`surface.resume.*` is restore metadata, not a live process checkpoint. aiopsterm stores a bounded command binding on a visible surface and exposes it through `surface.list`, `surface.current`, and `workspace.snapshot`. Public CLI/socket-created bindings are manual by default; aiopsterm does not auto-run them when the app restarts. `surface.resume.run` is an explicit action and uses the same terminal command security path as AI-generated terminal commands. Environment values supplied with the binding are optional and obvious sensitive keys such as token, password, secret, credential, auth, bearer, and API key names are dropped before storage.

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

Agent Vault is aiopsterm's custom-agent registry for local-terminal automation. It is inspired by control_compat Vault's custom agent registrations, but the current aiopsterm slice is intentionally limited to command templates. It does not inspect process tables or discover native session ids by itself.

Definitions are stored under the app user-data control directory as `agent-vault.json`. A definition includes:

- `id`: stable lowercase id used by `agent team launch --source <id>`.
- `name`: display name used for generated workspace group titles.
- `executable`: optional executable placeholder value.
- `launchCommand`: template used by visible team launch.
- `resumeCommand`: template for external scripts that need to resume a native session.
- `forkCommand`: template for external scripts that support branching a session.
- `sessionDirectory`: optional default for `{{sessionDir}}`.

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
