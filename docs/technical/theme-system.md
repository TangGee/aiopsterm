# Theme System

aiopsterm uses a region-based theme model. Themes are defined in renderer code and applied as CSS custom properties on `document.documentElement`.

## Model

Each concrete theme owns the full visual contract:

- `core`: base colors, status colors, text colors, and shadows.
- `shell`: top bar, side rail, app background wash, watermark, brand mark, and shell borders.
- `modules`: per-feature regions for `workspace`, `aiSessions`, `assets`, `files`, `snippets`, `knowledge`, `extensions`, `kubernetes`, `database`, `settings`, `user`, `agents`, and `aiPanel`.
- `terminalPalette`: terminal foreground/background colors, contrast background, minimum contrast ratio, ANSI color slots, cursor and selection colors, scrollbar colors, and terminal-owned surface regions.
- `editor`: default editor font variables.

The current active module is selected by the existing `.app-body.module-*` class. The shell keeps its own variables, while module screens map their complete module definition into `--theme-module-active-*` variables. The AI side panel maps itself to the `aiPanel` module tokens. The agents mode maps through `.app-body.mode-agents`, which must stay after the `.app-body.module-*` rules because both selectors carry equal specificity and agents mode keeps its previous `module-*` class.

`applyThemeToDocument` additionally writes the workspace module's `base` layer as inline `--theme-module-active-*` fallbacks on `document.documentElement`. Overlays teleported to `body` (context menus, popovers) live outside the `.app-body.module-*` scope and would otherwise resolve those variables from the static `:root` defaults of the default dark theme. The `:root` block in `app-shell-tokens-frame.less` is a pre-hydration fallback generated from the dark preset; `tests/theme-tokens-frame.test.ts` asserts it never drifts from `themeCssVariables(themePresets.dark)`. The renderer entry also applies the system-appearance theme synchronously before mount to avoid first-frame flashes.

## Background Layers

Background image selection is still user configuration. Themes decide how much each region masks or reveals that background.

Every module has `base` and `withBackground` layer tokens, including a layered `border`. `base` is used with no app background. `withBackground` is used under `.app-shell.has-app-background` and owns translucent surfaces, readable surfaces, softened borders, and backdrop filters.

Each theme declares a `surfaceStyle`: `glass` (default) uses translucent surfaces with `blur(16px)` in `withBackground` mode; `solid` keeps panels at 90%+ opacity with no backdrop filter, so the configured image only shows through the workspace gaps. Solid is for users who dislike the frosted-glass look; the style is part of the theme definition, not a separate setting.

The built-in light themes use the shell/core background as the single solid white base. In `withBackground` mode only `workspaceBg` stays transparent so the configured image can show through; `panelBg`, `toolbarBg`, and card layers keep a translucent glass wash with `blur(16px)` because light text-on-image is otherwise unreadable. Small controls, menus, inputs, popovers, and text-heavy content should still prefer `inputBg`, `readableBg`, `readableStrongBg`, or `overlayBg` over `panelBg`. Modal cards, popup menus, popovers, and toasts must use `overlayBg`.

Terminal regions follow the same split. `terminalPalette.base` and `terminalPalette.withBackground` define pane, title bar, floating command line, xterm viewport, xterm screen, runtime, threaded pane, and Codex terminal stack backgrounds. The app shell only switches `--theme-terminal-active-*` variables between those two sets; it does not compute terminal opacity.

The xterm runtime receives the active terminal surface through `terminalThemeForAppTheme(themeId, { surfaceMode })`. Codex embedded terminals call the same helper with `surface: "codex"` so their runtime background and ANSI background palette can differ from the workspace terminal. In `withBackground` mode the terminal body keeps a semi-opaque wash of the terminal background (`0.94` alpha for light themes, `0.7` for dark themes) painted by the xterm/threaded canvas via `runtimeBackground`; the CSS-level xterm viewport and screen stay transparent so the wash is only painted once. A fully transparent terminal body is not allowed: it breaks `minimumContrastRatio` (xterm computes contrast against the RGB channels of the transparent color, i.e. black) and leaves the theme's foreground unreadable on arbitrary images. Light themes must not map ANSI `black` foreground to the terminal background color.

Threaded workspace terminals render text on a shared canvas behind terminal pane DOM. `threadedPaneBg` must not mask that canvas; keep it transparent and use `runtimeBackground` plus the ANSI palette to control the actual terminal body.

`contrastBackground` is the solid color terminal renderers use for readability calculations when the visible terminal body is transparent or semi-transparent. `minimumContrastRatio` is passed to normal xterm instances and enforced by the threaded terminal renderer for non-palette truecolor output. Threaded rendering preserves colors that come from the theme ANSI palette; the theme author is responsible for making those palette colors readable on its terminal backgrounds.

Codex embedded terminals are terminal regions too. `codexRuntimeBackground`, `codexStackBg`, `codexStackIdleBg`, `codexXtermViewportBg`, `codexXtermScreenBg`, and `codexAnsiBackground` must be set by the theme instead of relying on xterm or canvas defaults. `codexAnsiBackground.black` is especially important for light themes because TUI applications often draw large panels with ANSI black backgrounds; the workspace terminal can keep ANSI black as a dark foreground while Codex maps ANSI black backgrounds to its own readable surface. In `withBackground` mode that readable surface is the semi-opaque runtime wash, never a fully transparent color.

Every built-in theme defines an explicit 16-color ANSI palette in its seed. Deriving ANSI colors from the core semantic colors is not acceptable: it collapses magenta/cyan into accent colors, erases the bright tier, and can make ANSI black identical to the terminal background. All 16 slots must be pairwise distinct and `black` must differ from the terminal background; `tests/theme-runtime.test.ts` enforces both.

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
