# aiopsterm Control Socket

aiopsterm exposes a local newline-delimited JSON control socket for automation that needs to operate on terminal panels opened by aiopsterm. This is the control_compat-style automation layer: scripts talk to a socket, the main process handles routing, and renderer windows provide UI-only state such as terminal panels and xterm screen text.

## Scope

The first control-socket slice supports these terminal primitives:

- `ping`: verify that the socket is reachable.
- `system.capabilities`: return the control protocol version, process facts, socket path, and supported capability tokens.
- `system.identify`: return the same app/process identity plus optional caller context and current runtime counters.
- `agent.hooks.list`: list supported AI agent hook installers and current install status.
- `agent.hooks.setup`: install hooks for detected agent CLIs, or for selected `source` values.
- `agent.hooks.install`: install selected agent hooks even when the binary is not currently on `PATH`.
- `agent.hooks.uninstall`: remove aiopsterm-owned hooks for selected agents.
- `terminal.list`: list visible terminal panels.
- `terminal.focus`: focus a terminal panel by `panelId` or `sessionId`.
- `terminal.read_screen`: read recent visible xterm buffer text from a terminal panel.
- `terminal.send_text`: send raw text to a connected terminal session by `sessionId`, or resolve one from `panelId`/`surfaceId`.
- `terminal.send_key`: send a named key such as `enter`, `tab`, `esc`, `up`, `f1`, or `ctrl+c` to a connected terminal session.

The notification slice adds these generic notification primitives:

- `notification.create`: create an unread notification.
- `notification.create_for_surface`: create an unread notification targeted at a visible surface id.
- `notification.create_for_target`: create an unread notification targeted at a workspace id plus visible surface id.
- `notification.list`: list queued notifications.
- `notification.open`: focus the target terminal and mark one notification read.
- `notification.jump_to_unread`: open the newest unread notification.
- `notification.mark_read`: mark one notification or all notifications read.
- `notification.dismiss`: remove one read notification, or all read notifications.
- `notification.clear`: clear the generic notification queue.

The workspace metadata slice adds read-only model snapshots:

- `workspace.snapshot`: return the current main workspace, terminal surfaces, split groups, generic notifications, managed AI session summaries, and top-bell attention items in one payload.
- `workspace.list`: list the logical aiopsterm workspaces exposed to automation. This currently returns the single shared main workspace.
- `workspace.current`: return the currently selected logical workspace metadata.
- `surface.list`: list terminal and editor surfaces in the shared main work panel.
- `surface.current`: return the currently active surface.
- `surface.focus`: focus one visible surface in the shared main work panel.
- `surface.create`: create one new local terminal surface in the shared main work panel. Browser/url surfaces are explicitly rejected because aiopsterm does not implement control_compat's browser surface.
- `pane.create`: split from a source surface into one new shared-work-panel terminal surface.
- `surface.report_tty`: record a surface TTY name reported by shell/bootstrap automation.
- `surface.report_shell_state`: record whether a surface shell is at `prompt`, `running`, or `unknown`.
- `surface.ports_kick`: record that automation requested a port-scan refresh for a surface. aiopsterm currently stores the kick metadata but does not synthesize listening-port results.

The control_compat system/window/settings compatibility slice adds non-browser app automation:

- `auth.login`: acknowledge the local control socket auth handshake. aiopsterm currently returns `authenticated=true` and `required=false` because access is scoped to the local per-process socket.
- `system.tree`: build a control_compat-style window/workspace/pane/surface tree from the renderer `workspace.snapshot` read model. aiopsterm maps the shared main work panel to one selected workspace named `main`.
- `window.list`, `window.current`, and `window.focus`: inspect and focus existing Electron windows through the main-process runtime.
- `window.create`, `window.close`, and `window.display`: recognized compatibility controls that return `unsupported=true` rather than creating, closing, or moving native windows unexpectedly.
- `window.displays`: return connected display metadata when the packaged main process provides it.
- `settings.open`: open the existing Settings module and select a supported settings section such as `general`, `terminal`, `models`, `ai`, `mcp`, `skills`, or `about`.
- `feedback.open`: reuse the existing local feedback report action.
- `extension.sidebar.snapshot`: expose a control_compat-style sidebar feed derived from `workspace.snapshot`.
- `app.focus_override.set` and `app.simulate_active`: accepted app-focus compatibility controls. They update control metadata and focus the active aiopsterm window where applicable.

The mobile terminal compatibility slice maps control_compat's mobile-host data-plane verbs onto aiopsterm's shared terminal panel model:

- `mobile.host.status`: return local app/process identity, advertised mobile-terminal capability tokens, visible workspace/terminal counts, active surface id, and the current renderer snapshot when available.
- `mobile.workspace.list`: return the same shared main workspace and visible terminal/surface list in a mobile-friendly shape. The bare `workspace.list` continues to use the normal workspace list payload.
- `mobile.terminal.create` / `terminal.create`: create a visible local terminal surface through the existing `surface.create` path. Browser surfaces remain unsupported.
- `mobile.terminal.input` / `terminal.input`: write raw typed text to the resolved aiopsterm terminal session. Targets may use `surface_id`, `terminal_id`, `panelId`, or `session_id` style selectors.
- `mobile.terminal.paste` / `terminal.paste`: send bracketed paste text to the resolved terminal and optionally submit it. Supported `submit_key` values are `return`, `enter`, `ctrl+enter`, and `none`.
- `mobile.terminal.replay` / `terminal.replay`: return a cold-attach text snapshot from the xterm buffer, plus the effective terminal `columns` and `rows`. aiopsterm uses `snapshot_format=aiopsterm.text` instead of control_compat's Ghostty render-grid payload.
- `mobile.terminal.viewport` / `terminal.viewport`: echo the selected terminal's effective grid and the caller's reported viewport size. This is currently observational; aiopsterm does not resize shared terminals to the smallest mobile viewport.
- `mobile.terminal.scroll` / `terminal.scroll` and `mobile.terminal.mouse` / `terminal.mouse`: recognized compatibility probes that return `unsupported=true`, because aiopsterm does not expose xterm scroll/mouse gesture injection through the control socket yet.
- `mobile.terminal.paste_image` / `terminal.paste_image`: recognized compatibility probe that returns `unsupported=true`; image payload materialization is not implemented in aiopsterm's control socket.

The mobile chat compatibility slice maps control_compat's agent-chat RPC names onto aiopsterm's managed AI sessions discovered from aiopsterm-owned local connection terminals:

- `mobile.chat.sessions`: list chat-capable managed AI sessions, optionally filtered by `workspace_id`, `source` / `agent_kind`, and `include_ended`.
- `mobile.chat.history`: return a `ChatHistoryPage`-style page synthesized from safe managed-session event summaries. It does not expose raw hook payloads, terminal screen text, or typed input.
- `mobile.chat.send`: bracketed-paste text into the session's bound terminal and submit it. Attachments currently return `MOBILE_CHAT_ATTACHMENTS_UNSUPPORTED`.
- `mobile.chat.interrupt`: send Escape for a soft interrupt or Ctrl-C when `hard=true`.
- `mobile.chat.answer`: send the 1-based digit corresponding to the requested zero-based `option_index`.
- `chat.sessions.dump`: return debug-safe managed session summaries plus the mobile chat descriptor for each record.
- `mobile.attach_ticket.create`: return a control_compat-shaped short-lived attach ticket for the local aiopsterm control socket. aiopsterm marks the response `unsupported_remote=true` because it does not run control_compat's mobile network listener.

