# Terminal Workspace

Terminal tabs behave like standalone sessions until a split action groups them.

- The terminal starts on a welcome dashboard background, not a closable tab. There is no toolbar `+` tab button; new terminal sessions come from workspace resource actions or existing command flows. Use the tab or pane context menu to open a local shell, reconnect, disconnect, search, run AI command generation, show the floating command input, broadcast commands, open file management, or adjust font size.
- Terminal tabs show close controls on the active tab and on hover for inactive tabs. Routine `running`/`ready` state text is not shown in the tab label; only exceptional connection states use compact indicators.
- SSH sessions enable keyboard-interactive authentication. When a remote host or bastion requests a dynamic password, OTP, or other second-factor prompt, the main process forwards the request to a global verification dialog; the response is sent back to the active ssh2 authentication exchange. The dialog is not dismissed by clicking the backdrop, so accidental blank-space clicks do not cancel an in-progress login.
- Password-auth SSH sessions without a saved password open the same global authentication dialog before connecting. The password is session-only by default. If `记住密码并更新该主机` is checked, the backend stores the password only after the SSH connection reaches the ready state. If a saved host password is rejected, the SSH backend prompts once for a replacement password and retries the real connection before reporting failure.
- SSH authentication failures are diagnosed by the main-process SSH boundary. Password-disabled servers, rejected passwords, rejected keys, missing auth methods, and network failures surface distinct backend error codes and actionable messages in the terminal status instead of raw ssh2 text only.
- The command input is not persistent at the bottom of each terminal. Right-click a terminal pane and choose `输入命令` to show it as a floating input near the cursor; it stays open for rejected/unavailable commands and closes after successful shell writes.
- Right-click a terminal tab or terminal pane and choose `向右拆分` or `向下拆分` to split the selected pane region.
- Right-click a split tab or pane and choose `取消拆分` to restore that pane as a standalone tab.
- Drag a terminal or knowledge tab onto another terminal/knowledge tab or pane to attach it as a right-side split of the target.
- Drag a split terminal or knowledge tab onto the tab bar empty area to restore it as a standalone tab.
- Split restore forces xterm host geometry cleanup, multi-frame fit, terminal refresh, scroll-to-bottom, and backend resize notification when a backend session is attached.
- Font-size increase/decrease actions are scoped to the selected terminal pane and force terminal fit/refresh so the input row stays visible.
- When many terminal tabs are open, tab titles shrink and ellipsize so later tabs remain reachable.
