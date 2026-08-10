# General Settings

This page controls app-wide appearance, language, default layout, and built-in editor behavior.

## Basic Settings

- Theme: Changes the app color theme. `System` follows the operating system; `Default` uses aiopsterm built-in themes; `Official` contains third-party style presets plus `Ubuntu Terminal`, which matches the Ubuntu/GNOME Terminal aubergine background and terminal palette.
- Background: Controls the app shell background. `Default Background` disables custom backgrounds; presets apply bundled low-distraction WebP backgrounds, including aurora veil, nebula dust, neon horizon, kanagawa tide, aubergine dune, carbon weave, paper fog, porcelain sky, rose dawn, sakura drift, and jade mist; upload selects a local JPG, PNG, WebP, or GIF.
- Delete custom background: Removes the saved custom background and returns to no background.
- Opacity: Appears only when a background is selected. Lower values make the background less visible.
- Brightness: Appears only when a background is selected. Use it to keep text readable.
- Default Layout: Chooses whether the app prefers `Terminal` or `Agents` on startup or restore.
- Language: Changes the UI language. New installations default to `Follow System`, which resolves a supported locale from the operating system and falls back to Simplified Chinese when no locale matches. Existing saved language choices are preserved. The terminal welcome dashboard also provides this selector directly.
- Watermark: Shows or hides the `aiopsterm` watermark in the app background.
- Onboarding: Opens the interactive onboarding guide.
- Automatically Close Idle Windows: Disabled by default. When enabled, the app checks background panels once per minute and closes panels that exceed the idle timeout. The active panel is always preserved. A panel that fails to close remains in the workspace and has its activity time refreshed before a later check.
- Idle Timeout in Minutes: Determines how long a panel can remain inactive before automatic cleanup. The allowed range is `1` to `1440` minutes and the default is `20` minutes. The `aioic` workspace idle-cleanup command uses the same value.

## Editor Settings

These options affect file editors, knowledge-base editors, SQL editors, and JSON config editors. They do not affect terminals or the AI input box.

Built-in editors load the Monaco runtime and language extensions the first time an editor page is opened. These settings do not force the full editor runtime into app startup.

- Font Size: Editor text size.
- Line Height: Editor row height. `0` lets the app derive a default from the font size.
- Font: Editor font family. It is visible only when the system has or can match the font.
- Tab Size: Number of spaces represented by a tab.
- Word Wrap: Wraps long lines inside the editor viewport when enabled.
- Minimap: Shows or hides the editor minimap.
- Mouse Wheel Zoom: Allows mouse-wheel font zoom inside editors.
