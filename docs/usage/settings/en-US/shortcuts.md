# Shortcuts Settings

This page configures application-level keyboard shortcuts.

## Options

- Shortcut Key: Shows the current shortcut. Click it and press a new key combination to record.
- Recording: Indicates that shortcut recording is active.
- Action: The action triggered by the shortcut.
- Suffix key: Some shortcuts show fixed range or suffix keys to describe shortcut constraints.
- Save: Confirms the recorded shortcut.
- Cancel: Exits recording without saving.
- Reset All: Restores all shortcuts to defaults.

Shortcut changes affect global operations across windows, terminals, and AI panels.

## Rules While A Terminal Has Focus

- When a terminal pane has focus, ordinary `Ctrl+letter` combinations are sent to the shell/PTY, including `Ctrl+a`, `Ctrl+c`, `Ctrl+e`, `Ctrl+k`, and `Ctrl+l`. Here, `Ctrl+a` means Control plus lowercase `a`, not `Ctrl+Shift+A`.
- Built-in terminal actions use `Ctrl+Shift+...` by default for operations such as copy and paste, search navigation, clearing search highlights, AI commands, opening and closing windows or terminals, clearing the screen, file management, moving tabs, single-line scrolling, and command-block navigation. This avoids taking control keys away from readline, bash, vim, tmux, and other terminal programs. `F11` toggles full screen.
- `Ctrl+Shift+T` and New Terminal in the terminal context menu open a new local shell. When invoked from a connected local terminal, the new shell inherits the current working directory. When invoked from an SSH terminal, it does not implicitly clone the remote connection; use the explicit Clone or Fork SSH action instead.
- `Ctrl+Shift+Y` runs Fork SSH when the current terminal is a forkable SSH channel. The terminal context menu also shows `Fork SSH`. SSH sessions established through a jump host or relay shell preserve their jump-host metadata when forked.
- If an application action is reassigned to an ordinary combination such as `Ctrl+K`, it still works outside terminal areas. Inside a terminal pane, aiopsterm gives the combination to the shell first.
