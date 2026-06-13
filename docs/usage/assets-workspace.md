# Assets And Workspace Resources

The Assets module opens as a main workspace, not as a narrow left-side panel.

- The Assets workspace uses top tabs for `主机管理`, `密钥管理`, and `代理管理`. Organization asset management is intentionally not a top tab; open it from a bastion/organization host context menu.
- Double-clicking a host card creates a real SSH terminal through the preload/backend terminal bridge, then returns to the terminal workspace so the new tab is visible.
- Failed SSH creation leaves the Assets workspace open and shows the backend error instead of fabricating a terminal tab.
- Host creation and edit forms support password/key authentication, keychain selection, configured SSH proxy selection, and jump-host selection. The host form can open real key, proxy, or jump-host creation flows; key/proxy creation from the Assets workspace returns to the host form and preselects the created resource.
- Asset import, export, organization refresh, organization asset table edits, key management, and connection tests use backend-owned result envelopes.

The Workspace resource tree is the terminal-side resource launcher.

- `直接连接` and `堡垒机资源` are tree tabs with nested groups.
- Right-click blank tree space to create a top-level group or host.
- Right-click a group to create a child group or host, edit/delete custom groups, refresh organization resources, or open organization management. Host creation inherits the right-click target group instead of asking for a separate group in the creation form.
- Drag hosts or custom groups onto another group to move them. Dragging to blank tree space restores them to top level or default grouping. Successful move actions update the tree without a persistent success toast; failures still surface an error.
- Recently connected hosts are maintained from successful connections and capped at 10 entries.

The Files workspace is a dedicated file-management workspace.

- It opens directly into file-management modes instead of showing a duplicate top tab strip for Host/Key/File management.
- File session rows are derived from the same asset catalog used by the Workspace resource tree, then merged with user-created file-only sessions. Asset folders remain the source of truth for folder-bound file sessions; moving, removing, creating, editing, or deleting bastion file folders writes through the asset-folder backend so the Workspace and Files trees stay aligned after refresh.
- File row hover actions are anchored in the row action area so they do not cover the file or directory name.
- Permission editing uses the shared modal style with grouped owner/group/public permission controls and keeps backend mutation validation before reporting success.
