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

`applyThemeToDocument` additionally writes the workspace module's `base` layer as inline `--theme-module-active-*` fallbacks on `document.documentElement`. Overlays teleported to `body` (context menus, popovers, modals) live outside the `.app-body.module-*` scope and would otherwise resolve those variables from the static `:root` defaults of the default dark theme. The app shell also calls `applyBackgroundToDocument` so teleported surfaces receive the current `--app-bg-*` variables and modal-surface variables. The `:root` block in `app-shell-tokens-frame.less` is a pre-hydration fallback generated from the dark preset; `tests/theme-tokens-frame.test.ts` asserts it never drifts from `themeCssVariables(themePresets.dark)`. The renderer entry also applies the system-appearance theme synchronously before mount to avoid first-frame flashes.

## Background Layers

Background image selection is still user configuration. Themes decide how much each region masks or reveals that background.

Every module has `base` and `withBackground` layer tokens, including a layered `border`. `base` is used with no app background. `withBackground` is used under `.app-shell.has-app-background` and owns translucent surfaces, readable surfaces, softened borders, and backdrop filters.

The surface contract is uniform for every theme: with no background image configured, `base` surfaces are fully opaque theme colors — the app is "solid" by definition. When the user selects a background image they are asking to see it, so every theme's `withBackground` layer reveals it through translucent surfaces. How it reveals is the theme's `surfaceFinish`: `frosted` (default) applies backdrop blur for a frosted-glass look, `clear` keeps the translucency crisp with no blur so the image texture stays sharp — appearance (dark/light) does not decide this. `tests/theme-runtime.test.ts` enforces the whole contract for all themes.

The built-in light themes use the shell/core background as the single solid white base. In `withBackground` mode only `workspaceBg` stays transparent so the configured image can show through; `panelBg`, `toolbarBg`, and card layers keep a translucent glass wash with `blur(16px)` because light text-on-image is otherwise unreadable. Small controls, menus, inputs, popovers, and text-heavy content should still prefer `inputBg`, `readableBg`, `readableStrongBg`, or `overlayBg` over `panelBg`.

Modal cards use a separate active surface contract. `--theme-module-active-modal-bg`, `--theme-module-active-modal-card-bg`, and `--theme-module-active-modal-strong-bg` are solid colors from the module `base` layer, so controls and `color-mix()` expressions stay readable and do not depend on translucent `withBackground` surfaces. Actual modal card backgrounds use `--theme-module-active-modal-surface-bg`: with no user background it resolves to the solid modal color; with a selected background it layers a theme-color wash over `--app-bg-image` and then falls back to the solid modal color. Inputs, textareas, buttons, and compact rows inside modals should use the solid modal card/strong variables rather than the image-backed surface. Do not add `backdrop-filter` to modal cards; preserving the selected background should rely on static background layers, not realtime blur.

True modal backdrops use the shared `--app-z-modal` layer, with nested modal popups using `--app-z-modal-child`. This keeps modal dialogs above feature-side popovers such as AI target pickers while leaving onboarding overlays at their higher dedicated layer.

Terminal regions follow the same split. `terminalPalette.base` and `terminalPalette.withBackground` define pane, title bar, floating command line, xterm viewport, xterm screen, runtime, threaded pane, and Codex terminal stack backgrounds. The app shell only switches `--theme-terminal-active-*` variables between those two sets; it does not compute terminal opacity.

The xterm runtime receives the active terminal surface through `terminalThemeForAppTheme(themeId, { surfaceMode })`. Codex embedded terminals call the same helper with `surface: "codex"` so their runtime background and ANSI background palette can differ from the workspace terminal. In `withBackground` mode the terminal body keeps a semi-opaque wash of the terminal background (`0.94` alpha for light themes, `0.7` for dark themes) painted by the xterm/threaded canvas via `runtimeBackground`; the CSS-level xterm viewport and screen stay transparent so the wash is only painted once. A fully transparent terminal body is not allowed: it breaks `minimumContrastRatio` (xterm computes contrast against the RGB channels of the transparent color, i.e. black) and leaves the theme's foreground unreadable on arbitrary images. Light themes must not map ANSI `black` foreground to the terminal background color.

