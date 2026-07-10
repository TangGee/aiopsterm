# AI Sessions

The `AI 会话` module is the left-side index for managed coding-agent sessions. It keeps row double-click focused on the existing terminal behavior: locate the owning terminal when it is open, or restore a restorable idle/history session by writing its resume command into a local terminal.

Local history import scans supported agent stores without a fixed recent-session cap, so older projects and child conversations remain available after refresh instead of being hidden behind a global count limit.

Child/internal conversations imported from vibe-coding tools are review-only. They appear indented under their parent session when the local agent store exposes a parent id; only unparented child rows fall back to a separate `未归属子会话` branch. Child rows use lighter styling and omit main-session status metadata such as project path, git branch, and approval state. These rows can open `打开会话内容`, but they cannot be resumed or hibernated because they are not valid top-level agent sessions.

The session library can be viewed three ways: grouped by project, grouped by AI agent type, or ungrouped in pure last-activity order. Project groups are ordered by the newest session or child session inside them, and sessions inside each group use the same newest-first ordering. Project and AI-type collapsed states are remembered locally.

To browse or edit a session transcript, right-click a session row and choose `打开会话内容`. aiopsterm opens a main workspace panel for that session, reusing the same workspace area as terminal and knowledge panels instead of opening a drawer, while keeping the left `AI 会话` index selected for continued browsing.

The content workspace is organized as one readable full-record stream. It loads records incrementally, so opening a large transcript renders the first page quickly and appends more records as the user scrolls, the viewport needs more rows, or search prefetch needs more candidates. There is no separate `Load more` pagination button, and this is not a fixed transcript-size cap. Cards keep the extracted session order and use role labels such as `User`, `Assistant`, `System`, `Developer`, `Tool`, `Reasoning`, `Metadata`, and `Event` to explain what each record is. System/developer prompts, metadata, tool events, reasoning, file snapshots, long records, and truncated records are collapsed by default; use the inline `展开完整内容` button at the end of a collapsed preview to load and edit the full text. Use the per-record large-editor button to open the same record in a larger modal for easier reading and editing. Codex and Claude Code JSONL transcript records are extracted from text-bearing fields in the local transcript file, while protocol fields such as `type` and ids are skipped. Codex runtime-only context summaries such as `turn_context.summary = auto` are filtered out, and Codex tool calls and tool results remain separate timeline records labelled as `tool call` and `tool result`. OpenCode records come from text/reasoning parts in `opencode.db`. Other supported AI sources show stored managed-session events until a source-specific transcript adapter exists.

Editing rules:

- Codex and Claude Code JSONL text records can be edited regardless of whether the session is idle, running, or waiting for input.
- OpenCode `text` and `reasoning` parts can be edited regardless of the managed-session state.
- Non-text records and event-only fallback rows are read-only.
- Saving checks the source revision first. If the transcript changed on disk, reload the content panel before saving again.
- Deleting an editable content record uses the same source-revision check and creates a local backup before changing the transcript. JSONL records delete the selected text field and may remove the whole transcript line if no browseable text remains; OpenCode records delete the selected `part`.
- After a save or delete succeeds, restart that AI conversation before expecting the agent to use the changed transcript. An already running agent can retain conversation context in memory even though the local transcript changed on disk.
- Switching record views or refreshing the content panel with unsaved edits asks before discarding the local edit.

Before writing, aiopsterm creates a backup under the app user data directory:

```text
agent-sessions/content-backups/<source>/<session>/
```

Use the normal tab close button to close a content workspace panel. Closing the content panel does not close or end the owning AI session or terminal. Closing the owning terminal tab is different: aiopsterm asks Main to terminate that PTY first, removes the tab only after termination succeeds or Main confirms that the PTY is already gone, and then records the AI session as ended. If termination fails, the terminal tab remains open and the error is shown.
