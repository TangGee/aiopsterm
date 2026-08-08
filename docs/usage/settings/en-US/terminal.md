# Terminal Settings

This page controls defaults for new terminal sessions and opened terminal panes.

## Terminal Basics

- Terminal Type: Sets xterm `termName` and the `TERM` value for new local shells, SSH shells, and relay shells. It affects capability detection, color support, and full-screen program compatibility more than appearance.
- Font: Uses the platform monospace font by default, with SF Mono/Menlo on macOS, Cascadia Mono/Consolas on Windows, and DejaVu/Noto/Liberation Mono on Linux as fallbacks.
- Ubuntu Terminal theme: Select `Ubuntu Terminal` under General -> Theme to use the Ubuntu/GNOME Terminal-style solid background and ANSI color palette. For the closest text shape, also select `Ubuntu Mono` here when the font is installed on the system.
- Font Size: Defaults to `13` on new installations. Pane-local zoom can override it until the pane closes.
- ScrollBack: Number of history lines kept by the terminal. Higher values keep more output and use more memory.
- Cursor Style: Block, bar, or underline cursor.
- Cursor Blink: Enables or disables cursor blinking.
- Line Height: Terminal line spacing ratio, defaulting to `1.3` on new installations.

## Interaction And SSH

- Pinch Zoom: Allows trackpad zoom or Ctrl/Meta + mouse wheel font zoom in terminals.
- Show Close Button: Shows or hides terminal tab close buttons.
- SSH Agents: Enables SSH Agent related entry points. It lets selected keys be offered through an agent for SSH authentication.
- SSH Agent Settings: Appears when SSH Agents is enabled. Add keychain keys to the agent or remove existing agent keys.
- Mouse Events - Middle Button: Choose no action, paste clipboard, show context menu, or close current tab.
- Mouse Events - Right Button: Choose no action, paste clipboard, or show context menu.

If capability-query characters appear in a terminal, they are usually related to `TERM` capability probing or history replay. New terminals use the current terminal type and compatibility handling.
