# Quick Commands

Quick Commands stores named command scripts in the main-process backend. Creating or editing a command must complete through the Quick Commands backend before the visible catalog changes. Running a saved command asks the backend to plan the script by snippet ID, so an edited command executes its latest saved name and content rather than a renderer-side draft or stale copy.

## Macro Recording

Start macro recording from the Quick Commands panel, then type in the active terminal. The recorder selects the active terminal panel when possible and otherwise falls back to an available terminal instead of binding to a Knowledge, chat, or other non-terminal panel.

Real xterm input enters the macro only after the terminal backend confirms the exact session and byte count. Rejected or malformed terminal writes are not recorded. Captured input is sent directly to the macro state machine and is not appended to the renderer's terminal output history, so normal PTY echo remains the only visible command echo.

Pressing Return commits the current input line. Supported control keys can be recorded when control-key capture is enabled. Stopping a non-empty recording saves the timestamped entries as a new backend-owned Quick Command; cancelling discards the recording.

## Editing And Running

The edit form saves the existing snippet ID with the new name, script content, and group. A later Run or Paste action requests a fresh backend script plan for that same ID. The plan is accepted only when its snippet ID, snippet name, execution mode, command list, and shell text match the request; invalid or stale-looking plans are rejected without writing to a terminal.

Run submits all planned commands. Paste leaves the final command unsubmitted. `sleep==milliseconds` delays the following segment, and a failed terminal write stops all remaining segments.
