# Product Terminology

This document defines the shared terms used when discussing aiopsterm UI and behavior.

## Layout Regions

| Chinese term | English/code term | Meaning |
| --- | --- | --- |
| 模块导航栏 | `SideRail` | The narrow icon-only rail at the far left. It switches top-level modules such as Workspace, Files, Assets, and Database, and also contains the dedicated Agents mode action. Agents is not a `ModuleKey`. |
| 左侧功能面板 | `ModulePanel` | The wider left panel next to the module rail. Its contents change with the active module. |
| Agents 会话列表 | `AgentsSidebar` | The Product Session catalog shown left of the main workspace in Agents mode. It restores or focuses Classic, Codex, and DB AI sessions; it is not a transcript renderer. |
| 资源面板 | `WorkspacePanel` | The Workspace module's left functional panel for hosts, groups, local connections, recent connections, and related resource actions. It is a concrete type of left functional panel. |
| 主工作区 | `MainWorkspace` | The central work area where terminal, file, asset, database, and other primary module work happens. In code this is usually represented by module-specific workspace components such as `TerminalWorkspace`, `FilesWorkspace`, and `AssetsWorkspace`. |
| AI 侧栏 | `AiPanel` | The right-side AI assistant area. It is separate from the main workspace and should not be called a terminal pane. |
| Agents 模式 | `mode-agents` | The shell layout `SideRail | AgentsSidebar | TerminalWorkspace | AiPanel`. The terminal workspace remains mounted and the right AiPanel is fixed visible. |
| AI 会话面板 | `AiSessionsPanel` | The managed-agent inbox opened by the `AI 会话` module action. It is distinct from the Agents Product Session catalog. |

## Workspace Tabs And Panes

| Chinese term | English/code term | Meaning |
| --- | --- | --- |
| 工作区标签栏 | `WorkspaceTabBar` | The tab card strip at the top of the main workspace. It contains workspace tabs and tab-level actions. |
| 工作区标签 | `WorkspaceTab` | One tab card in the workspace tab bar. It owns one normal workspace surface or one split layout group. |
| 会话标签 | `SessionTab` | A workspace tab whose content is a terminal or remote session. Use this term when the tab identity is tied to a shell, SSH, SFTP, database, or similar backend session. |
| 窗格 | `Pane` | One visible region inside a workspace tab after splitting. A workspace tab can contain one pane or multiple panes. |
| 终端窗格 | `TerminalPane` | A pane that renders a shell or SSH terminal. Split, reconnect, disconnect, command input, search, and terminal resize behavior should target the selected terminal pane. |

## Split Behavior Terms

| Chinese term | English/code term | Meaning |
| --- | --- | --- |
| 向右拆分 | `split-right` | Split the selected pane region vertically so the new pane appears on the right side of that selected region. It is not a global workspace split. |
| 向下拆分 | `split-down` | Split the selected pane region horizontally so the new pane appears below that selected region. It is not a global workspace split. |
| 取消拆分 | `unsplit` / `detach split` | Restore the selected split pane so it exclusively occupies its own workspace tab. The restored terminal must refit to the full tab size. |
| 拖拽合并 | `drag attach` | Drag a workspace tab or session tab onto another tab or pane to attach it as a split pane of the target. |
| 拖拽恢复 | `drag detach` | Drag a split tab to the empty area of the workspace tab bar to restore it as an independent workspace tab. |

## Naming Rules

- Use `工作区标签栏` for the whole tab strip, and `工作区标签` for one tab card.
- Use `窗格` for a split region inside a tab. Use `终端窗格` when the region contains a shell or SSH terminal.
- Avoid using `窗口` for panes or tabs. Reserve `窗口` for the Electron/native app window or OS/browser-style windows.
- When describing split operations, always name the target: `选中的终端窗格`, `当前工作区标签`, or `目标窗格`.
- When describing default open behavior, distinguish `新建工作区标签` from `拆分当前窗格`.
- In the Database UI and DB AI text, keep the standard database object term `table` in lowercase English; do not translate it to `表` in Chinese sentences or object labels.
