# Product Sessions And Agents Mode

Agents is the single place to create, find, restore, close, and permanently delete Product Sessions. Open it from the dedicated Agents icon in the far-left SideRail. The `AI Sessions` module is a separate managed-agent inbox.

## Layout

Agents mode keeps four regions visible:

1. `SideRail` for Agents and normal module navigation.
2. `AgentsSidebar` for the Product Session catalog.
3. The same central `TerminalWorkspace` used by Terminal mode.
4. A fixed right `AiPanel` for Classic and Codex sessions.

The session list and right AI pane can be resized. The list can be collapsed from TopBar. The right AI pane cannot be closed in Agents mode; dragging it toward the edge clamps it to the minimum width. Selecting any normal SideRail module leaves Agents mode and opens that module.

## Session Actions

New Session offers Classic, Codex, and DB AI surfaces. Catalog rows show the conversation title, surface, binding, last activity time, and project or database scope. Search covers those metadata fields, and Load More reveals another 20 matching rows.

- Classic and Codex create, focus, and restore requests stay in Agents mode and open in the right AiPanel.
- A Codex restore reuses or reconnects its saved terminal and project cwd. With workspace following enabled, the bound terminal becomes active in the center.
- DB AI requests leave Agents mode, open DatabaseWorkspace, and restore the saved connection, database, and schema. A failed binding degrades to a read-only session with Retry.
- Close removes the UI tab or pane and stops its active runtime while preserving the Product Session for later restore.
- Delete permanently removes the native session, UI projection, and Product Session metadata after runtime cleanup succeeds.

Classic and DB AI restore at the newest message and scroll to the bottom. Scrolling upward loads older UI messages in cursor pages without moving the message currently under the pointer. Only a bounded set of message elements is mounted at once; loading older UI pages does not add them to Cline's model context.

Application startup restores no open Product Sessions. Closed sessions remain available only through the Agents catalog. Closing the final Classic, Codex, or DB AI session is valid and does not create a replacement.
