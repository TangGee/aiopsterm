# Troubleshooting

## Runtime Logs

aiopsterm writes runtime diagnostics to:

```text
<userData>/logs/aiopsterm-runtime.log
```

When started through `npm run build:start`, Electron preview stdout/stderr is also appended to:

```text
<userData>/logs/electron-preview.log
```

On a normal Linux development run, `<userData>` is usually:

```text
~/.config/aiopsterm
```

The terminal diagnostics include local/SSH terminal create, lifecycle, write, resize, kill, and backend data events. Terminal write logs intentionally record byte counts and session metadata only; command text and secrets are not written to the runtime log.

When reporting a terminal input problem, include the recent `terminal.*` and `renderer.terminal-*` entries from this file.

For lag when opening the `AI 会话` module, check the same runtime log for `ai-agent.managed-event` entries such as `managed_ai.sessions.imported`, then compare them with:

```text
<userData>/agent-sessions/managed-ai-sessions.audit.jsonl
```

Repeated `sessions.imported` or `sessions.git_refreshed` audit entries without user action usually mean a list reload is feeding another background refresh. Import scans are coalesced and cooled down after a run, and git timestamp-only probe results should not emit refresh events; if those entries continue every few hundred milliseconds, capture the adjacent runtime log lines and the audit tail.

For lag when switching from an AI session row to its linked terminal, double-click the row or use the context-menu locate action, then collect the `renderer.managed-ai-session.terminal-switch.*` entries. A normal completed interaction has five entries with the same `interactionId` and increasing `phaseIndex`:

- `requested`: the row or context-menu action reached the renderer; check `trigger`, `previousPanelId`, and the requested session identifiers.
- `target-resolved`: the linked terminal panel was found; check `targetResolveMs`, `targetPanelId`, `targetStatus`, and `samePanel`.
- `panel-activated`: workspace state now targets that terminal; check `panelActivateMs`, `activePanelId`, and `outcome`.
- `ui-frame-ready`: Vue committed the state and the renderer passed two animation-frame callbacks; check `vueCommitMs`, `frameWaitMs`, `uiDurationMs`, and `targetActive`.
- `terminal-frame-ready`: the terminal surface is actually ready. Threaded terminals wait for the render Worker frame acknowledgement; legacy xterm uses the browser-frame fallback. Check `terminalRenderer`, `terminalFrameWaitMs`, `surfaceAttached`, `hostConnected`, `frameSeq`, and final `durationMs`.

`resume-requested` means the session had no live terminal and the restore path was started; its later `resume-finished` or `resume-failed` entry measures that separate restore operation and does not pretend to be a terminal frame. `terminal-frame-timeout`, `unavailable`, `failed`, or `superseded` explains why an interaction did not reach `terminal-frame-ready`. A single row click only selects the session and intentionally does not emit terminal-switch events.

For lag after choosing `打开会话内容` or switching between content workspaces, collect both backend and renderer content-load entries from the runtime log:

- `managed_ai.content.list` / `managed_ai.content.list.failed`: backend transcript lookup and parse time for the requested page. Check `durationMs`, `format`, `records`, `total`, `matchTotal`, `offset`, `limit`, `existedBeforeImport`, and `importAttempted`; successful entries use `executionThread: "worker"` for Codex/Claude JSONL and `executionThread: "main"` for other adapters.
- `managed_ai.content.get-record` / `managed_ai.content.get-record.failed`: full-record lazy load time after expanding a truncated card, with the same `executionThread` field on successful entries.
- `managed_ai.content.delete-record` / `managed_ai.content.delete-record.failed`: transcript record deletion time and whether a backup was created. Check `recordId`, `durationMs`, `backedUp`, `existedBeforeImport`, and `importAttempted`.
- `renderer.managed-ai-content.load` / `renderer.managed-ai-content.load.failed`: renderer-side page wait plus Vue update timing. Check `apiDurationMs`, `durationMs`, `renderSettleMs`, `reason`, `page`, `offset`, `limit`, `records`, `total`, `matchTotal`, and `queryActive`. The log records only whether search is active, not the search text.