The project/file compatibility slice maps control_compat project openers onto aiopsterm's shared main work panel:

- `markdown.open`: open a Knowledge file as a knowledge surface in the shared main work panel, with optional `line` / `startLine` and `endLine` jump metadata.
- `file.open`: open one or more Knowledge files through `path` or `paths`. Arbitrary absolute local files are recognized but return `unsupported=true` because aiopsterm does not yet expose a generic local-file surface in the shared terminal workspace.
- `project.open`: create or focus a project compatibility surface. If `path` points to a Knowledge file, the file is opened; otherwise aiopsterm records project metadata on a terminal surface without creating an Xcode-style project browser.
- `project.set_tab`, `project.set_scheme`, `project.set_configuration`, `project.set_selected_target`, `project.set_selected_file`, and `project.set_settings_filter`: update renderer-owned project compatibility metadata for automation scripts that expect these control_compat methods.
- `project.get_state`: return the stored project compatibility state. Xcode-only concepts such as schemes, targets, and build settings are marked with `unsupported=true` until aiopsterm has a native equivalent.

The workspace group slice adds control_compat-style group metadata for the shared main work panel:

- `workspace.group.list`: list automation-visible surface groups.
- `workspace.group.create`: create a group over one or more current surfaces.
- `workspace.group.ungroup`: remove a group while keeping all surfaces open.
- `workspace.group.delete`: close every surface in the group. This requires `confirm=true`.
- `workspace.group.rename`, `collapse`, `expand`, `pin`, `unpin`: update group metadata.
- `workspace.group.add`, `remove`, `set_anchor`: manage group membership and anchor surface.
- `workspace.group.new_workspace`: create a new local terminal panel and add it to the group.
- `workspace.group.focus`: focus the group anchor surface.

The workspace remote compatibility slice maps control_compat remote-workspace controls to aiopsterm's visible SSH terminal panels:

- `workspace.remote.status`: return the current remote summary for the shared main workspace.
- `workspace.remote.configure`: register SSH metadata on a visible terminal surface. It does not connect by default; pass `auto_connect=true` or CLI `--connect` when the caller intentionally wants to open the SSH session.
- `workspace.remote.reconnect`: start or restart the selected visible SSH terminal surface.
- `workspace.remote.disconnect`: disconnect the selected visible SSH terminal surface. `clear=true` also removes the stored remote metadata from that surface.
- `workspace.remote.foreground_auth_ready`: record foreground authentication readiness metadata without echoing auth tokens into events.
- `workspace.remote.pty_sessions`: list visible aiopsterm SSH terminal panels in a control_compat-compatible session shape.
- `workspace.remote.pty_close`, `workspace.remote.pty_detach`, `workspace.remote.pty_bridge`, and `workspace.remote.pty_resize`: recognized as compatibility commands but return `unsupported=true`, because aiopsterm does not expose control_compat's hidden remote PTY daemon. `pty_bridge` still validates `session_id` and returns an `attachment_id`; `pty_resize` validates `session_id`, `attachment_id`, `attachment_token`, `cols`, and `rows`, then returns `resized=false`.
- `remote.tmux.sessions`, `remote.tmux.attach`, `remote.tmux.detach`, `remote.tmux.state`, `remote.tmux.mirror`, and `remote.tmux.window`: recognized as compatibility commands but return `unsupported=true`, because aiopsterm does not implement control_compat remote tmux control-mode mirroring in the control socket.

This slice deliberately keeps remote execution visible. It does not create hidden SSH control streams, remote daemons, or background tmux mirrors. Automation that needs a remote shell should configure/reconnect a visible SSH panel and then use normal terminal controls against that panel.

The session restore slice adds control_compat-style saved layouts for the shared main work panel:

- `session.save`: ask the active renderer to export the current work-panel layout and persist it.
- `session.list`: list saved session snapshots.
- `session.show`: inspect one saved snapshot, defaulting to `latest`.
- `session.restore`: restore one saved snapshot into the shared main work panel.
- `session.clear`: remove one saved snapshot.

The Agent Hibernation slice adds explicit managed-agent lifecycle controls:

- `agent-hibernation.status`: return the current hibernation config, managed session summaries, and a workspace snapshot.
- `agent-hibernation.on` and `agent-hibernation.off`: enable or disable explicit hibernation controls.
- `agent-hibernation.preview`: return the current automatic reaper candidates without hibernating anything.
- `agent-hibernation.sweep`: run one automatic reaper pass.
- `agent.status`: alias for `agent-hibernation.status`.
- `agent.hibernate`: hibernate one managed AI session by `sessionId`, with optional `source` when ids are ambiguous.
- `agent.resume`: focus one managed AI session and write its stored resume command into the owning local terminal.

The Agent Teams slice adds control_compat-style multi-agent launch primitives for aiopsterm local connection terminals:

- `agent.team.launch`: create one or more visible local terminal surfaces, start local shells, write each agent launch command through terminal command security, and group the created surfaces.

This starts agents in terminals owned by aiopsterm's main work panel. It does not manage the embedded right-side Codex panel and does not use external OS terminals.

The Agent Session slice adds control_compat-style local socket primitives for AI session manager records:

- `agent.session.list`: list managed AI sessions, optionally filtered by `source`, `state`, `query`, or `needsInput`.
- `agent.session.show` / `agent.session.get`: inspect one session by `sessionId`, with optional `source` when ids are ambiguous.
- `agent.session.reply`: record a decision such as `allow`, `always`, `bypass`, `deny`, `reply`, or `handled`.
- `agent.session.approve`, `agent.session.deny`, and `agent.session.handle`: convenience aliases over `reply`.
- `agent.session.rename`: set the user-facing managed session title.
- `agent.session.clear`: remove the managed AI session record.
- `agent.session.bulk`: run `mark-handled`, `clear-ended`, or `clear-all` over managed AI session records, optionally filtered by source/session id.

The Feed aliases expose the same managed AI queue with control_compat-style names:

- `feed.list`: list sessions that currently need input. Passing `pending_only=false` over the raw socket lists all managed AI sessions, while the CLI keeps `feed list` focused on pending items unless `--all` is used.
- `feed.jump`: resolve a control_compat-style `workstream_id` to a managed AI session, matching session id, request id, event id, panel id, terminal session id, or workspace id when present.
- `feed.push`: accept a control_compat-style feed event and record it in the managed AI session store. aiopsterm returns immediately with `waited=false`; blocking hook decisions should be completed with the reply methods instead of keeping the control socket open.
- `feed.permission.reply`: resolve a pending managed AI request by `request_id` and record a permission decision. Supported modes map to managed decisions: `once` -> `allow`, `always`/`all` -> `always`, `bypass` -> `bypass`, and `deny` -> `deny`.
- `feed.question.reply`: resolve a pending question by `request_id` and record a text or selection reply.
- `feed.exit_plan.reply`: resolve a pending plan request by `request_id` and record the selected mode. `bypassPermissions` maps to `bypass`, `deny` maps to `deny`, and accepted plan modes map to `allow`.
- `feed.mark-handled`: mark all pending managed AI requests handled.
- `feed.clear-ended`: remove ended managed AI sessions.
- `feed.clear`: clear all managed AI session records; this requires `confirm=true`.

