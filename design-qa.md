# AI Panel and Agents Design QA

## Evidence

- Source visual truth: `/home/tester/Pictures/Screenshots/Screenshot from 2026-07-12 20-31-30.png`
- Implementation screenshot: `test-results/design-qa/agents-layout-implemented-1330x760.png`
- Full-view comparison: `test-results/design-qa/agents-layout-full-comparison.png`
- Focused left-shell comparison: `test-results/design-qa/agents-layout-left-focus-comparison.png`
- Focused right-pane comparison: `test-results/design-qa/agents-layout-right-focus-comparison.png`
- Viewport: `1330 x 760`
- State: the source is the existing Terminal shell used as the structural and visual reference; the implementation is the requested Agents variant. Session content intentionally differs, while shell geometry, tokens, density, and pane behavior are compared.

## Findings

No actionable P0, P1, or P2 mismatch remains.

- Information architecture: passed. The implementation renders `SideRail | AgentsSidebar | TerminalWorkspace | AiPanel`; the Agents action is active in SideRail and the removed TopBar mode action is absent.
- Spacing and layout rhythm: passed. Rail, left catalog, central workspace, and right AI pane have stable full-height tracks, visible dividers, no overlap, and the same compact desktop density as the source. The saved Agents list width may differ from the source resource width by design because it is user-resizable.
- Fonts and typography: passed. Existing application font family, weights, sizes, line heights, zero letter-spacing, truncation, and compact metadata hierarchy are preserved.
- Colors and visual tokens: passed. The existing dark shell, border, active-navigation, panel, status, and background-image tokens are reused without introducing a new palette or gradient treatment.
- Image quality and asset fidelity: passed. The existing bitmap application background remains sharp and correctly framed. Icons come from the project's Lucide icon system; no placeholder, handcrafted SVG, emoji, or CSS-art replacement was added.
- Copy and content: passed. Agents rows show title, surface, binding, time, and scope; the right pane retains the existing session controls. The content difference from the source is intentional because this is the Agents state.
- Interaction state: passed through component/runtime coverage. TerminalWorkspace and AiPanel retain DOM identity across mode changes, the Agents right pane cannot close, both side widths remain resizable, and normal SideRail modules exit Agents with a single active rail item.

## Patches Made

- Moved Agents mode selection from TopBar to SideRail.
- Replaced the full-page Agents stage with the persistent terminal workspace and fixed right AiPanel.
- Kept terminal rendering visibility, resize behavior, Product Session routing, and Codex bound-terminal focus aligned with the new shell.
- Replaced the wide system scrollbar in the Product Session catalog with the existing compact themed scrollbar treatment.
- Added focused runtime, routing, store, component, and E2E assertions.

## Follow-up Polish

No P3 item is required for this handoff.

## AI Panel Interaction Fixes

### Evidence

- Source Command-card issue: `/home/tester/Pictures/Screenshots/Screenshot from 2026-07-12 21-56-39.png`
- Source context-popup issue: `/home/tester/Pictures/Screenshots/Screenshot from 2026-07-12 21-58-25.png`
- Fixed Command card: `test-results/design-qa/ai-panel-command-action-fixed.png`
- Fixed context popup: `test-results/design-qa/ai-panel-context-popup-fixed.png`
- Viewport: `1344 x 756`
- State: production Electron build with the saved application background enabled.

### Findings

No actionable P0, P1, P2, or P3 mismatch remains.

- Command primary action: passed. The real restored Command card renders the localized `执行` text and icon on `rgb(140, 207, 126)` instead of inheriting the background-image card fill. Its measured width is stable at about 128 px and the label is visible without overlap.
- Context popup: passed. The open composer has `z-index: 45`; the popup computes to `rgb(21, 25, 34)`, `opacity: 1`, and `pointer-events: auto`. `document.elementFromPoint()` at the first row resolves inside the popup, and clicking that hit target adds `127.0.0.1` to the selected context strip.
- Read-only auto-run: passed through main/renderer contract coverage. Electron main alone emits `autoApprovable`; only strict atomic diagnostic commands can enable session auto-run. Compound commands such as the screenshot's `uptime && ...` remain operator-approved.
- Chat export: passed through the production renderer/preload/main path with deterministic dialog ownership. The restored chat produced a 207-byte Markdown file and the UI reported `聊天已导出。`; the temporary verification file was removed afterward.
- Layering and containment: passed. Raising the composer is scoped to an open popup and remains below application modals; no header, message, or action overlap was observed at the verification viewport.

### Patches Made

- Restored readable Command primary-action colors for background-image themes.
- Restored strict global and per-Cline-session read-only command auto-run.
- Raised open composer popups, made their background opaque, and restored pointer hit testing.
- Converted nested reactive chat metadata into plain IPC-cloneable export snapshots.

final result: passed

## Codex Binding Responsiveness

### Evidence

- Source issue: `/home/tester/Pictures/Screenshots/Screenshot from 2026-07-14 14-23-45.png`
- Fixed production Electron state: `test-results/design-qa/codex-bind-responsive-fixed.png`
- Viewport: `2016 x 1134`
- State: a local terminal is bound to Codex after the target picker closes; the right pane reports `Codex CLI 已连接` and renders the threaded terminal.

### Findings

No actionable P0, P1, P2, or P3 issue remains for this interaction.

- Binding behavior: passed. Selecting the current terminal closes the picker immediately and displays the bound target without a second click.
- Safe-mode failure behavior: passed. Forced safe mode produces one diagnostic per affected conversation, keeps the renderer responsive, and allows the picker to be reopened and closed.
- Normal-mode startup: passed. The bound local terminal progresses from starting to connected, has no error banner, and renders through the threaded terminal host.
- Visual containment: passed. The target bar, status row, terminal viewport, header controls, and scrollbar remain inside the existing right-pane bounds without overlap.

final result: passed

## Context Selection Follow-up

### Evidence

- Source issue: `/home/tester/Pictures/Screenshots/Screenshot from 2026-07-12 23-22-09.png`
- Fixed production Electron state: `test-results/design-qa/ai-panel-context-selected-row-fixed.png`
- State: the main context menu is open after selecting `115.191.41.79`, with the selected context chip visible below the popup.

### Findings

No actionable P0, P1, P2, or P3 mismatch remains.

- Selection behavior: passed. Clicking a main-menu quick host updates the context and closes the popup with focus restored to the composer. Host-category single and batch controls keep the popup open for multi-host selection; category and document-directory rows continue to navigate without closing.
- Row geometry: passed. Context leaf rows now have three stable grid children: leading icon, label, and one bounded tail containing detail plus trailing state. In the production Electron viewport the selected row is 30 px high, the `Check` is 16 px high at `top: 407`, and the icon remains fully inside the row bounds of `top: 400` through `bottom: 430`.
- Narrow-panel containment: passed. The tail is capped at 44% of the row, detail text can shrink with ellipsis, and the trailing icon has a fixed 16 px flex basis, so the icon cannot wrap below the label.
- Visual consistency: passed. Existing colors, 6 px row radius, compact spacing, Lucide icons, popup width, and background-image treatment are unchanged.

final result: passed