Threaded workspace terminals render text on a shared canvas behind terminal pane DOM. `threadedPaneBg` must not mask that canvas; keep it transparent and use `runtimeBackground` plus the ANSI palette to control the actual terminal body.

`contrastBackground` is the solid color terminal renderers use for readability calculations when the visible terminal body is transparent or semi-transparent. `minimumContrastRatio` is passed to normal xterm instances and enforced by the threaded terminal renderer for non-palette truecolor output. Threaded rendering preserves colors that come from the theme ANSI palette; the theme author is responsible for making those palette colors readable on its terminal backgrounds.

Codex embedded terminals are terminal regions too. `codexRuntimeBackground`, `codexStackBg`, `codexStackIdleBg`, `codexXtermViewportBg`, `codexXtermScreenBg`, and `codexAnsiBackground` must be set by the theme instead of relying on xterm or canvas defaults. `codexAnsiBackground.black` is especially important for light themes because TUI applications often draw large panels with ANSI black backgrounds; the workspace terminal can keep ANSI black as a dark foreground while Codex maps ANSI black backgrounds to its own readable surface. In `withBackground` mode that readable surface is the semi-opaque runtime wash, never a fully transparent color.

Every built-in theme defines an explicit 16-color ANSI palette in its seed. Deriving ANSI colors from the core semantic colors is not acceptable: it collapses magenta/cyan into accent colors, erases the bright tier, and can make ANSI black identical to the terminal background. All 16 slots must be pairwise distinct and `black` must differ from the terminal background; `tests/theme-runtime.test.ts` enforces both.

Idle Codex conversations do not create or reveal a terminal render canvas until a target is bound or a session exists. The empty Codex stack still uses theme-owned `codexStackIdleBg`; once a session starts, the runtime reapplies current settings and terminal theme before Codex output is attached.

The app shell does not define a universal opacity policy for feature screens or terminal screens. A theme is responsible for keeping its own module and terminal surfaces readable.

## Built-In Themes And Backgrounds

Theme seeds use `surfaceFinish` to describe the material behavior in background mode:

- `frosted`: translucent surfaces use backdrop blur.
- `clear`: translucent surfaces stay crisp and do not blur the selected background.

`surfaceFinish` replaces the older solid/glass split. A clear finish still reveals the configured background in `withBackground` mode; it only changes whether blur is applied. Built-in clear-finish themes include Ubuntu Terminal, One Light, Gruvbox Light, Ayu Light, Obsidian Black, and Rose Milk.

Built-in background presets are real WebP assets under `src/renderer/src/assets/backgrounds/` and are exposed through `settingsBackgroundPresets` in `src/renderer/src/config/settings.ts`. Current preset ids are:

- `aurora-veil`
- `nebula-dust`
- `neon-horizon`
- `kanagawa-tide`
- `aubergine-dune`
- `carbon-weave`
- `paper-fog`
- `porcelain-sky`
- `rose-dawn`
- `sakura-drift`
- `jade-mist`

Regenerate these assets with:

```bash
node scripts/generate-backgrounds.mjs --preview-dir test-results/background-previews
```

The generator renders deterministic SVG artwork through Playwright Chromium at 1920x1080 and exports WebP files. The optional preview directory writes HTML previews for visual review. When adding or removing a preset, update the generator artwork map, the generated WebP file, `settingsBackgroundPresets`, and any tests or docs that enumerate built-in presets.

## Legacy Id Migration

Persisted configs can reference preset or theme ids that a later release removed. Two alias maps migrate them during normalization instead of silently dropping the user's choice:

- `legacyBackgroundPresetAliases` in `src/renderer/src/config/settings.ts` maps each retired background preset id to the closest current preset. `normalizeBackgroundConfig` applies the map when `mode` is `preset`; ids with no alias fall back to the first available preset, and the normalization reports `changed: true` so the repaired value is persisted.
- `legacyThemeIdAliases` in `src/renderer/src/services/app/themeRuntime.ts` maps retired theme ids (currently `ubuntu-solid` to `ubuntu-terminal`). `resolveEffectiveThemeId` and the settings controllers consult it before falling back to `dark`.

When removing a preset or theme id, add an alias for it in the matching map in the same commit.

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