`agent.sessions.*` and `ai.session.*` are accepted aliases for scripts that group these methods differently.

The surface resume slice adds control_compat-style resume bindings for visible work-panel surfaces:

- `surface.resume.set`: attach a resume command to the current or selected surface.
- `surface.resume.get` / `surface.resume.show`: read the selected surface's resume binding.
- `surface.resume.trust`: explicitly mark the selected resume binding as trusted for manual or automatic recovery.
- `surface.resume.preview`: list current resume bindings and explain whether each one is ready for trusted automatic recovery.
- `surface.resume.autorun`: run only trusted automatic resume bindings through terminal command security.
- `surface.resume.clear`: remove a binding, optionally guarded by checkpoint/source.
- `surface.resume.run`: explicitly write the stored command into the selected terminal through aiopsterm terminal command security.

The surface action slice adds control_compat-style action dispatch for shared work-panel terminal surfaces:

- `surface.action`, `tab.action`, and `workspace.action`: run non-browser actions against the selected surface or workspace. Implemented actions include `rename`, `clear_name`, `new_terminal_right`, `close_left`, `close_right`, `close_others`, and the detach-to-workspace aliases, which map to aiopsterm's visible terminal panel model.
- Browser actions such as `reload`, `duplicate`, and `new_browser_right` return structured unsupported responses because aiopsterm does not implement control_compat browser surfaces.
- `pin`, `unpin`, `mark_read`, and `mark_unread` currently return structured unsupported responses; aiopsterm has workspace-group pinning and AI/notification unread state, but not per-surface pin/unread state.

The events slice adds a control_compat-style local JSONL stream for automation:

- `events.stream` / `event.subscribe`: take over the socket connection and stream `ack`, replayed `event`, live `event`, and `heartbeat` frames.
- `events.list`: list retained events for simple polling and tests.
- `mobile.events.subscribe`: accept control_compat mobile-event subscription probes using `stream_id` plus `topics`, returning `already_subscribed` with idempotent replace semantics.
- `mobile.events.unsubscribe`: remove a registered mobile event subscription and return `removed`.

The synchronization slice adds control_compat-style automation rendezvous:

- `sync.wait_for`: wait for or signal a named local token. `wait-for` and `wait_for` are aliases.

The terminal buffer slice adds tmux/control_compat-style runtime text buffers:

- `terminal.buffer.set`, `terminal.buffer.list`, `terminal.buffer.show`, `terminal.buffer.save`, `terminal.buffer.paste`: set, list, read, export, and paste named text buffers.

The tmux compatibility metadata slice adds non-structural compatibility commands:

- `tmux.hook.set`, `tmux.hook.list`, `tmux.hook.unset`: store, list, and remove tmux-style hook definitions as automation metadata.
- `tmux.option.show`: reports supported tmux compatibility options. `extended-keys` is reported as `on`.
- `set-option`, `set-window-option`, `source-file`, `refresh-client`, `attach-session`, and `detach-client`: accepted as explicit no-op compatibility commands for scripts that probe tmux behavior.
- `popup`, `bind-key`, `unbind-key`, and `copy-mode`: recognized placeholders that return a structured unsupported response.

The terminal history slice adds renderer-owned scrollback cleanup:

- `terminal.clear_history` / `surface.clear_history`: clear a selected terminal surface's visible buffer and retained panel output.

The terminal respawn slice adds a control_compat-compatible restart-command bridge:

- `terminal.respawn` / `surface.respawn`: send a restart command to a selected terminal surface through terminal command security.

The pane layout slice adds control_compat/tmux-style structural controls over the shared main work panel:

- `pane.break`: detach a surface from its current split group and keep it as a normal tab.
- `pane.join`: attach a source surface next to a target surface, using `direction=right` or `direction=below`.
- `pane.swap`: swap two surfaces' split placement metadata without swapping their terminal sessions or xterm buffers.
- `pane.resize`: accepted as a compatibility command, but currently returns `unsupported=true` because aiopsterm split panes use an equal-size layout and do not store per-pane dimensions.
- `workspace.next`, `workspace.previous`, `workspace.last`, `workspace.select`, `pane.focus`, `pane.last`, and `workspace.find`: control_compat/tmux-style navigation and lookup over the same shared main work panel.
- `pane.list`, `workspace.create`, `surface.split`, `workspace.rename`, `workspace.close`, `surface.close`, `workspace.has_session`, and `workspace.select_layout`: tmux-compatible list/create/rename/close/layout verbs over the shared main work panel.
- `pane.surfaces`: return the surface hosted by a selected shared-work-panel pane. In aiopsterm's current model a pane maps to one visible terminal/knowledge surface.
- `new-workspace`, `current-workspace`, `select-workspace`, `close-workspace`, `list-panels`, `list-pane-surfaces`, `close-surface`, `new-split`, and `new-pane`: control_compat legacy aliases accepted by the CLI/backend and routed to the structured workspace, surface, and pane methods above. `new-pane` currently creates a split-compatible shared work-panel surface rather than a separate hidden pane container.
- `surface.focus`, `surface.create`, and `pane.create`: structured control_compat primitives accepted by the CLI/backend and implemented by the existing shared main work panel. They create or focus aiopsterm-owned visible local terminal surfaces only.
- `surface.report_tty`, `surface.report_shell_state`, and `surface.ports_kick`: terminal-side telemetry primitives. They update renderer-owned surface metadata and are exposed through `surface.list`, `surface.current`, and `workspace.snapshot`.
- `surface.move`, `surface.reorder`, and `surface.split_off`: reorder visible surfaces or detach a split surface inside the shared main work panel. Moving a surface to a target pane maps to the existing split attach behavior.
- `surface.refresh`, `surface.health`, and `surface.trigger_flash`: refit visible terminal surfaces, report surface render readiness, and visually flash/focus a selected surface.
- `workspace.reorder`, `workspace.reorder_many`, and `workspace.equalize_splits`: reorder shared-work-panel surfaces or refit equal-size split panes. `workspace.move_to_window` is recognized but returns `unsupported=true` because aiopsterm currently exposes one main work panel per app window.
- `workspace.prompt_submit`: writes the prompt text to the selected terminal surface through the existing terminal command security path. It may return `needs-approval` when the command security policy requires confirmation.

The workspace metadata compatibility slice adds control_compat-style workspace metadata controls:

