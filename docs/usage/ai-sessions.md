# AI Sessions

The `AI 会话` module is the left-side index for managed coding-agent sessions. It keeps row double-click focused on the existing terminal behavior: locate the owning terminal when it is open, or restore a restorable idle/history session by writing its resume command into a local terminal.

To browse or edit a session transcript, right-click a session row and choose `打开会话内容`. aiopsterm opens a main workspace panel for that session, reusing the same workspace area as terminal and knowledge panels instead of opening a drawer.

The content workspace is organized as one readable full-record stream. Cards keep the extracted session order and use role labels such as `User`, `Assistant`, `System`, `Developer`, `Tool`, `Reasoning`, `Metadata`, and `Event` to explain what each record is. System/developer prompts, metadata, tool events, reasoning, file snapshots, long records, and truncated records are collapsed by default; use the inline `展开完整内容` button at the end of a collapsed preview to load and edit the full text. Use the per-record large-editor button to open the same record in a larger modal for easier reading and editing. Codex and Claude Code JSONL transcript records are extracted from text-bearing fields in the local transcript file, while protocol fields such as `type` and ids are skipped. Codex runtime-only context summaries such as `turn_context.summary = auto` are filtered out, and Codex tool calls and tool results remain separate timeline records labelled as `tool call` and `tool result`. OpenCode records come from text/reasoning parts in `opencode.db`. Other supported AI sources show stored managed-session events until a source-specific transcript adapter exists.

Editing rules:

- Running or pending-input sessions are read-only.
- Codex and Claude Code JSONL text records can be edited when the session is not active.
- OpenCode `text` and `reasoning` parts can be edited when the session is not active.
- Non-text records and event-only fallback rows are read-only.
- Saving checks the source revision first. If the transcript changed on disk, reload the content panel before saving again.
- Switching record views or refreshing the content panel with unsaved edits asks before discarding the local edit.

Before writing, aiopsterm creates a backup under the app user data directory:

```text
agent-sessions/content-backups/<source>/<session>/
```

Use the normal tab close button to close a content workspace panel. Closing the content panel does not close or end the owning AI session or terminal.
