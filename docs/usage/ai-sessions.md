# AI Sessions

For the task-oriented workflow, including project-file review and notification sounds, see [AI Session Management](best-practices/en-US/05-ai-sessions.md). Agent integrators should use the [developer integration guide](../developer/en-US/ai-notification-integration.md).

The `AI 会话` module is the left-side index for managed coding-agent sessions. It keeps row double-click focused on the existing terminal behavior: locate the owning terminal when it is open, or restore a restorable idle/history session by writing its resume command into a local terminal.

Local history import scans supported agent stores without a fixed recent-session cap, so older projects and child conversations remain available after refresh instead of being hidden behind a global count limit.

Child/internal conversations imported from vibe-coding tools are review-only. They appear indented under their parent session when the local agent store exposes a parent id; only unparented child rows fall back to a separate `未归属子会话` branch. Child rows use lighter styling and omit main-session status metadata such as project path, git branch, and approval state. These rows can open `打开会话内容`, but they cannot be resumed or hibernated because they are not valid top-level agent sessions.

The session library can be viewed three ways: grouped by project, grouped by AI agent type, or ungrouped in pure last-activity order. Project groups are ordered by the newest session or child session inside them, and sessions inside each group use the same newest-first ordering. Project and AI-type collapsed states are remembered locally.

To browse or edit a session transcript, right-click a session row and choose `打开会话内容`. aiopsterm opens a main workspace panel for that session, reusing the same workspace area as terminal and knowledge panels instead of opening a drawer, while keeping the left `AI 会话` index selected for continued browsing.

The content workspace keeps records in extracted session order and shows 20 records per page. The fixed footer provides first, previous, page-number, next, and last-page controls, so the record list itself only scrolls within the current page. Search covers the complete transcript on the backend and paginates matching records rather than filtering only the visible page. Opening a content panel loads once; switching to another workspace tab and back restores the current page, search, visible records, expanded records, and drafts without an automatic reload. Use the labelled `刷新` button when new records may have been appended by the running agent. The content workspace does not poll, watch the transcript, or automatically load appended records.

Cards use role labels such as `User`, `Assistant`, `System`, `Developer`, `Tool`, `Reasoning`, `Metadata`, and `Event` to explain what each record is. System/developer prompts, metadata, tool events, reasoning, file snapshots, long records, and truncated records are collapsed by default; use the inline `展开完整内容` button at the end of a collapsed preview to load and edit the full text. Use the per-record large-editor button to open the same record in a larger modal for easier reading and editing. Codex and Claude Code JSONL transcripts are extracted by declarative session parser rules. A complete record that matches no rule is shown as read-only raw JSON. The built-in Codex rule maps `session_meta.payload.base_instructions.text` to `system`, reads response-message roles, and keeps tool calls and tool results separate. OpenCode records come from text/reasoning parts in `opencode.db`. Settings -> AI Notifications -> Agent Hook Installer can override a built-in parser or add a read-only custom JSONL Agent; its question-mark button opens the complete rule schema and examples.

Editing rules:

- Codex and Claude Code JSONL text records can be edited regardless of whether the session is idle, running, or waiting for input.
- OpenCode `text` and `reasoning` parts can be edited regardless of the managed-session state.
- Non-text records and event-only fallback rows are read-only.
- Saving checks the source revision first. If the transcript changed on disk, reload the content panel before saving again.
- Deleting an editable content record uses the same source-revision check and creates a local backup before changing the transcript. JSONL records delete the selected text field and may remove the whole transcript line if no browseable text remains; OpenCode records delete the selected `part`.
- After a save or delete succeeds, restart that AI conversation before expecting the agent to use the changed transcript. An already running agent can retain conversation context in memory even though the local transcript changed on disk.
- Drafts are retained while moving between pages, changing search results, or switching workspace tabs. Manual refresh checks for drafts across all visited pages and asks before discarding them. Confirming refresh clears all drafts and reloads the current page; cancelling leaves the current records and drafts unchanged.

Before writing, aiopsterm creates a backup under the app user data directory:

```text
agent-sessions/content-backups/<source>/<session>/
```

Use the normal tab close button to close a content workspace panel. Closing the content panel does not close or end the owning AI session or terminal. Closing the owning terminal tab is different: aiopsterm asks Main to terminate that PTY first, removes the tab only after termination succeeds or Main confirms that the PTY is already gone, and then records the AI session as ended. If termination fails, the terminal tab remains open and the error is shown.