- `workspace.env`: returns workspace environment metadata that was supplied through `workspace.create` / CLI `new-window --workspace-env KEY=VALUE`. Like control_compat, these values are not included in `workspace.list` or ordinary snapshot summaries except for key/count metadata.
- `workspace.set_auto_title`: applies an automation-generated title to the selected visible panel only when the title is not user-owned. `probe=true` reports whether the target is user-owned without changing titles.

aiopsterm records workspace env metadata for compatibility, but this slice does not inject those variables into already-running terminal sessions. Future terminal creation can decide explicitly whether to merge this metadata into launch environments.

The sidebar metadata slice adds control_compat-style status channels for local automation:

- `sidebar.status.set`, `sidebar.status.clear`, `sidebar.status.list`: manage keyed status entries.
- `sidebar.progress.set`, `sidebar.progress.clear`: manage a workspace progress value.
- `sidebar.log.append`, `sidebar.log.clear`, `sidebar.log.list`: manage bounded log entries.
- `sidebar.state`: return status, progress, and log metadata in one payload.

The Agent Vault slice adds custom agent launch metadata for visible local-terminal automation:

- `agent.vault.register`: register a custom agent id and command templates.
- `agent.vault.list`: list registered custom agents.
- `agent.vault.get`: read one custom agent definition.
- `agent.vault.render`: render a launch, resume, or fork command from a template.
- `agent.vault.identify`: match a supplied process snapshot against registered detection rules and render resume/fork commands when a session id is available.
- `agent.vault.scan`: inspect descendants of aiopsterm visible local-terminal shell processes, match them against Vault registrations, and render resume/fork commands.
- `agent.vault.remove`: remove one custom agent definition.

Aliases are accepted for control_compat-compatible scripts where useful:

- `tree` and `top` map to `workspace.snapshot`.
- `list_workspaces` and `list-workspaces` map to `workspace.list`.
- `list_surfaces` and `list-surfaces` map to `surface.list`.
- `list_terminals` and `debug.terminals` map to `terminal.list`.
- `focus_terminal` and `focus-panel` map to `terminal.focus`.
- `mobile host-status` maps to `mobile.host.status`; `mobile workspace-list` maps to `mobile.workspace.list`.
- `mobile events subscribe` and `mobile events unsubscribe` map to `mobile.events.subscribe` and `mobile.events.unsubscribe`.
- `mobile chat sessions|history|send|interrupt|answer` maps to `mobile.chat.*`; `chat sessions dump` maps to `chat.sessions.dump`.
- `mobile attach-ticket create` maps to `mobile.attach_ticket.create`.
- `terminal create`, `terminal input`, `terminal paste`, `terminal replay`, and `terminal viewport` map to the matching control_compat-style terminal data-plane methods.
- `read-screen`, `capture-pane`, and `surface.read_text` map to `terminal.read_screen`.
- `clear-history` and `surface.clear_history` map to `terminal.clear_history`.
- `respawn-pane` and `surface.respawn` map to `terminal.respawn`.
- `break-pane`, `join-pane`, `swap-pane`, and `resize-pane` map to `pane.break`, `pane.join`, `pane.swap`, and `pane.resize`.
- `next-window`, `previous-window`, `last-window`, `select-window`, `select-pane`, `last-pane`, and `find-window` map to `workspace.*`, `pane.*`, and shared-panel lookup commands.
- `list-windows`, `current-window`, `list-panes`, `new-window`, `split-window`, `rename-window`, `kill-window`, `kill-pane`, `has-session`, and `select-layout` map to shared-panel management commands.
- `workspace env` and `workspace set-auto-title` map to `workspace.env` and `workspace.set_auto_title`.
- `surface focus`, `surface create`, `pane create`, `surface report-tty`, `surface report-shell-state`, and `surface ports-kick` map to the matching structured `surface.*` / `pane.*` primitives.
- `workspace remote status`, `configure`, `reconnect`, `disconnect`, `foreground-auth-ready`, `pty-sessions`, `pty-bridge`, and `pty-resize` map to `workspace.remote.*` visible SSH panel controls and structured remote PTY compatibility probes.
- `remote tmux sessions`, `attach`, `detach`, `state`, `mirror`, and `window` map to `remote.tmux.*` compatibility placeholders.
- `send`, `send-panel`, and `surface.send_text` map to `terminal.send_text`.
- `send-key`, `send-key-panel`, and `surface.send_key` map to `terminal.send_key`.
- `project open`, `project get-state`, `project set-*`, `markdown open`, and `file open` map to the `project.*`, `markdown.open`, and `file.open` compatibility methods.
- `wait-for` maps to `sync.wait_for`.
- `display-message` maps to `notification.create`; `display-message -p` prints locally without using the socket.
- `set-buffer`, `show-buffer`, `save-buffer`, `paste-buffer`, and `list-buffers` map to `terminal.buffer.*`.
- `set-hook`, `show-options`, `show-option`, `set-option`, `set-window-option`, `source-file`, `refresh-client`, `attach-session`, `detach-client`, `popup`, `bind-key`, `unbind-key`, and `copy-mode` map to tmux compatibility metadata/no-op/placeholder commands.
- `set-status`, `clear-status`, `list-status`, `set-progress`, `clear-progress`, `log`, `clear-log`, `list-log`, and `sidebar-state` map to `sidebar.*` metadata methods.
- `notify` maps to `notification.create`.
- `notify-surface` and `notify-target` map to `notification.create_for_surface` and `notification.create_for_target`.
- `list-notifications` maps to `notification.list`.
- `open-notification` maps to `notification.open`.
- `jump-to-unread` maps to `notification.jump_to_unread`.
- `mark-notification-read` maps to `notification.mark_read`.
- `dismiss-notification` maps to `notification.dismiss`.
- `clear-notifications` maps to `notification.clear`.

## Socket Discovery

When aiopsterm starts, it creates a per-process socket under the app user-data directory:

- Linux/macOS: `<userData>/control/aiopsterm-control-<pid>.sock`
- Windows: `\\.\pipe\aiopsterm-control-<pid>`

Local terminal sessions launched through aiopsterm receive:

- `AIOPSTERM_CONTROL_SOCKET`: control socket path.
- `AIOPSTERM_TERMINAL_SESSION_ID`: current terminal backend session id.
- `AIOPSTERM_PANEL_ID` and `AIOPSTERM_SURFACE_ID`: owning terminal panel id when known.

## Protocol

Requests and responses are one JSON object per line.

Request:

```json
{"id":"request-1","method":"terminal.list","params":{}}
```

Response:

```json
{"id":"request-1","ok":true,"data":{"terminals":[],"count":0}}
```

Errors use the common mutation shape:

```json
{"id":"request-1","ok":false,"errorCode":"TERMINAL_PANEL_NOT_FOUND","errorMessage":"Terminal panel not found."}
```

## CLI Helper

The packaged helper is `resources/aiopsterm-control.js`. It defaults to `AIOPSTERM_CONTROL_SOCKET`, so it works naturally inside an aiopsterm local terminal:

