# Assets And Workspace Resources

The Assets module opens as a main workspace, not as a narrow left-side panel.

- The Assets workspace uses top tabs for `主机管理`, `组织资产管理`, and `密钥管理`.
- Double-clicking a host card creates a real SSH terminal through the preload/backend terminal bridge, then returns to the terminal workspace so the new tab is visible.
- Failed SSH creation leaves the Assets workspace open and shows the backend error instead of fabricating a terminal tab.
- Host creation and edit forms support password/key authentication, keychain selection, configured SSH proxy selection, and jump-host selection.
- Asset import, export, organization refresh, organization asset table edits, key management, and connection tests use backend-owned result envelopes.

The Workspace resource tree is the terminal-side resource launcher.

- `直接连接` and `堡垒机资源` are tree tabs with nested groups.
- Right-click blank tree space to create a top-level group or host.
- Right-click a group to create a child group or host, edit/delete custom groups, refresh organization resources, or open organization management.
- Drag hosts or custom groups onto another group to move them. Dragging to blank tree space restores them to top level or default grouping.
- Recently connected hosts are maintained from successful connections and capped at 10 entries.
