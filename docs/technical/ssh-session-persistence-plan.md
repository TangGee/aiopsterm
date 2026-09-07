# Terminal recovery design and implementation

Updated: 2026-09-08. This document replaces the earlier tmux integration plan completely. Its historical filename is retained so existing links keep working.

## Design goals

A temporary SSH network failure automatically reconnects within the same terminal tab, without pressing Enter. History and the logical terminal ID remain available. Offline input is rejected instead of being replayed into a new shell. Normal `exit`, manual disconnect, authentication failure, and closing a tab stop automatic recovery.

The application restores terminal tab order, split relationships, selected tab, bounded history, and working directories from a Main-owned checkpoint. A renderer reload can reconnect its views to local or SSH sessions that still exist in Main. A full application restart creates new shells. No tmux executable, tmux library, or remote background service is required.

Recovery after an actual SSH disconnection creates a new remote shell. It does not recreate the original PID, running command, unsaved editor state, or temporary environment variables. Local processes also end when the application Main process exits. These boundaries are part of the design, not an alternate tmux mode.

## Reference implementations

Sources were downloaded separately under the sibling `aiopsterm-references` directory and inspected. They are reference-only, never imported, copied, compiled, or packaged into this project.

| Reference | Source and observed behavior |
| --- | --- |
| Tabby `14e2d60b9b6dee84a53c37f05eefeb803787de04` | [app service](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-core/src/services/app.service.ts): recovery tokens and periodic checkpoints |
| Tabby local recovery | [terminal component](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-local/src/components/terminalTab.component.ts): cwd and reusable PTY ID; PTY manager lives in Electron Main |
| Tabby SSH recovery | [SSH component](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-ssh/src/components/sshTab.component.ts): transport reuse with a new shell channel; [recovery provider](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-ssh/src/recoveryProvider.ts) stores profile and display state |
| Tabby display | [xterm frontend](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-terminal/src/frontends/xtermFrontend.ts): excludes alternate buffer and modes when serializing history |
| tmux `73db0a54e5ae5abf80bb790829222c9760f60b1d` | [server](https://github.com/tmux/tmux/blob/73db0a54e5ae5abf80bb790829222c9760f60b1d/server.c): process ownership independent of attached clients; useful architectural context, outside this implementation's dependency graph |

The inspected Tabby SSH reconnect path does not contain a general saved-cwd-to-cd restoration step. Its OSC middleware can observe a reported directory. aiopsterm's transient Bash initialization explicitly supplies that missing behavior; it is not attributed to Tabby.

## Runtime design

`sshTerminalRecovery.ts` supervises the existing SSH runtime. Each transport attempt has a generation. Late lifecycle, output and exit callbacks from older generations are ignored. Network failures after a successful shell trigger eight retries with delays of 1, 2, 4, 8, 16, 30, 30 and 30 seconds. Successful shell readiness resets the consecutive failure budget. Initial connection failures and authentication errors use the existing error/authentication flow.

The supervisor retains the logical ID, latest dimensions, pause state and reported directory. It suppresses final `closed`/`exit` events during retry so Main keeps the session and the renderer keeps the tab. It rejects text, binary and background-command input until shell readiness. IPC text and binary writes report `TERMINAL_NOT_READY`. Manual close cancels timers and closes an in-progress attempt. No user commands are automatically replayed.

A retry switches out of the old alternate screen and resets mouse/paste modes before displaying the new shell. Existing renderer history is retained. SSH transport pooling, proxy and jump-host routing remain in the existing connection layer.

## Directory recovery

With SSH Bash directory recovery enabled, the normal direct/proxy/TCP-jump shell channel uses an SSH PTY exec request. On Bash hosts, the command starts an interactive Bash reading a transient `/dev/fd/3` rcfile. That rcfile sources `~/.bashrc`, safely quotes and restores a verified absolute cwd, then adds an OSC 1337 `CurrentDir` reporter to `PROMPT_COMMAND`, preserving scalar or array commands.

No file is written and no daemon is installed on the remote host. Directory names containing spaces, quotes, Unicode or shell metacharacters are supported through literal shell quoting. Control bytes and oversized/nonabsolute paths are rejected. Missing or inaccessible directories produce a message and leave a usable shell. Reported cwd is tracked with a bounded streaming UTF-8 decoder, including fragmented OSC sequences; it is not inferred from prompts or command history.

This integration targets POSIX hosts with Bash and `/dev/fd`. Other default shells use their ordinary login shell without an SSH cwd restoration guarantee. SSH servers that restrict exec, custom login-only environments, and relay-shell jump hosts can use ordinary SSH with the directory integration disabled. Bash initialization uses `~/.bashrc`; it does not emulate every login-profile customization. Remote cwd is only supplied by the renderer when it was verified by a report.

Local recovery supplies the saved cwd to the existing local terminal backend. Missing directories fall back to the configured default. On Linux, reattaching a live local PTY reads `/proc/<pid>/cwd`; other platforms retain the checkpoint/OSC directory.

## Checkpoints and process ownership

Contracts are in `src/shared/contracts/terminalRecovery.ts`. The preload API exposes `loadTerminalRecovery()` and `saveTerminalRecovery(snapshot)`, implemented by `terminal:recovery:load` and `terminal:recovery:save` in Main. Live sessions are returned only for the requesting owner window. They are never recovered solely because a stale disk ID exists.

Main writes `terminal-recovery.json` under Electron userData using ordered temporary-file writes and rename. New files have mode 0600. The schema is version 1 and allows at most 32 terminal tabs, 128 Ki characters of history per tab and 16 MiB per file. It whitelists metadata and asset references; passwords, private keys, passphrases, arbitrary environment objects and transport-pool aliases are not stored. Visible terminal output may itself contain sensitive text.

The renderer samples the normal terminal buffer, excluding full-screen alternate-buffer content. This implementation saves plain text, up to 1000 lines and the character cap, rather than Tabby's colored ANSI serialization. It restores display before launching shells, with terminal input replies suppressed by the existing view replay path. Closed/disconnected tabs restore as closed. Nonterminal editors and AI panels belong to their existing owners and are not included.

Checkpointing runs every five seconds, with a one-second debounce for tab/directory/layout metadata and a best-effort pagehide save. Unchanged snapshots are skipped. One save runs at a time and worker reads are sequential. Disk errors surface a notice; missing/corrupt snapshots leave normal startup available. Latest output since the checkpoint may be lost after a crash or reload. This is bounded display recovery, not an output journal or process checkpoint.

## Delivery and iteration

The implementation is delivered in this repository, not deferred to a later Goal. Iteration gates are: supervisor and failure semantics; directory bootstrap and safe quoting; persisted tabs/history and live reattachment; real SSH and Electron restart tests; performance checks; documentation and build audits; local Git commit.

The exact automated coverage, commands, thresholds and environment limitations are in [Recovery validation](ssh-session-persistence-test-plan.md). End-user switches and behavior are in [Terminal recovery](../usage/terminal-recovery.md). A later independent-daemon or original-process-continuity feature would require a separate design and is outside this delivery.