```bash
node /path/to/resources/aiopsterm-control.js terminal list
node /path/to/resources/aiopsterm-control.js capabilities
node /path/to/resources/aiopsterm-control.js identify --panel "$AIOPSTERM_PANEL_ID" --session "$AIOPSTERM_TERMINAL_SESSION_ID"
node /path/to/resources/aiopsterm-control.js rpc terminal.list --params-json '{"limit":2}'
node /path/to/resources/aiopsterm-control.js hooks list
node /path/to/resources/aiopsterm-control.js hooks setup
node /path/to/resources/aiopsterm-control.js hooks setup --agent codex
node /path/to/resources/aiopsterm-control.js hooks uninstall codex
node /path/to/resources/aiopsterm-control.js auth login
node /path/to/resources/aiopsterm-control.js system tree
node /path/to/resources/aiopsterm-control.js settings open --target models
node /path/to/resources/aiopsterm-control.js feedback open
node /path/to/resources/aiopsterm-control.js sidebar snapshot
node /path/to/resources/aiopsterm-control.js markdown open commands/diagnose.md --line 2
node /path/to/resources/aiopsterm-control.js file open commands/diagnose.md Markdown语法指南.md
node /path/to/resources/aiopsterm-control.js project open commands/diagnose.md
node /path/to/resources/aiopsterm-control.js project get-state --surface kb:commands/diagnose.md
node /path/to/resources/aiopsterm-control.js window list
node /path/to/resources/aiopsterm-control.js window focus --window window:1
node /path/to/resources/aiopsterm-control.js app focus-override active
node /path/to/resources/aiopsterm-control.js workspace snapshot
node /path/to/resources/aiopsterm-control.js workspace-group list
node /path/to/resources/aiopsterm-control.js workspace-group create --name "deploy" --from panel-1,panel-2
node /path/to/resources/aiopsterm-control.js workspace-group focus workspace_group:1
node /path/to/resources/aiopsterm-control.js session save --id latest --name "Work Layout"
node /path/to/resources/aiopsterm-control.js session list
node /path/to/resources/aiopsterm-control.js session restore --id latest
node /path/to/resources/aiopsterm-control.js surface list
node /path/to/resources/aiopsterm-control.js surface resume set --kind tmux --checkpoint work --shell "tmux attach -t work"
node /path/to/resources/aiopsterm-control.js surface resume trust --panel panel-main --policy auto --reason "trusted tmux session"
node /path/to/resources/aiopsterm-control.js surface resume preview --panel panel-main
node /path/to/resources/aiopsterm-control.js surface resume autorun --panel panel-main
node /path/to/resources/aiopsterm-control.js surface resume show --json
node /path/to/resources/aiopsterm-control.js surface resume run --panel panel-main
node /path/to/resources/aiopsterm-control.js surface resume clear --checkpoint work
node /path/to/resources/aiopsterm-control.js agent-hibernation status
node /path/to/resources/aiopsterm-control.js agent-hibernation on
node /path/to/resources/aiopsterm-control.js agent-hibernation preview
node /path/to/resources/aiopsterm-control.js agent-hibernation sweep
node /path/to/resources/aiopsterm-control.js agent hibernate --session codex-session-1 --source codex
node /path/to/resources/aiopsterm-control.js agent resume --session codex-session-1 --source codex
node /path/to/resources/aiopsterm-control.js agent session list --needs-input
node /path/to/resources/aiopsterm-control.js agent session show claude-session-1 --source claude-code
node /path/to/resources/aiopsterm-control.js agent session approve claude-session-1 --source claude-code
node /path/to/resources/aiopsterm-control.js agent session deny claude-session-1 --source claude-code --message "Use staging first"
node /path/to/resources/aiopsterm-control.js agent session rename claude-session-1 --source claude-code --title "Deploy review"
node /path/to/resources/aiopsterm-control.js agent session clear claude-session-1 --source claude-code
node /path/to/resources/aiopsterm-control.js feed list
node /path/to/resources/aiopsterm-control.js feed mark-handled
node /path/to/resources/aiopsterm-control.js feed clear-ended
node /path/to/resources/aiopsterm-control.js feed clear --yes
node /path/to/resources/aiopsterm-control.js mobile chat sessions --workspace main
node /path/to/resources/aiopsterm-control.js mobile chat send --session claude-session-1 --text "继续"
node /path/to/resources/aiopsterm-control.js mobile attach-ticket create --workspace main --ttl-seconds 600
node /path/to/resources/aiopsterm-control.js agent team launch --source codex --count 3 --cwd "$PWD" --prompt "review this repo"
node /path/to/resources/aiopsterm-control.js agent team launch --source claude-code --count 2 --cwd "$PWD" --prompt "investigate flaky tests"
node /path/to/resources/aiopsterm-control.js agent team launch --source custom --count 2 --command "my-agent --role reviewer --index {{index}}"
node /path/to/resources/aiopsterm-control.js agent vault register --id my-agent --name "My Agent" --process-name my-agent --session-option --session --launch-command "my-agent --cwd {{cwd}} --index {{index}} {{prompt}}" --resume-command "my-agent --session {{sessionId}}"
node /path/to/resources/aiopsterm-control.js agent vault render --id my-agent --kind resume --session session-1
node /path/to/resources/aiopsterm-control.js agent vault identify --process-name my-agent --argv /usr/local/bin/my-agent --argv --session --argv session-1
node /path/to/resources/aiopsterm-control.js agent vault scan --source my-agent --panel panel-main
node /path/to/resources/aiopsterm-control.js agent team launch --source my-agent --count 3 --cwd "$PWD" --prompt "review this repo"
node /path/to/resources/aiopsterm-control.js events --category notification --cursor-file ~/.cache/aiopsterm/events.seq --limit 10
node /path/to/resources/aiopsterm-control.js tree
node /path/to/resources/aiopsterm-control.js terminal read-screen --lines 40
node /path/to/resources/aiopsterm-control.js capture-pane --panel panel-main --lines 200
node /path/to/resources/aiopsterm-control.js pipe-pane --panel panel-main --command "grep ERROR"
node /path/to/resources/aiopsterm-control.js clear-history --panel panel-main
node /path/to/resources/aiopsterm-control.js respawn-pane --panel panel-main --command 'exec ${SHELL:-/bin/bash} -l'
node /path/to/resources/aiopsterm-control.js break-pane --pane panel-2 --focus true
node /path/to/resources/aiopsterm-control.js join-pane --pane panel-2 --target-pane panel-main --direction below
node /path/to/resources/aiopsterm-control.js swap-pane --pane panel-2 --target-pane panel-main
node /path/to/resources/aiopsterm-control.js resize-pane --pane panel-main -R --amount 5
node /path/to/resources/aiopsterm-control.js next-window
node /path/to/resources/aiopsterm-control.js select-pane --target panel-main
node /path/to/resources/aiopsterm-control.js find-window --content --select "deploy"
node /path/to/resources/aiopsterm-control.js list-panes
node /path/to/resources/aiopsterm-control.js current-window
node /path/to/resources/aiopsterm-control.js new-window --name "Scratch"
node /path/to/resources/aiopsterm-control.js split-window -h --target panel-main
node /path/to/resources/aiopsterm-control.js rename-window --target panel-main "Main Ops"
node /path/to/resources/aiopsterm-control.js kill-pane --target panel-2
node /path/to/resources/aiopsterm-control.js terminal focus --panel panel-main
node /path/to/resources/aiopsterm-control.js terminal send --session "$AIOPSTERM_TERMINAL_SESSION_ID" --text $'pwd\n'
node /path/to/resources/aiopsterm-control.js terminal send-key --session "$AIOPSTERM_TERMINAL_SESSION_ID" ctrl+c
node /path/to/resources/aiopsterm-control.js send-panel --panel panel-main "echo hello\n"
node /path/to/resources/aiopsterm-control.js send-key-panel --panel panel-main enter
node /path/to/resources/aiopsterm-control.js wait-for build-ready --timeout 30
node /path/to/resources/aiopsterm-control.js wait-for --signal build-ready
node /path/to/resources/aiopsterm-control.js display-message "deploy done"
node /path/to/resources/aiopsterm-control.js display-message --print "deploy done"
node /path/to/resources/aiopsterm-control.js set-buffer --name deploy "kubectl rollout status deploy/api"
node /path/to/resources/aiopsterm-control.js list-buffers
node /path/to/resources/aiopsterm-control.js show-buffer --name deploy
node /path/to/resources/aiopsterm-control.js save-buffer --name deploy /tmp/deploy-buffer.txt
node /path/to/resources/aiopsterm-control.js paste-buffer --name deploy --panel panel-main
node /path/to/resources/aiopsterm-control.js show-options -v extended-keys
node /path/to/resources/aiopsterm-control.js set-hook after-split-window "display-message split"
node /path/to/resources/aiopsterm-control.js set-hook --list
node /path/to/resources/aiopsterm-control.js popup
node /path/to/resources/aiopsterm-control.js set-status build compiling --priority 80
node /path/to/resources/aiopsterm-control.js set-progress 0.5 --label "Building"
node /path/to/resources/aiopsterm-control.js log --level success --source test "All green"
node /path/to/resources/aiopsterm-control.js sidebar-state
node /path/to/resources/aiopsterm-control.js notify --title "Build done" --body "All tests passed"
node /path/to/resources/aiopsterm-control.js list-notifications
node /path/to/resources/aiopsterm-control.js jump-to-unread
```

