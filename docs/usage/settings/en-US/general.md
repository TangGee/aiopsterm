# General Settings

This page controls app-wide appearance, language, default layout, and built-in editor behavior.

## Basic Settings

- Theme: Changes the app color theme. `System` follows the operating system; `Default` uses aiopsterm built-in themes; `Official` contains third-party style presets plus `Ubuntu Terminal`, which matches the Ubuntu/GNOME Terminal aubergine background and terminal palette.
- Background: Controls the app shell background. `Default Background` disables custom backgrounds; presets apply bundled low-distraction WebP backgrounds, including aurora veil, nebula dust, neon horizon, kanagawa tide, aubergine dune, carbon weave, paper fog, porcelain sky, rose dawn, sakura drift, and jade mist; upload selects a local JPG, PNG, WebP, or GIF.
- Delete custom background: Removes the saved custom background and returns to no background.
- Opacity: Appears only when a background is selected. Lower values make the background less visible.
- Brightness: Appears only when a background is selected. Use it to keep text readable.
- Default Layout: Chooses whether the app prefers `Terminal` or `Agents` on startup or restore.
- Language: Changes the UI language. `Follow System` resolves from the operating system language.
- Watermark: Shows or hides the `aiopsterm` watermark in the app background.
- Onboarding: Opens the interactive onboarding guide.

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
