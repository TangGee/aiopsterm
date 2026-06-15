# Assets And Workspace Resources

The Assets module opens as a main workspace, not as a narrow left-side panel.

- The Assets workspace uses top tabs for `主机管理`, `堡垒机管理`, `密钥管理`, and `代理管理`. Organization asset management can also be opened from a bastion/organization host context menu.
- Double-clicking a host card or SSH-capable bastion/organization entry creates a real SSH terminal through the preload/backend terminal bridge, then returns to the terminal workspace so the new tab is visible.
- Failed SSH creation leaves the Assets workspace open and shows the backend error instead of fabricating a terminal tab.
- Host creation is launched from the host tree context menu or empty-state action, not from a top `新建主机` toolbar button. Group context-menu creation pre-fills the target group.
- Right-click blank host-tree space to create a top-level directory. Right-click a group to create a child directory or host. Empty directories and child directories come from the backend asset-folder snapshot and remain visible after refresh.
- Direct host management always exposes a `主机` root group. Hosts with an empty or legacy `未分组` group are normalized into that root, and group counts include descendant hosts from child folders.
- Bastion management in the Assets workspace uses the same tree interaction model as host management: organization rows, bastion-scope folders, nested child folders, and assets share expand/collapse, filtering, and page selection behavior. Direct and bastion folders are separate backend-scoped trees; the backend rejects a child folder whose parent belongs to the other scope.
- Host-tree and key-management context menus close when focus moves outside the menu, matching the rest of the workspace floating-menu behavior.
- Host creation and edit forms support password/key authentication, keychain selection, configured SSH proxy selection, and jump-host selection. SSH proxy configs support HTTP/HTTPS CONNECT, SOCKS4/SOCKS5, and raw TCP socket forwarding. The raw TCP type is for an already-mapped proxy endpoint that forwards bytes directly to the target SSH service; it does not send target host metadata or proxy credentials. The host form opens real key, proxy, or jump-host creation in-place as a nested modal; successful creation returns to the host form and preselects the created resource. Form and confirmation modals stay open on backdrop clicks and close only through explicit close/cancel/submit actions; right-click context menus still close on outside clicks.
- Bastion entries can still refresh and manage organization assets, but the entry itself may also be launched as a normal SSH endpoint. If the bastion asks for a dynamic password or second factor during login, the terminal workspace displays the global keyboard-interactive verification dialog.
- In-form key creation uses the same larger modal style as key management and supports click or drag/drop key-file import through the backend local-file bridge. In-form jump-host creation uses the host modal layout, labels itself `新建跳板机`, and defaults to the same group as the host currently being created.
- The host form no longer accepts pasted private-key text directly. Keys are managed as KeyChain records through the backend keychain boundary.
- Asset import, export, organization refresh, organization asset table edits, modal key management, modal proxy management, and connection tests use backend-owned result envelopes. Import help opens a full modal; clicking import itself does not emit a toast unless a backend error or import result needs to be shown.

The Workspace resource tree is the terminal-side resource launcher.

- `直接连接` and `堡垒机资源` are tree tabs with nested groups.
- The direct tree includes a backend-backed `主机` root group. Blank-space host creation defaults to this group, while parent group counts include hosts inside child groups.
- Right-click blank tree space to create a top-level group or host.
- Right-click a group to create a child group or host, edit/delete custom groups, refresh organization resources, or open organization management. Host creation inherits the right-click target group instead of asking for a separate group in the creation form.
- Drag hosts or custom groups onto another group to move them. Dragging to blank tree space restores them to top level or default grouping. Successful move actions update the tree without a persistent success toast; failures still surface an error.
- Recently connected hosts are maintained from successful connections and capped at 10 entries.

The Files workspace is a dedicated file-management workspace.

- It opens directly into file-management modes instead of showing a duplicate top tab strip for Host/Key/File management.
- File session rows are derived from the same asset catalog used by the Workspace resource tree, then merged with user-created file-only sessions. Asset folders remain the source of truth for folder-bound file sessions; moving, removing, creating, editing, or deleting bastion file folders writes through the asset-folder backend so the Workspace and Files trees stay aligned after refresh.
- Missing remote SFTP starting directories fall back to the remote root through real SFTP listing, so dragging a remote host into Files does not show a fabricated or stale client fallback.
- The transfer panel no longer exposes a separate remote-connection close button; use the panel close control to clear a side. Dragging an asset or session into an empty side keeps a persistent selected state until drop or leave.
- File row hover actions are anchored in a dedicated row action column so they do not cover the file or directory name. The whole name cell opens directories, and symlink rows show the backend `readlink` target, can be clicked to attempt directory expansion, and are still blocked from copy/transfer drag starts.
- Cross-side file drag/drop targets the hovered real directory. Dropping onto a file, blank table area, or any non-directory target transfers into the current directory.
- File list headers stay fixed while scrolling and sort by name, size, or modified time with visible direction indicators. The `..` row navigates to the parent directory. Single-click selects files and links; double-click opens regular files, while directory and link rows still attempt directory navigation.
- Transfer and move failures are reported through the visible browser notice with the operation prefix, so backend errors are not hidden behind silent state changes. File browser notices auto-close after a short delay.
- Permission editing uses the shared modal style with grouped owner/group/public permission controls and keeps backend mutation validation before reporting success.
