# Quick Commands And Macro Recording

aiopsterm offers several command paths, from one command to multi-host operations. Quick Commands keep reusable scripts in the main-process backend, macro recording turns real terminal input into a replayable script, and AI Command or Agent handles one-off generation and multi-step diagnosis.

## Where To Open It

Click **Quick Commands** on the module rail. Use the left toolbar controls for groups and the right **New** control for the editor. Open the target terminal before pressing a row's run action. Type `/` in the AI composer and click a popup command to reference it. Start macro recording from the toolbar recording control, then return to the terminal and perform the sequence.

## Choose The Right Command Path

| Need | Recommended entry | Execution model |
| --- | --- | --- |
| You know the command and want a fast input | Terminal context menu -> Input Command | Floating input closes after a successful write |
| Ask AI for one command | Terminal context menu -> AI Command, or Classic Command | Shows an editable command card before manual execution |
| Run a multi-step diagnosis | Classic Agent or Host Agent | Calls tools step by step under the security and approval policy |
| Repeat a fixed operation | Quick Commands | Run submits all steps; Paste leaves the final step for confirmation |
| Run one diagnostic in several terminals | Global Execution | Broadcasts only to the terminals you selected |
| Call desktop capabilities from automation | `aio` control commands | Uses the local control socket for execution and notifications |

> Safety: before Global Execution, verify every target terminal's host, user, and working directory. Never broadcast destructive writes across mixed environments.

## Panel Overview

![Quick commands panel](../images/quick-commands.png)

- **① 命令/分组 (Commands / Groups)** — flat list or grouped browsing.
- **② Toolbar buttons** — new command, record macro, search.
- **③ Command item** — hover for Run, Paste, and edit actions.

## Writing Reliable Quick Commands

- Create/edit completes through the backend before the catalog changes; Run plans the script by **snippet ID**, so it always executes the latest saved content — never a stale renderer draft.
- `Run` submits all command segments; `Paste` leaves the final command unsubmitted, ideal when you need to tweak parameters before pressing Enter.
- Use `sleep==milliseconds` between segments to wait for the previous step to take effect (e.g. service restart, then status check).
- A failed terminal write stops all remaining segments — half a script never lands in the wrong session.

Organization tips:

- Group by scenario: inspection, release, database, incident.
- Name as verb + object: "restart nginx and verify", "capture JVM thread dump".
- Do not make destructive one-click Run commands; use Paste mode so a human presses Enter.

## Macro Recording

1. Start recording from the Quick Commands panel; the recorder binds to the active terminal pane (never a Knowledge or chat panel).
2. Work in the terminal as usual. Only input confirmed by the terminal backend (exact session and byte count) enters the macro; rejected or malformed writes are excluded.
3. Return commits the current line; supported control keys can be captured when enabled.
4. Stop saves a timestamped backend-owned quick command; cancel discards it.

> Note: captured input feeds the macro state machine directly and is not appended to the terminal's visible history — the PTY echo remains the only echo you see.

## Referencing In AI Chat

Type `/` in the AI composer to insert a quick command as a mention, letting the AI explain or adapt your existing scripts.

## Multi-Terminal And Automation Scenarios

- **Global Execution** in the terminal context menu works well for the same read-only check across comparable hosts. Open or split the intended terminals, select the exact scope, then send.
- Classic Command creates one proposal. Switch to Agent when the next step depends on observed output instead of compressing a multi-step workflow into one opaque shell command.
- External scripts can use the `aio` CLI to inspect UI state, write terminal commands, and send notifications. Run `aio --help` for the subcommands supported by the installed build. Resolve the terminal ID with a read-only query first and pass that target explicitly instead of relying on UI focus.

Previous: [AI Session Management](05-ai-sessions.md) · Next: [Keyboard Shortcuts](07-shortcuts.md) · [Back to index](../index.md)
