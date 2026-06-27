# Threaded Terminal Renderer

aiopsterm has an opt-in threaded terminal path behind `AIOPSTERM_THREADED_TERMINAL=1`. The default xterm path remains available as a compatibility fallback.

## Thread Model

The threaded path follows the same broad pressure-control shape observed in VTE/GNOME Terminal:

- PTY reads are accumulated into an incoming queue instead of being rendered one chunk at a time.
- A scheduler drains queued bytes, updates terminal state, and emits a bounded screen update.
- Paint work is driven from dirty visible content; hidden terminals keep state but do not repaint.

The reference VTE implementation does this with `m_incoming_queue`, `process_incoming()`, a scheduler callback, and dirty-rectangle invalidation before GTK draw. aiopsterm maps that model onto Electron by splitting the work across IPC coalescing, renderer ingress batching, core workers, and an OffscreenCanvas render worker.

The threaded path uses a renderer-side core worker pool plus a render worker:

- Terminal core workers run `@xterm/headless`, parse PTY bytes, maintain scrollback state, track dirty rows, and emit screen snapshots.
- The main renderer keeps only DOM ownership, pane lifecycle, resize calculation, and backend input routing.
- The render worker owns `OffscreenCanvas` 2D contexts and paints snapshots outside the main thread.
- Background terminals keep parsing data but are marked `background`; they do not paint until visible again.

The core pool is intentionally small instead of one worker per terminal:

- 1 worker on low-core machines.
- 2 workers by default on normal machines.
- 3 workers on high-core machines.

Terminals are assigned by session/panel hash with light load balancing. Active panes are `active`, visible inactive panes are `visible`, and hidden/background panes are `background`.

## Data Coalescing

Terminal output is merged at several boundaries:

- The main process uses `terminalDataCoalescer` before `terminal:data` IPC delivery. Small output flushes quickly; bulk output can use the larger bulk merge window unless a caller passes an explicit `maxDelayMs`.
- The renderer batches ingress per terminal with priority-aware timing: active panes flush fastest, visible inactive panes flush near frame cadence, and background panes flush less often.
- Core workers keep a per-terminal `pendingChunks` queue and parse bounded batches into `@xterm/headless`.
- Core workers emit screen snapshots at active/visible/background cadence. Background records keep terminal state and mark a pending full snapshot, but paint messages are dropped until visible.
- The render worker keeps only the newest snapshot per terminal before painting. Stale snapshots are discarded.

The threaded live path writes output directly to the worker-backed terminal. `panel.output` is only a low-frequency tail mirror for search, AI context, tests, and lifecycle state. Threaded mirrors keep smaller foreground/background tails than legacy xterm panes, and cropped strings are detached from their original backing storage so old high-volume output is not retained by sliced strings. The hidden `terminal-output-mirror` DOM node does not bind large live text for threaded terminals, so Vue does not diff every terminal byte while the worker renderer is already painting the real surface.

## RenderGroup Model

The v1 implementation uses one `OffscreenCanvas` per mounted pane while all panes share one render worker. This keeps the existing Vue pane lifecycle intact while moving core parsing and painting off the main thread.

The protocol already carries `groupId` and `surface` so the next renderer step can merge all visible split panes in a workspace region into one large RenderGroup canvas. Codex terminals use a separate group id from workspace panes.

## Fallback

The threaded path is enabled only when all of these are true:

- `AIOPSTERM_THREADED_TERMINAL=1`.
- `VITE_AIOPSTERM_THREADED_TERMINAL=1` for renderer-side test/dev launches that rely on Vite environment injection.
- `Worker` is available.
- `HTMLCanvasElement.transferControlToOffscreen` is available.

If any requirement is missing, aiopsterm logs `renderer.threaded-terminal.unavailable` and creates the existing xterm renderer.

The fallback is the existing main-thread xterm path. It is kept for compatibility with older Chromium/Electron runtimes, unusual canvas environments, and platforms where worker OffscreenCanvas is not available.

## Stress Verification

The focused stress profile is 10 visible foreground terminal panes plus 40 background terminal records. It validates:

- RAF frame intervals.
- Worker paint latency and paint frame time.
- Real PTY echo latency.
- Renderer/main memory samples.
- Canvas count.
- Core/render worker error counts.
- Renderer ingress and history queue backlog.
- Foreground/background switching while all terminal records continue receiving output.

The harness supports several output profiles:

- `mixed-switch`: default release profile. Foreground panes receive frame-cadence small chunks while background panes receive PTY-like bursts, and background panes are swapped into the visible split group.
- `frame-small-chunk`: worst-case 60 Hz small chunks for both foreground and background records.
- `pty-burst`: lower-frequency multi-chunk bursts that stress coalescing behavior.
- `mixed-background`: foreground small chunks with background bursts, without requiring switch-heavy interpretation.

Run the 20-minute release profile with:

```bash
AIOPSTERM_TERMINAL_STRESS=1 VITE_AIOPSTERM_TERMINAL_STRESS=1 VITE_AIOPSTERM_THREADED_TERMINAL=1 AIOPSTERM_TERMINAL_STRESS_PROFILE=mixed-switch AIOPSTERM_TERMINAL_STRESS_DURATION_MS=1200000 AIOPSTERM_TERMINAL_STRESS_SWITCH_INTERVAL_MS=5000 npm run test:e2e -- tests/e2e/terminal-stress.spec.ts --reporter=list
```

Shorter development gates use the same command with `AIOPSTERM_TERMINAL_STRESS_DURATION_MS=10000` or `60000`. A short run passing is not release evidence for the 20-minute target; it is only a smoke or stabilization gate.

The result JSON includes `writes.foreground*` and `writes.background*` counters so the test proves background terminals were receiving data. Memory checks use two explicit renderer GC runs plus DevTools Protocol heap collection before and after the run. The hard retained-object gates use CDP live heap used-size delta, final live heap size, and the post-GC `.heapsnapshot` object summary. `performance.memory` samples remain in the JSON as a diagnostic signal for renderer heap capacity or high-water behavior, but retained-object pass/fail uses CDP live heap and snapshot categories. Heap sampling and snapshot artifacts are written under `test-results/terminal-stress/`.

## Current Limits

The v1 path is built for throughput validation. It keeps selection, rich xterm decorations, and WebGL rendering on the legacy path for now. Threaded rendering supports text output, ANSI foreground/background runs, cursor rendering, resize, direct PTY data, and background no-paint behavior.

WebGL is intentionally deferred: the first threaded renderer uses worker 2D canvas because that covers modern Electron/Chromium machines and avoids GL context count pressure. A later WebGL renderer should keep one context per visible RenderGroup, not one context per terminal.
