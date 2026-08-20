# Themes, Backgrounds, And Terminal Appearance

Appearance affects both aesthetics and readability during long operations. Choose the theme first, then tune background, typography, and terminal colors.

## Where To Open It

Click the lower-left **Settings gear**. Select **General** for app theme and background, or **Terminal** for font, size, line height, cursor, and terminal options. Click a background tile to apply it; use the upload control in the Background section for a custom image.

![General settings](../images/en-US/settings-general.png)

## Theme And Background

- Follow System tracks OS light/dark mode. Fixed modes are better for repeatable screenshots and stable color judgement.
- Bundled presets render centered with `cover`; selection previews immediately and a failed save rolls back.
- Custom images are copied into app data, so moving the source does not break configuration. Select another background before deleting one.
- Reduce visual detail or transparency when ANSI colors and text lose contrast.

## Terminal Typography

Open **Settings -> Terminal** to select font, size, line height, weight, and cursor. Font metrics differ across macOS, Windows, and Linux. Validate with a real local terminal containing CJK text, tables, long paths, and ANSI colors.

## Recommended Checks

1. Verify blue, green, and red output in `ls` or colored logs.
2. Check CJK/Latin alignment and long-path overlap.
3. Split terminals and confirm practical column width.
4. Check selection, cursor, links, and search highlights in both themes.

## Common Problems

- Blank background tiles: inspect packaged assets and the computed `background-image` style.
- No terminal colors: verify shell startup environment, `TERM`, and whether the command emits color.
- Crowded lines: restore line height and weight defaults, then change one value at a time.
- Unsaved appearance: inspect the save notice and recreate the terminal renderer when required.

Previous: [Database And DB AI](15-database.md) · Next: [Troubleshooting](17-troubleshooting.md) · [Back to index](../index.md)
