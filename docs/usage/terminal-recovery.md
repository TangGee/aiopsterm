# Terminal recovery

SSH reconnects automatically after an unexpected network disconnect. A closed connection is detected quickly; a silent outage can take about 60 seconds to detect with the default keepalive settings. Reconnection then starts automatically. Keep the tab open; pressing Enter is unnecessary. The tab and existing history remain visible while the connection retries. Input during reconnection is rejected and is never automatically sent later.

Successful reconnection starts a new shell. Normal `exit`, manual disconnect and closing a tab stop automatic reconnection. Authentication may require a password or verification code. Eight consecutive unsuccessful retries stop and show an error; the terminal's reconnect action can start another attempt.

## Settings

Settings > Terminal contains three switches, enabled by default:

- Automatically reconnect SSH: applies to new SSH sessions.
- Restore SSH Bash working directory: starts Bash with temporary directory reporting and restoration; applies to new SSH sessions.
- Restore terminal tabs and history on startup: saves terminal tabs, split relationships, selected tab, directory and recent plain-text history. Turning it off clears the checkpoint on the next save.

Chinese labels are `SSH 断线自动重连`, `SSH Bash 目录恢复`, and `启动时恢复终端标签和历史`.

No tmux or remote service installation is needed. SSH directory recovery supports Bash on POSIX hosts with `/dev/fd`. It reads `~/.bashrc`; custom login-only initialization may need adjustment or this switch disabled. Other shells and relay-shell jump connections can reconnect, but do not promise directory restoration. A missing remote directory reports the failure while leaving the shell usable; a missing local directory falls back to the local default.

## What returns

A renderer reload reuses a session when its Main-owned process still exists. A full application restart opens new shells using saved directories. An actual SSH disconnect also opens a new remote shell; running tasks, temporary environment variables and unsaved full-screen editor state are not recreated.

Recovery stores up to 32 terminal tabs and 1000 normal-buffer lines per tab, capped at 128 Ki characters per tab. Historical colors and alternate-screen contents are not restored from disk. Output already visible in a tab stays intact during an SSH reconnect. Checkpoints are updated every five seconds and after metadata changes; a crash or reload can lose the newest output since the checkpoint.

The file is `terminal-recovery.json` inside the application's userData directory. Passwords and keys are excluded from metadata, but visible terminal history can include text you would not want retained. Disable startup recovery to stop retaining it. Closing a tab removes it from the next checkpoint; manually disconnected tabs reopen as disconnected.