Use `--json` for scripting:

```bash
node /path/to/resources/aiopsterm-control.js --json workspace snapshot
```

## Safety Boundary

`system.capabilities`, `system.identify`, and CLI `rpc` are automation plumbing. The first two are read-only probes. `rpc` does not grant extra permission; it sends exactly the requested method and JSON object params through the same control socket dispatcher and inherits that method's safety policy.

`agent.hooks.*` reuses the same explicit installer used by Settings -> AI Preferences. It only writes aiopsterm-owned hook commands, plugin files, or marked config blocks, and uninstall removes only those owned entries. `setup` mirrors control_compat's convenience behavior by skipping installers whose agent binary is not on `PATH`; `install` is for an explicit selected source when the user wants the config written anyway. Hook commands fail open outside aiopsterm-managed local connection terminals and do not take over external OS terminals.

`terminal.send_text` and `terminal.send_key` are raw terminal input primitives, equivalent to typed text or a physical key press in the terminal. They do not run the existing AI command security approval flow, because they may need to send non-command input, prompts, or control sequences. Command-generation and AI-command execution still use the existing renderer security path.

`terminal.read_screen`, `capture-pane`, and `surface.read_text` read visible terminal buffer text from the renderer. The control event stream does not copy that text into event payloads. `pipe-pane` is a CLI-helper convenience: after reading the screen through the socket, the helper runs the user-provided shell command locally with the captured text on stdin.

Future higher-level automation commands should use the control socket but must choose their own safety policy explicitly. For example, a future `terminal.run_command` command can route through command security, while `terminal.send_text` remains raw input.

`sync.wait_for` is an in-process local rendezvous primitive for scripts talking to the same running aiopsterm app. Token names are limited to letters, numbers, `.`, `_`, `:`, and `-`; they are not filesystem paths and are not shared across app restarts. Signaling wakes all current waiters and leaves a bounded one-shot signal for a later waiter. Timeouts return `WAIT_FOR_TIMEOUT`.

`terminal.buffer.*` stores named text snippets in memory in the running main process. It is a tmux/control_compat compatibility primitive, not the OS clipboard and not persisted across app restarts. `show-buffer` returns the text to the caller, and the CLI helper implements `save-buffer` by writing that returned text in the caller process; the main process does not write arbitrary caller paths. `paste-buffer` writes the stored text through the same raw-input boundary as `terminal.send_text`.

`tmux.hook.*` stores compatibility hook definitions as runtime metadata only. aiopsterm does not execute those hook commands automatically. `show-options extended-keys` returns `on` for agent/tmux compatibility probes; unsupported options fail explicitly instead of returning misleading values. The no-op tmux commands exist so scripts that probe or source tmux configuration can continue when those commands do not affect aiopsterm state. `popup`, `bind-key`, `unbind-key`, and `copy-mode` are recognized as tmux compatibility placeholders and return `TMUX_COMPAT_UNSUPPORTED`.

`terminal.clear_history` is renderer-owned because xterm state lives in the active window. It clears the selected terminal surface's visible buffer and aiopsterm's retained panel output; it does not send a command to the shell and does not close or restart the PTY/SSH session.

`terminal.respawn` is also renderer-owned. Unlike raw `terminal.send_text`, it routes the restart command through aiopsterm terminal command security and may return a `needs-approval` decision instead of writing to the shell. It does not close the PTY or SSH channel by itself; the command text controls whether the running shell process is replaced.

`pane.break`, `pane.join`, and `pane.swap` are renderer-owned structural controls. They only update the main work panel's surface layout metadata. They do not write to any shell, close terminal sessions, or reuse the terminal raw-input path. `pane.resize` is deliberately explicit about the current limitation: it returns `unsupported=true`, `resized=false`, and `unsupportedReason` instead of pretending to resize equal-split panes.

`surface.focus`, `surface.create`, and `pane.create` are also renderer-owned. They operate on aiopsterm's visible shared main work panel and do not create hidden OS terminals or manage external shell processes. `surface.report_tty`, `surface.report_shell_state`, and `surface.ports_kick` are metadata reports only: they do not write to the terminal, do not close or reconnect a session, and do not claim that a port scan has completed.

`window.close`, `window.create`, and `window.display` are deliberately non-destructive compatibility probes in this slice. They do not close user windows or create separate native workspaces. `settings.open`, `feedback.open`, `extension.sidebar.snapshot`, and `system.tree` route through the active renderer because those operations depend on UI state; they do not write terminal input or bypass terminal command approval.

Navigation commands are also renderer-owned. Because aiopsterm currently exposes one shared main work panel instead of control_compat's independent workspace windows, `next-window`, `previous-window`, `last-window`, `select-window`, `select-pane`, `last-pane`, and `find-window` move focus among visible aiopsterm surfaces in that shared panel. They do not create windows, start processes, or write terminal input.

