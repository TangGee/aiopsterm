# Keyboard Shortcuts

This guide explains how to operate terminals, tabs, search, AI, and layout from the keyboard without stealing control keys from the shell.

## Where To Open It

Click the **Settings gear** at the lower-left corner, then select **Shortcuts** in the Settings navigation. Click the key field beside an action and press the new combination. Conflicts appear immediately. Use the row reset control for one action or the page reset control for all defaults.

![Shortcut settings](../images/en-US/settings-shortcuts.png)

## Why Terminal Shortcuts Use Modifiers

While a terminal is focused, `Ctrl+A/C/D/E/K/L` must reach readline, vim, tmux, and remote TUIs. aiopsterm therefore places copy, paste, new-terminal, and similar app actions under `Ctrl+Shift` or `Ctrl+Alt`. macOS labels follow the configured binding; operating-system key-repeat behavior is separate from application shortcuts.

## Configurable Workspace Shortcuts

The actions below can be remapped under **Settings -> Shortcuts**. The Settings page shows the active value; this table lists defaults for a new installation.

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| New local terminal | `Ctrl+Shift+T` | `Ctrl+Shift+T` |
| Show or hide the AI sidebar | `Ctrl+Shift+A` | `Ctrl+Shift+A` |
| Switch to tab 1 through 9 | `Alt+1..9` | `Alt+1..9` |
| Open Quick Commands | `Ctrl+Shift+P` | `Ctrl+Shift+P` |
| Close the current panel | `Ctrl+Shift+W` | `Ctrl+Shift+W` |
| Open Recent Panels | `Ctrl+Tab` | `Ctrl+Tab` |
| Go back through activation history | `Ctrl+Left` | `Cmd+[` |
| Go forward through activation history | `Ctrl+Right` | `Cmd+]` |
| Switch to the panel on the left by tab order | `Ctrl+Shift+Left` | `Ctrl+Shift+Left` |
| Switch to the panel on the right by tab order | `Ctrl+Shift+Right` | `Ctrl+Shift+Right` |

## Terminal Shortcuts

The bindings below apply to terminal surfaces and currently cannot be remapped on the Shortcuts page. `Primary` means `Ctrl` on Windows and Linux, and `Cmd` on macOS. `Alt` is also labeled `Option` on macOS keyboards.

| Action | Default shortcut |
| --- | --- |
| Copy / paste | `Ctrl+Shift+C` / `Ctrl+Shift+V`; macOS also supports `Cmd+C` / `Cmd+V` |
| Open search | `Primary+Alt+F` |
| Next / previous search result | `Primary+Alt+G` / `Primary+Alt+H` |
| Clear search highlights | `Primary+Alt+J` |
| New / close window | `Primary+Shift+N` / `Primary+Shift+Q` |
| Fork the current SSH channel | `Primary+Shift+Y` |
| Open inline AI Command | `Primary+Shift+K` |
| Clear the terminal | `Primary+Shift+L` |
| Open file management for the current host | `Primary+Shift+M` |
| Increase / decrease / reset font size | `Primary+=` / `Primary+-` / `Primary+0` |
| Switch to the previous / next terminal tab | `Primary+PageUp` / `Primary+PageDown` |
| Move the current tab left / right | `Primary+Shift+PageUp` / `Primary+Shift+PageDown` |
| Scroll up / down one line | `Primary+Shift+Up` / `Primary+Shift+Down` |
| Scroll up / down one page | `Shift+PageUp` / `Shift+PageDown` |
| Scroll to the top / bottom | `Shift+Home` / `Shift+End` |
| Toggle full screen | `F11` |
| Reconnect a closed or failed terminal | `Enter` |

`Ctrl+Shift+T` and `Ctrl+Shift+W` also follow the configurable shortcut settings. Once either action is remapped, its old default no longer triggers it.

## Common Editor Shortcuts

| Surface | Action | Windows / Linux | macOS |
| --- | --- | --- | --- |
| Files, Knowledge, and JSON editors | Save | `Ctrl+S` | `Cmd+S` |
| SQL editor | Run statement | `Ctrl+Enter` | `Cmd+Enter` |
| SQL editor | Find / replace | `Ctrl+F` / `Ctrl+H` | `Cmd+F` / `Cmd+H` |

Treat the current Settings page and the current version's interface hints as authoritative. Configurable bindings may have been changed, and the operating system or desktop environment may reserve some combinations.

## Customization Steps

1. Search for the action under **Settings -> Shortcuts**.
2. Click its key field and confirm recording state.
3. Press the complete combination.
4. Resolve any reported conflict before leaving the page.
5. Verify it in a real terminal: normal shell controls must still pass through and the app action must fire once.

## Best Practices And Troubleshooting

- Keep plain `Ctrl+letter` combinations available to terminal programs.
- Avoid combinations reserved by macOS Mission Control, Windows input methods, or the Linux desktop.
- If a binding does nothing, focus the intended surface first and check for conflicts.
- If vim or tmux loses a control key, restore the related app action and choose a modifier-heavy binding.

Previous: [Quick Commands](06-quick-commands.md) · Next: [Export MCP](08-export-mcp.md) · [Back to index](../index.md)