For an existing session, content loading should not emit a new `managed_ai.sessions.imported` event and should not depend on git metadata refresh. The renderer loads 20 records per requested page and does not request more records on scroll, viewport fill, polling, or transcript changes. If backend `managed_ai.content.list.durationMs` is low but renderer `renderSettleMs` or total `durationMs` is high, the remaining bottleneck is likely the currently rendered card batch rather than transcript IO.

## Native Crashes

Native crash diagnostics are enabled by `npm run build:start` through `AIOPSTERM_CRASH_DIAGNOSTICS=1`. Official packaged builds keep this diagnostic mode disabled. When enabled, aiopsterm starts Electron's Crashpad reporter early in the main process. Crash dumps are stored locally and are not uploaded:

```text
<userData>/crashes/
```

The app also writes process-level crash diagnostics to the runtime log:

- `electron.render-process-gone`: renderer process crashed or was killed.
- `electron.child-process-gone`: non-renderer Electron child process, such as GPU or utility process, crashed or was killed.
- `process.uncaught-exception` and `process.unhandled-rejection`: JavaScript runtime failures that reached the process boundary.
- `crash-diagnostics.ready`: startup diagnostic state, including whether the previous run ended abnormally and whether crash safe mode is active.

If diagnostic mode is enabled and the previous run did not exit cleanly, the next launch automatically enters crash safe mode once. Safe mode disables threaded terminal rendering, forces the terminal render backend to worker 2D, and disables Electron hardware acceleration for that run. A clean exit clears it for the following launch. `build:start` marks its own planned preview restarts so replacing an existing preview does not look like a crash. Set `AIOPSTERM_CRASH_SAFE_MODE=0` to disable the automatic safe-mode response, or `AIOPSTERM_CRASH_SAFE_MODE=1` to force it for one launch.

For lag while running an interactive program such as `codex` inside a normal local terminal tab, reproduce the slowdown and collect the nearby log entries below:

- `terminal.data.summary`: main-process terminal output throughput. Check `chunks`, `bytes`, `durationMs`, and `maxChunkBytes`.
- `terminal.data.coalesced`: main-process local/SSH terminal output coalescing before IPC delivery. Check `chunks`, `bytes`, `durationMs`, and `maxChunkBytes`.
- `renderer.terminal-data.summary` / `renderer.terminal-data.slow-handle`: renderer-side IPC data handling and append cost before xterm rendering.
- `renderer.terminal-output.summary` / `renderer.terminal-output.slow-write`: xterm display write cost, queue wait, pending backlog, and keyword-highlight cost. Check `chunks`, `writes`, `bytes`, `writeMs`, `queueMs`, `highlightMs`, `maxBatchBytes`, `maxPendingBytes`, and `maxPendingChunks`.
- `codex.data.summary` / `codex.data.coalesced`: main-process output throughput and IPC coalescing for the right-side embedded Codex panel.
- `renderer.codex-output.summary` / `renderer.codex-output.slow-write`: right-side embedded Codex xterm write cost, queue wait, and pending backlog. Check `chunks`, `writes`, `bytes`, `writeMs`, `queueMs`, `maxBatchBytes`, `maxPendingBytes`, and `maxPendingChunks`.
- `control.notification.*` and `native-notification.*`: notification creation, renderer sync, and desktop notification attempts.

The normal terminal and right-side embedded Codex paths both coalesce output before rendering. The main process batches local, SSH, and embedded Codex data before IPC delivery, using a short delay capped near one visual frame so the UI is not held behind a 50ms bulk timer. The renderer then batches pending terminal output with a low-latency timer, writes bounded batches to xterm, and keeps only one `xterm.write()` in flight at a time; if xterm has not completed the previous write callback, later chunks wait and are merged into later bounded writes. This is backpressure, not data dropping: aiopsterm intentionally reduces IPC/write frequency while preserving terminal bytes, subject to the existing terminal scrollback/history limits.

Hidden terminal tabs and inactive embedded Codex conversations keep receiving output in app state, but they do not continuously write to hidden xterm instances. When a tab, split pane, or Codex conversation becomes visible again, aiopsterm syncs the preserved output to xterm once and resumes incremental rendering from there.

### Embedded Codex Startup

When the right-side Codex panel fails with `Codex binary failed health check` and an `ETIMEDOUT` message, aiopsterm failed while validating the bundled Codex CLI with `codex --version` before opening the PTY. The default health-check timeout is 30 seconds. For slow development filesystems or cold package caches, increase it for the app process:

```bash
AIOPSTERM_CODEX_HEALTH_CHECK_TIMEOUT_MS=60000 npm run dev
```

To verify the binary directly, run the path from the error message with `--version`. In a Linux development tree this usually looks like:

```bash
codex/codex-rs/target/x86_64-unknown-linux-gnu/aiopsterm-codex-dev-package/bin/codex --version
```

If direct execution returns quickly but the app still reports `ETIMEDOUT`, collect the surrounding `codex.create.*` and `codex.lifecycle` runtime log entries from `<userData>/logs/aiopsterm-runtime.log`.

### Threaded Terminal Renderer

The worker-based terminal path is enabled by default. Terminal parsing runs in a small `@xterm/headless` worker pool and visible panes paint through shared worker `OffscreenCanvas` RenderGroups. Workspace split panes share one `workspace-main` canvas, right-side Codex terminals share one `codex-side` canvas, and hidden/background terminals keep core state without allocating their own canvas. The release default RenderGroup backend is worker 2D. Set `AIOPSTERM_TERMINAL_RENDER_BACKEND=webgl2` only when validating the experimental WebGL2 backend. If Worker or OffscreenCanvas support is missing, aiopsterm logs `renderer.threaded-terminal.unavailable` and falls back to the normal xterm renderer. Set `AIOPSTERM_THREADED_TERMINAL=0` to force the legacy xterm renderer for compatibility checks.

Useful threaded renderer log events:

- `renderer.threaded-terminal.core-pool-created`: core worker count selected from hardware concurrency.
- `renderer.threaded-terminal.created`: panel/conversation assigned to a core worker and RenderGroup.
- `renderer.threaded-terminal.render-group-attached`: actual RenderGroup backend and worker WebGL renderer strings.
- `renderer.threaded-terminal.core-perf`: parser throughput, pending bytes, snapshot cost, and dropped background paints.
- `renderer.threaded-terminal.render-perf`: render worker frame timings.
- `renderer.codex-terminal.created` with `threaded: true`: right-side Codex terminal is using the threaded path.

The opt-in stress test is intentionally not part of normal CI. To run the requested 10 foreground / 40 background terminal stress profile:

```bash
AIOPSTERM_TERMINAL_STRESS=1 VITE_AIOPSTERM_TERMINAL_STRESS=1 AIOPSTERM_TERMINAL_STRESS_PROFILE=mixed-switch AIOPSTERM_TERMINAL_STRESS_DURATION_MS=1200000 AIOPSTERM_TERMINAL_STRESS_SWITCH_INTERVAL_MS=5000 npm run test:e2e -- tests/e2e/terminal-stress.spec.ts --reporter=list
```

The default duration is 20 minutes. For local smoke runs, lower `AIOPSTERM_TERMINAL_STRESS_DURATION_MS`. `AIOPSTERM_TERMINAL_STRESS_PROFILE` can be `mixed-switch`, `frame-small-chunk`, `pty-burst`, or `mixed-background`; the release profile is `mixed-switch`.

To verify that WebGL2 is actually backed by hardware GPU rather than SwiftShader, build first and run:

```bash
npm run build
npm run probe:terminal-gpu
```

The probe launches the built app in normal Electron, explicitly enables `AIOPSTERM_TERMINAL_RENDER_BACKEND=webgl2`, creates temporary stress terminals, and prints `terminalBackend`, `hardwareLikely`, `environment.gpuFeatureStatus`, and `terminalRenderGroups[].gpu`. `terminalBackend: "webgl2"` proves the experimental WebGL terminal RenderGroup path is active. `hardwareLikely: true` requires non-software renderer strings such as NVIDIA/AMD/Intel/Mesa hardware and enabled `gpu_compositing`, `webgl`, and `webgl2`. Playwright stress runs may report SwiftShader because the test launcher can disable hardware acceleration; use `probe:terminal-gpu` for hardware proof.

The stress output prints these key fields:

- `profile` and `writes.foreground*` / `writes.background*`: confirms which traffic profile ran and that background terminals actually received output.
- `p95FrameMs`, `p99FrameMs`, `maxFrameMs`: renderer RAF frame intervals. Sustained values above one visual frame indicate user-visible jank.
- `paintLatency`: time from writing a marker to seeing a rendered worker frame.
- `paintFrameMs`: render-worker paint duration. Low paint time with high frame time usually points at main-thread scheduling or queue backlog, not canvas drawing.
- `paintRows`, `paintScrollRows`, `paintFullFrames`, `paintFullReasons`, and `paintRepaintReasons`: paint coverage for marker writes. `paintRows` tracks dirty-row and visible-row repaints. `paintScrollRows` is reserved for diagnostics if a future pixel-scroll path is enabled; the current VTE-aligned path repaints visible rows for viewport movement instead of copying stale canvas pixels. `create`, `import`, `settings`, `resize`, `visibility`, and `clear` are management full-frame reasons. `paintRepaintReasons.jump` means a viewport catch-up repainted visible rows without clearing the whole canvas. Normal PTY/output marker writes should stay dirty-row or known-reason visible-row repaints instead of producing `unknown` full frames.
- `realEchoLatency`: actual PTY write-to-echo latency.
- `memory.postGcHeapDeltaMb`, `memory.beforeGcHeapMb`, `memory.afterGcHeapMb`, and `workingSetDeltaMb`: renderer memory diagnostics after the harness stops writing and runs renderer GC twice. These can include heap capacity and high-water behavior.
- `gpu`, `threaded.renderGroups`, `memory.samples[].renderGroupCount`, and `memory.samples[].renderGroupCanvasCount`: verifies terminal rendering uses visible-region groups rather than one canvas/context per terminal, and records requested/actual backend plus WebGL renderer strings.
- `queues.maxIngress*` and `queues.maxHistory*`: renderer-side backlog for incoming terminal data and low-frequency history mirrors.
- `switches.count`, `switches.failed`, `switches.paintLatency`: foreground/background switch coverage. The test swaps background terminals into the visible split group while all terminal records continue receiving output.
- `threaded.coreDebug` and `threaded.renderDebug`: worker pending bytes and error counts.
- `heapArtifacts`: DevTools heap sampling and heap snapshot files under `test-results/terminal-stress/`, plus CDP baseline/final live heap used size, live heap delta, allocation hotspots, and post-GC object summaries. Retained-object pass/fail uses these CDP live heap and snapshot fields.

If `terminal.data.summary` is high but renderer timings are low, the terminal program is simply producing a large stream. If `terminal.data.coalesced` regularly combines many chunks, the backend is reducing IPC pressure as expected. If `renderer.terminal-output.slow-write` shows high `writeMs`, `queueMs`, or `maxPendingBytes` around the freeze, the bottleneck is xterm rendering throughput. If `renderer.terminal-data.slow-handle` appears instead, inspect renderer state append and ZMODEM handling. If the timestamps line up with `control.notification.*` or `native-notification.*`, test again with desktop notifications disabled in Settings > AI > Notifications to isolate the notification path.

## SSH Jump Host Diagnostics

SSH and jump-host lifecycle logs include structured routing and authentication metadata. These fields are safe to share for debugging because they do not include passwords, private keys, passphrases, OTP values, command text, or terminal output:

- `authScope`: `jump` means the prompt or connection step belongs to the jump host; `target` means it belongs to the final SSH target.
- `authPurpose`: `password` for password prompts, `keyboard-interactive` for OTP / dynamic-code prompts.
- `sshTransport`: `direct`, `proxy`, `jump`, or `relay-shell`.
- `targetHost`, `targetPort`, `targetUsername`: the final SSH target.
- `jumpHost`, `jumpPort`, `jumpUsername`: the jump host used to reach the target.
- `sshAuthMethods`: enabled auth method names only, such as `password`, `privateKey`, `agent`, and `keyboard-interactive`.
- `connectionReuse`: `created` means aiopsterm opened a new authenticated SSH connection; `reused` means it reused an existing app-managed SSH connection or relay master for a new terminal channel.
- `remoteHop`: for relay-shell connections, `relay` means the nested shell is still on the jump host and `target` means the target prompt has been inferred.
- `expectedHost`, `actualHost`, `actualUsername`, `endpointConfidence`: non-secret endpoint metadata used to infer whether the terminal is currently on the jump host or the target.

For a jump-host failure, read entries in this order:

1. `terminal.keyboard-interactive.request` with `authScope: "jump"` shows a jump-host password or dynamic-code prompt.
2. `terminal.lifecycle` with `sshTransport: "jump"` and `stage: "proxy-opening"` shows the jump host and final target for the tunnel.
3. `terminal.lifecycle` with message `Opening SSH jump tunnel ...` means the jump host authenticated and aiopsterm is opening `forwardOut` to the target.
4. `terminal.lifecycle` with `authScope: "target"` and `sshTransport: "jump"` means the target SSH handshake is starting through that tunnel.

If the log reaches step 3 and direct TCP forwarding is rejected, aiopsterm now falls back to `relay-shell` mode when a PTY runtime is available. In this mode aiopsterm starts local OpenSSH to the jump host first, waits until the interactive relay shell appears, then writes the nested `ssh <target>` command into that PTY, matching manual relay workflows such as `/home/tlinux/bin/1ssh`. Authentication prompts, host-key confirmations, and dynamic-password prompts from local OpenSSH are left in the terminal stream; aiopsterm does not write the nested target command while the latest relay output still looks like an authentication prompt.

aiopsterm owns SSH connection reuse instead of relying on the user's `~/.ssh/config`. Direct ssh2 sessions reuse an authenticated target client for repeated sessions to the same endpoint inside the current app process; each terminal opens a new shell channel on that client. Saving a password is not required for current-process reuse after one successful manual password entry, but saved passwords are still required to reconnect automatically after the app restarts. Standard jump-host sessions reuse the authenticated jump client for new `forwardOut` channels and also reuse the authenticated target client when the same target is opened again. Relay-shell fallback uses a self-owned OpenSSH master for the first hop only, with `ControlMaster=auto`, `ControlPersist=yes`, and an aiopsterm control socket under the app user-data directory; the nested `ssh <target>` still runs inside the relay environment so enterprise relay login systems keep their own behavior. Lifecycle logs show `connectionReuse: "created"` or `"reused"` for these paths.

Relay-shell startup is compatible with restricted jump shells: aiopsterm does not run relay-side helper commands such as `printf`, `export`, `hostname`, `pwd`, or `stty`. After the relay prompt appears, aiopsterm writes only the nested `ssh <target>` command into the PTY and hides that echoed command from terminal output when the PTY echoes it back. The lifecycle message `SSH relay shell connected; starting nested SSH ...` means aiopsterm has seen the relay prompt and has written the nested target command. A later `remoteHop: "target"` / `stage: "shell-ready"` with `endpointConfidence: "inferred"` means the target prompt was inferred from terminal output. If a configured target is an IP address, `expectedHost` remains that IP and `actualHost` may be the remote hostname shown in the prompt; use `remoteHop: "target"` plus the visible terminal prompt to confirm the nested target shell started.

Because relay-shell mode uses local OpenSSH in a PTY, password, dynamic-password, and host-key prompts are shown in the terminal stream instead of the global aiopsterm authentication dialog. This allows existing jump-host SSH config and target-side passwordless login to work, but saved aiopsterm target passwords are not injected into the local OpenSSH command.

For direct or jump-tunnel ssh2 connections, aiopsterm no longer opens a password dialog before the first network authentication attempt when no password is saved. This avoids a fake prompt on hosts that may support SSH Agent, keychain, or target-side passwordless login. If the real SSH server rejects authentication and the asset can use password auth, aiopsterm then opens the password dialog and can remember the password after a successful retry.

The app-owned ssh2 paths use a 120-second default SSH ready timeout for terminal sessions, SFTP file sessions, SSH tunnels, and host connection tests. This matches interactive jump-host and dynamic-password flows better than ssh2's 20-second library default.

## Files And SFTP

The Files workspace lists remote directories through SFTP. A host opened through relay-shell or a configured jump-host path does not expose an SFTP channel to aiopsterm yet, so the file browser shows:

```text
该主机通过跳板机/relay shell 登录，文件管理暂不支持 SFTP。请使用支持 SSH TCP 转发的跳板机，或在终端内使用 scp/rsync。
```

This is an explicit unsupported state rather than a generic connection crash. For these hosts, keep using terminal commands such as `scp` or `rsync`, or configure a jump path that supports SSH TCP forwarding once Files/SFTP jump tunneling is implemented.