Management compatibility commands use the same shared-panel mapping. `new-window` creates a new aiopsterm work-panel tab, `split-window` creates a split panel, `rename-window` renames the selected panel, and `kill-window` / `kill-pane` close selected panels. These commands only operate on aiopsterm-owned panels and do not manage external OS terminals. `select-layout` records whether the requested tmux layout name is understood; pane resizing remains equal-size until aiopsterm stores per-pane dimensions.

`sidebar.*` metadata is a lightweight automation state source, not a command runner. It is stored in memory in the main process, exposed through the socket and events stream, and scoped by `workspaceId` with the current shared work panel defaulting to `main`. The current slice does not force a new right-sidebar UI; renderer surfaces or future MCP tools can consume the metadata through `sidebar.state`.

Agent Hibernation is off by default and only targets coding-agent sessions that were discovered inside aiopsterm-created local connection terminals. `agent.hibernate` asks the renderer to close the owning terminal backend session and then records hibernation metadata in the managed AI session store. It refuses sessions that currently need input or have no resume command. `agent.resume` writes the stored resume command through the same renderer terminal command path used by AI session recovery, so risky commands still pass through terminal command safety approval before any bytes are written to the shell.

The automatic reaper follows the same safety boundary. `agent-hibernation.sweep` only considers live restorable managed AI sessions with resume commands. It never touches the currently visible terminal panes, sessions that need input, running/working sessions, ended sessions, or non-aiopsterm terminal processes. It only selects candidates when live restorable sessions exceed `maxLiveTerminals`, then chooses the oldest idle background candidates just far enough to get back under the limit.

By default `sweep` uses the configured `confirmationSeconds` settle window. The first pass records a compact fingerprint based on session id, terminal session id, lifecycle, state, terminal process id, and agent process facts. A later pass hibernates only if the same candidate is still selected and the fingerprint is unchanged after the confirmation deadline. Terminal text and command output are not stored in this fingerprint or event payload. Scripts can use `agent-hibernation.preview` to inspect candidates without changing state, or `agent-hibernation sweep --no-confirm` for deterministic test automation.

`agent.team.launch` is visible automation. Every created team member is a real local terminal surface, and every launch command is written through the existing renderer terminal command path. If command security requires approval, the member is returned with `status: "needs-approval"` and the normal terminal security prompt is shown. The command builder supports `source=codex`, `source=claude-code`, and `source=custom`. Custom commands may use `{{index}}`, `{{cwd}}`, `{{prompt}}`, `{{role}}`, and `{{model}}` placeholders.

The current Teams slice intentionally stops at visible local-terminal orchestration. control_compat's deeper Codex Teams app-server watcher, which bridges Codex private app-server approvals into Feed, is a separate integration because it owns a private Codex websocket lifecycle and approval response mapping.

`agent.session.*` operates only on the managed AI session store built from hooks/events emitted by agents running in aiopsterm-created local connection terminals. It does not close terminal panels, kill agent processes, disconnect SSH sessions, or take ownership of the visible terminal connection. `clear` removes the AI session manager record only. `reply` records a compact decision; for blocking Claude Code hooks it may resolve the waiting hook through the existing managed-session backend, while stock Codex permission events remain visibility-only because Codex keeps its native approval path. Session summaries intentionally omit raw hook payloads, terminal screen text, typed input, and command output.

`agent.session.bulk` and `feed.*` are batch operations over the same managed session records. `mark-handled` can resolve waiting Claude Code hooks as locally handled, while `clear-ended` and `clear-all` remove only aiopsterm's AI session records. `clear-all` requires an explicit confirmation flag (`confirm=true` or CLI `--yes`) and still does not kill agent processes or terminal panels.

`mobile.chat.*` is a control_compat-compatible view over those same managed AI session records. It does not manage aiopsterm's embedded right-side Codex panel and does not discover external OS terminals; it only operates on agent sessions launched inside aiopsterm-created local connection terminal surfaces. `send`, `interrupt`, and `answer` write raw terminal input to the bound visible terminal, so callers should treat them like typing into that terminal. `history` is currently a safe event-summary transcript page, not a parser for Claude/Codex transcript files.

`mobile.attach_ticket.create` mirrors control_compat's ticket response shape (`ticket`, `attach_url`, `routes`, `expires_at`) but only describes the local aiopsterm control socket. The ticket contains a short-lived bearer token for machine-readable clients, so the CLI hides it unless `--json` is used. It is not a phone pairing feature yet and does not expose a remote listener or bypass the existing control-socket method safety rules.

`surface.resume.*` is restore metadata, not a live process checkpoint. aiopsterm stores a bounded command binding on a visible surface and exposes it through `surface.list`, `surface.current`, and `workspace.snapshot`. Public CLI/socket-created bindings are manual by default; setting `autoResume=true` alone does not authorize automatic execution. A binding becomes auto-runnable only after `surface.resume.trust --policy auto`, which records a command fingerprint and trust metadata on that binding. `surface.resume.preview` reports `ready`, `manual`, `untrusted`, or `terminal-not-connected` reasons before anything runs.

`surface.resume.run` and `surface.resume.autorun` both use the same terminal command security path as AI-generated terminal commands. If the configured command policy requires approval, the normal terminal approval prompt appears before any bytes are written to the shell. Environment values supplied with the binding are optional and obvious sensitive keys such as token, password, secret, credential, auth, bearer, and API key names are dropped before storage.

`session.restore` restores layout and metadata; it does not checkpoint arbitrary live process state. Local terminal panels are recreated as new local shells in the saved working directory. SSH panels are restored as disconnected surfaces with their connection metadata so the user can explicitly reconnect. Saved resume bindings are restored for inspection and manual `surface.resume.run`, but aiopsterm does not automatically run resume commands from a session snapshot.

## Events

`events.stream` mirrors the useful part of control_compat's event stream contract for local tools. A client sends one request line and then keeps reading newline-delimited JSON frames on that same socket. The first frame is always:

```json
{"type":"ack","protocol":"aiopsterm-events","version":1}
```

After the ack, aiopsterm sends retained replay events whose `seq` is greater than `after_seq`, then live events and optional heartbeat frames. The stream supports `after_seq` / `after`, `names` / `name`, `categories` / `category`, and `include_heartbeats=false`. `events.list` accepts the same filters plus `limit`.

`mobile.events.subscribe` / `mobile.events.unsubscribe` are request/response compatibility handshakes for clients that follow control_compat's mobile RPC contract. They record the requested `stream_id` and `topics` and return `already_subscribed` so a liveness probe can decide whether it needs a catch-up replay. Live event frames are still delivered through `events.stream`, which keeps the socket in streaming mode and is safe for local CLI consumers.

Current event categories are:

- `notification`: generic control notifications created, opened, marked read, dismissed, or cleared.
- `terminal`: control-socket terminal focus and raw text-send effects. Text payloads include lengths/byte counts only, not the raw terminal input.
- `workspace`: workspace-group mutations, workspace navigation, visible remote workspace compatibility actions, and remote tmux unsupported compatibility probes.
- `surface`: surface resume mutations, surface create/focus events, and surface telemetry reports.
- `agent`: hibernation and visible agent-team automation mutations.

