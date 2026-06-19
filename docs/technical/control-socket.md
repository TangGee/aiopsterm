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
node /path/to/resources/aiopsterm-control.js surface list
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
- `notifications`: generic control notifications currently held by the main process and synced into the renderer.
- `managedAiSessions`: Claude/Codex session summaries without full event transcripts.
- `attention`: top-bell pending items, including managed AI requests and unread generic notifications.
- `counts`: stable totals for scripts that only need status checks.

The snapshot does not include terminal screen text. Use `terminal.read_screen` for screen content after selecting a target `panelId` or `sessionId` from the snapshot.
