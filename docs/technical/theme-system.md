# Theme System

aiopsterm uses a region-based theme model. Themes are defined in renderer code and applied as CSS custom properties on `document.documentElement`.

## Model

Each concrete theme owns the full visual contract:

- `core`: base colors, status colors, text colors, and shadows.
- `shell`: top bar, side rail, app background wash, watermark, brand mark, and shell borders.
- `modules`: per-feature regions for `workspace`, `aiSessions`, `assets`, `files`, `snippets`, `knowledge`, `extensions`, `kubernetes`, `database`, `settings`, `user`, `agents`, and `aiPanel`.
- `terminalPalette`: terminal foreground/background colors, contrast background, minimum contrast ratio, ANSI color slots, cursor and selection colors, scrollbar colors, and terminal-owned surface regions.
- `editor`: default editor font variables.

The current active module is selected by the existing `.app-body.module-*` class. The shell keeps its own variables, while module screens map their complete module definition into `--theme-module-active-*` variables. The AI side panel maps itself to the `aiPanel` module tokens.

## Background Layers

Background image selection is still user configuration. Themes decide how much each region masks or reveals that background.

Every module has `base` and `withBackground` layer tokens. `base` is used with no app background. `withBackground` is used under `.app-shell.has-app-background` and owns transparent surfaces, readable surfaces, and backdrop filters.

The built-in light themes use the shell/core background as the single solid white base. In `withBackground` mode their large region surfaces, including workspace, side panels, AI panel, terminal panes, and Codex terminal stacks, default to transparent and no blur so the configured image can show through. Small controls, menus, inputs, popovers, and text-heavy content should use `inputBg`, `readableBg`, `readableStrongBg`, or `overlayBg` instead of borrowing `panelBg`; `panelBg` is allowed to be fully transparent.

Terminal regions follow the same split. `terminalPalette.base` and `terminalPalette.withBackground` define pane, title bar, floating command line, xterm viewport, xterm screen, runtime, threaded pane, and Codex terminal stack backgrounds. The app shell only switches `--theme-terminal-active-*` variables between those two sets; it does not compute terminal opacity.

The xterm runtime receives the active terminal surface through `terminalThemeForAppTheme(themeId, { surfaceMode })`. Codex embedded terminals call the same helper with `surface: "codex"` so their runtime background and ANSI background palette can differ from the workspace terminal. When a theme wants the app background to show through the terminal body, it should make the xterm viewport, xterm screen, and runtime background transparent or semi-transparent, while keeping the pane, stack, ANSI palette, `contrastBackground`, and `minimumContrastRatio` readable. Light themes should not map ANSI `black` foreground to the terminal background color.

Threaded workspace terminals render text on a shared canvas behind terminal pane DOM. `threadedPaneBg` must not mask that canvas; keep it transparent and use `runtimeBackground` plus the ANSI palette to control the actual terminal body.

`contrastBackground` is the solid color terminal renderers use for readability calculations when the visible terminal body is transparent or semi-transparent. `minimumContrastRatio` is passed to normal xterm instances and enforced by the threaded terminal renderer for non-palette truecolor output. Threaded rendering preserves colors that come from the theme ANSI palette; the theme author is responsible for making those palette colors readable on its terminal backgrounds.

Codex embedded terminals are terminal regions too. `codexRuntimeBackground`, `codexStackBg`, `codexStackIdleBg`, `codexXtermViewportBg`, `codexXtermScreenBg`, and `codexAnsiBackground` must be set by the theme instead of relying on xterm or canvas defaults. `codexAnsiBackground.black` is especially important for light themes because TUI applications often draw large panels with ANSI black backgrounds; the workspace terminal can keep ANSI black as a dark foreground while Codex maps ANSI black backgrounds to its own readable surface.

Idle Codex conversations do not create or reveal a terminal render canvas until a target is bound or a session exists. The empty Codex stack still uses theme-owned `codexStackIdleBg`; once a session starts, the runtime reapplies current settings and terminal theme before Codex output is attached.

The app shell does not define a universal opacity policy for feature screens or terminal screens. A theme is responsible for keeping its own module and terminal surfaces readable.

## Compatibility Policy

The previous global variables such as `--bg`, `--surface`, `--accent`, `--glass-surface`, `--workspace-bg`, and terminal host aliases are not part of the theme API.

Theme changes should update the typed `ThemeDefinition` model and migrate styles to the `--theme-*` variables. Do not add fallback compatibility variables for old theme names.

## Tests

Theme changes should cover:

- all built-in themes exist and resolve through `resolveThemePreset()`;
- every built-in theme defines every module region;
- `themeCssVariables()` emits only the new `--theme-*` variables;
- terminal themes read color and surface state from `terminalPalette`;
- Codex terminal themes use `codexRuntimeBackground` and `codexAnsiBackground` instead of inheriting workspace ANSI background behavior;
- terminal contrast options are propagated to both xterm and threaded terminal rendering;
- terminal `base` and `withBackground` surfaces exist for every built-in theme;
- `auto` resolves to the current system dark/light theme.