Events are appended to `<userData>/control/events.jsonl` and the app reloads the newest 4,096 events on startup for replay. `seq` continues from the largest durable event sequence, so cursor files remain useful across app restarts. Clients should still refresh state from `workspace.snapshot`, `surface.list`, and `notification.list` when `ack.resume.gap` is true, because the replay window is bounded.

Notification event payloads include bounded title previews and content lengths; they do not copy full notification bodies into the event stream or JSONL audit log. Terminal input events store lengths and byte counts only, not raw terminal text.

## Agent Vault

Agent Vault is aiopsterm's custom-agent registry for local-terminal automation. It is inspired by control_compat Vault's custom agent registrations. The current aiopsterm slice stores command templates plus process-detection metadata, can identify an agent from a process snapshot supplied by the caller, and can scan visible aiopsterm local terminals on Linux. Pi and OMP are registered by default with `piSessionFile` session ids and `{{executable}} --session {{sessionId}}` resume/fork commands.

`agent.vault.scan` asks the renderer for current visible local terminal summaries, including shell `processId`, optional `processGroupId`, shell name, cwd, panel id, and terminal session id. On Linux, the main process then reads `/proc` only for descendant processes of those known shell PIDs. It does not scan unrelated process trees, SSH remote shells, external OS terminals, or the embedded right-side Codex panel. On non-Linux platforms the command returns an empty unsupported result until a platform-specific process reader is added.

For agents that use `sessionIdSource: { "type": "piSessionFile" }`, scan also checks each matched descendant's open file descriptors under the registered `sessionDirectory` to recover the exact session path. This is a bounded read-only inspection used only for resume/fork command rendering.

Definitions are stored under the app user-data control directory as `agent-vault.json`. A definition includes:

- `id`: stable lowercase id used by `agent team launch --source <id>`.
- `name`: display name used for generated workspace group titles.
- `builtIn`: true for built-in defaults such as Pi and OMP. Built-in entries appear in `agent.vault.list` but are not written as user records when the vault file is persisted.
- `executable`: optional executable placeholder value.
- `detect`: optional process detection rule with `processName`, `argvContains`, `executableContains`, and `commandContains`.
- `sessionIdSource`: optional native session id source. Supported types are `provided`, `argvOption`, `env`, `fixed`, and `piSessionFile`.
- `launchCommand`: template used by visible team launch.
- `resumeCommand`: template for external scripts that need to resume a native session.
- `forkCommand`: template for external scripts that support branching a session.
- `sessionDirectory`: optional default for `{{sessionDir}}`.
- `cwd`: `preserve` or `ignore` for whether identified process cwd should be passed into resume/fork template rendering.

`agent.vault.identify` accepts fields such as `processName`, `executable`, `argv`, `commandLine`, `cwd`, `env`, `pid`, `ppid`, `pgid`, `sessionId`, and `sessionPath`, or the same fields under a `process` object. It returns matched agents, the extracted `sessionId`, and rendered `resumeCommand`/`forkCommand` when possible. `agent.vault.scan` returns the same match shape plus terminal ownership fields such as `panelId`, `terminalSessionId`, `terminalTitle`, and `terminalProcessId`. Both commands are read-only and do not grant Vault authority to kill, close, or resume any terminal.

Supported placeholders are `{{agentId}}`, `{{agentName}}`, `{{executable}}`, `{{cwd}}`, `{{prompt}}`, `{{role}}`, `{{model}}`, `{{index}}`, `{{count}}`, `{{sessionId}}`, `{{sessionPath}}`, and `{{sessionDir}}`.

When `agent team launch --source <registered-id>` is called, the main process renders static placeholders and forwards the request to the existing renderer `agent.team.launch` path as `source=custom`. Dynamic placeholders such as `{{index}}` are preserved for the renderer to expand per visible terminal. The final command is still written through aiopsterm terminal command security, so risky commands keep the same approval behavior as built-in team launch.

## Generic Notifications

Generic notifications are stored in the main process memory queue. They are separate from managed AI session notifications, but both feed the same top-bar attention bell:

- Unread generic notifications become `control-notification` attention items.
- Opening a generic notification marks it read in the main queue.
- If the notification has a `panelId` or `sessionId`, opening it focuses that terminal panel.
- If no target terminal is available, aiopsterm still marks it read and shows a top notice.

The queue is intentionally not persisted in this slice. Session restore and persisted notification history will be handled by the later restore/metadata slices.

## Workspace Snapshot

`workspace.snapshot` is the canonical read model for later control_compat-style workspace groups, session restore, and team automation. It is intentionally read-only in this slice. The payload contains summaries only:

- `workspaces`: one logical `main` workspace for the shared work panel.
- `surfaces`: terminal panels and knowledge editor panels with active/split metadata.
- `terminals`: terminal-only summaries with connection, cwd, SSH target, and xterm size when available.
- `splitGroups`: grouped panel ids for split layouts.
- `workspaceGroups`: control_compat-style surface group metadata for the shared main work panel.
- `resumeBinding` / `resume_binding`: optional surface-level resume command metadata for each surface.
- `agentHibernation`: explicit hibernation config for managed AI sessions.
- `notifications`: generic control notifications currently held by the main process and synced into the renderer.
- `managedAiSessions`: Claude/Codex session summaries without full event transcripts.
- `attention`: top-bell pending items, including managed AI requests and unread generic notifications.
- `counts`: stable totals for scripts that only need status checks.

The snapshot does not include terminal screen text. Use `terminal.read_screen` for screen content after selecting a target `panelId` or `sessionId` from the snapshot.

## Workspace Groups

aiopsterm keeps the user's design constraint that the AI session manager and SSH/local terminal work share one main work panel. Because of that, `workspace.group.*` does not create a second primary workspace surface. It groups existing main-panel surfaces so external automation can name, focus, and restore related terminal/editor panels.

Group members are `panelId` values. For compatibility, CLI flags still use control_compat wording such as `--workspace`; aiopsterm resolves those values as either `panelId` or `sessionId`.

`workspace.group.delete` is destructive because it closes the member panels and attempts to kill any backing terminal sessions. It fails unless the request includes `confirm=true`, or the CLI uses `--confirm`. Use `workspace.group.ungroup` when the intent is only to remove grouping metadata.

Group state is renderer memory in this slice. The later session restore slice will persist and restore group metadata alongside terminal/session state.

## Session Restore

Session snapshots are stored under `<userData>/control/session-snapshots.json`. A snapshot contains:

- terminal and knowledge surface ids, titles, working directories, split metadata, and active panel id.
- workspace group metadata for the shared main work panel.
- SSH connection metadata needed for explicit reconnect.
- surface resume bindings.

Snapshots do not include terminal screen text, typed input, command history, or full managed AI event transcripts. Restoring a snapshot replaces the visible main work-panel layout, closes existing live terminal sessions best-effort, starts saved local shell panels, and leaves saved SSH panels disconnected. This keeps restore visible and avoids silently reconnecting to remote hosts or running saved agent commands.
