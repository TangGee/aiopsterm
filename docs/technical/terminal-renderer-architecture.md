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

## Geometry Ownership

Threaded terminal geometry follows VTE's single-source model. The main renderer host owns font measurement and pane geometry because it is the component that can see the actual DOM box, scrollbar reservation, settings, and split-pane lifecycle. It measures printable ASCII glyphs on a 2D canvas, takes the widest cell width, applies line height, and computes one `TerminalGeometry` object containing canvas size, columns, rows, cell size, baseline, and residual padding.

The core worker receives only `cols` and `rows` from that geometry. The render worker receives the full geometry and never remeasures text or infers cell size from its own canvas context. Drawing, cursor placement, selection overlay, hidden textarea placement, and resize messages all use the same host-owned metrics. Split-pane zero-size or tiny intermediate layouts are deferred instead of being sent to the core as temporary `2x1` resizes, matching VTE's approach of converting the widget allocation into grid size once and then applying that grid consistently to terminal state and drawing.

Split-pane layout must not let terminal content feed back into pane allocation. `.terminal-pane` uses a single `minmax(0, 1fr)` content column, the title row truncates long panel titles and working directories, and `.xterm-host` fills the pane's assigned box with `width: 100%` and `height: 100%`. This keeps the DOM allocation as the single source of truth for host measurement. Small panes may legitimately wrap shell output because the PTY received fewer columns, but the canvas must not be wider than the pane and then hidden by the parent.

The core pool is intentionally small instead of one worker per terminal:

- 1 worker on low-core machines.
- 2 workers by default on normal machines.
- 3 workers on high-core machines.

Terminals are assigned by session/panel hash with light load balancing. Active panes are `active`, visible inactive panes are `visible`, and hidden/background panes are `background`.

## Painting And Scrolling

The worker renderer follows VTE's correctness model before applying aggressive canvas reuse:

- Terminal state lives in the core worker. The render worker is a paint target, not the source of truth.
- Text is painted on a fixed terminal cell grid. The renderer does not draw a whole row with browser natural text layout because shell output such as `ls` relies on terminal cell columns and padded spaces.
- Core snapshots preserve `@xterm/headless` cell width metadata for every visible glyph. The render worker paints from those `x + columns` runs instead of assuming one JavaScript character equals one terminal cell, matching VTE's `TextRequest.columns` model and keeping CJK/wide glyph output aligned.
- Styled ANSI runs are painted once on top of row background. The unstyled row pass skips cells covered by styled runs so colored filenames do not get double-painted.
- ANSI colors are resolved from `@xterm/headless` cell attributes, including default colors, app-theme-derived 16-color palette entries, 256-color indexes, true color, inverse video, and bold-as-bright foreground palette colors.
- Canvas font metrics stay on a normal-weight, non-italic terminal font while ANSI bold/italic attributes remain part of cell metadata. This prevents Codex and other TUIs from changing glyph advances or row ascents mid-line; color, background, inverse, underline, cursor, and selection remain rendered on the fixed grid.
- Dirty tracking follows VTE's text-invalidation semantics rather than inferring changes from cursor movement. For each PTY batch, the core worker compares visible row cell signatures before and after parsing, including characters, cell widths, color modes, color values, and SGR flags. Cursor-addressed TUIs that rewrite a status row with the same text but different RGB or SGR attributes therefore repaint that row, which is required for Codex-style `Working` shimmer animations.
- Every painted row is cleared before text is drawn. This prevents previous glyph pixels from surviving when shorter or differently styled text replaces an older row.
- Output follow mode mirrors VTE's `context.m_bottom` behavior: the core worker records whether the viewport was at the bottom before each parsed output batch. If it was, output keeps the viewport at the new bottom and repaints the visible rows; if the user scrolled into history, output updates scrollback without stealing the viewport until explicit bottom scroll or user input.
- When the viewport changes, including wheel scrollback, the core worker emits the current visible rows and the render worker repaints them. This mirrors VTE's `queue_adjustment_value_changed()` path, which invalidates the ring view and queues a full visible repaint for user scroll changes.
- Cursor rows are converted from absolute buffer position to visible viewport row before painting. When the user scrolls into history and the real cursor is outside the visible viewport, the renderer does not draw a fixed-position cursor.
- Selection uses the core worker's wrapped-row metadata in the main renderer: copying joins soft-wrapped rows without inserting newlines, double click selects a word, and triple click selects the full soft-wrapped logical line, matching VTE/xterm behavior.
- The main renderer owns the lightweight terminal adjustment layer: a thin custom scrollbar maps to core-worker `scrollToLine()`, matching VTE's separation between terminal scroll state and the scrollbar widget while keeping visual styling inside aiopsterm's theme system.
- Text selection is handled in the main renderer as grid coordinates over the canvas. Selection is rendered as an overlay and copied from the current visible snapshot with the same cell width metadata used by the renderer, so copying CJK/wide glyph rows follows terminal columns instead of Unicode character indexes. The render worker remains a paint target only.
- Normal content changes still use dirty-row snapshots when the viewport is stable. If output moves the viewport, aiopsterm prefers repainting the visible rows over copying old canvas pixels until a pixel-scroll path can prove it never leaves stale glyphs.

VTE's row renderer first paints cell-background runs and then text runs. The threaded renderer keeps the same ordering in canvas form: row background first, custom background runs next, then text cells.

## Input, IME, And Clipboard

VTE keeps the input-method boundary on the GTK widget: key events are filtered through `GtkIMContext`, focus changes call IM focus in/out, IM commits send text to the child PTY, and copy/paste shortcuts are handled as widget clipboard actions before normal key mapping. The threaded aiopsterm renderer follows that responsibility split in the browser:

- The canvas remains a paint target. It is not the keyboard or IME target.
- The main renderer mounts a hidden, focusable `textarea` inside each threaded terminal host. Focus, composition, and committed text stay on the DOM side so Chromium's IME integration, candidate-window placement, and keyboard-layout handling remain intact.
- The hidden input is moved to the current terminal cursor cell after snapshots and fits, mirroring VTE's `gtk_im_context_set_cursor_location()` role.
- `compositionstart`/`compositionend` gate text delivery so IME preedit text is not sent to the PTY; only committed text is posted to the core worker.
- `Ctrl+Shift+C` and `Ctrl+Shift+V` are terminal clipboard actions. Plain `Ctrl+C` still maps to ETX and is delivered to the shell.
- Printable text is read from DOM `input` events instead of being synthesized from `keydown`, leaving non-US keyboard layouts and IME commits on Chromium's native path.

## Data Coalescing

Terminal output is merged at several boundaries:

- The main process uses `terminalDataCoalescer` before `terminal:data` IPC delivery. Small output flushes quickly; bulk output can use the larger bulk merge window unless a caller passes an explicit `maxDelayMs`.
- The renderer batches ingress per terminal with priority-aware timing: active panes flush fastest, visible inactive panes flush near frame cadence, and background panes flush less often.
- Threaded panes bypass the renderer main-thread ingress hot path. PTY data is mapped to the worker-backed host and posted directly to the core worker, while legacy xterm panes keep the renderer ingress batcher.
- Threaded panes also skip default main-thread ZMODEM sentry scanning. That scanner is kept on the legacy path only, because normal high-volume terminal output should not be byte-scanned on the UI thread.
- Core workers keep a per-terminal `pendingChunks` queue and parse bounded batches into `@xterm/headless`.
- Core workers emit screen snapshots at active/visible/background cadence. Background records keep terminal state and mark a pending full snapshot, but paint messages are dropped until visible.
- The render worker keeps only the newest snapshot per terminal before painting. Stale snapshots are discarded.

The threaded live path writes output directly to the worker-backed terminal. `panel.output` is only a low-frequency tail mirror for search, AI context, tests, and lifecycle state, and it is flushed on a slower mirror cadence instead of per PTY batch. Threaded mirrors keep smaller foreground/background tails than legacy xterm panes, and cropped strings are detached from their original backing storage so old high-volume output is not retained by sliced strings. The hidden `terminal-output-mirror` DOM node does not bind large live text for threaded terminals, so Vue does not diff every terminal byte while the worker renderer is already painting the real surface.

This follows VTE's PTY pressure model: the fd read source only fills `m_incoming_queue` and schedules processing; parsing and dirty invalidation run later from the scheduler, and drawing is merged by GTK's frame clock or a low-frequency fallback. aiopsterm maps that to Electron by keeping the renderer input callback thin and moving terminal parsing plus paint scheduling into workers.

Keyword highlighting is also kept off the renderer hot path for threaded terminals. The main renderer sends the normalized keyword-highlight config to the core worker. The core worker compiles output/both-scope rules and adds highlight runs only for snapshot rows; the render worker paints those runs as a display overlay after ANSI text. This preserves raw PTY bytes and `@xterm/headless` buffer state, avoids injecting synthetic ANSI into the terminal stream, and prevents `highlightStatus=true` from falling back to main-thread `appendTerminalOutput()` and full `getHighlightedTerminalOutput()` scans. The legacy xterm path still uses the existing ANSI-injection highlighter.

Worker messages must stay structured-clone safe. Renderer settings, theme values, and keyword-highlight config are normalized into plain data before `postMessage()` so Vue/Pinia proxies cannot make workspace terminals fail open and fall back to the legacy xterm renderer.

## Runtime Diagnostics

Terminal diagnostics have two modes:

- Formal mode is the default. Slow-handle warnings and errors still log, but terminal data summaries, IPC coalescing summaries, and threaded worker perf samples are throttled so many active terminals do not spend frame time writing debug logs.
- Debug mode is enabled with `AIOPSTERM_TERMINAL_DEBUG_LOGS=1`. It restores high-frequency terminal data summaries, threaded `core-perf` / `render-perf` logs, and small-pane geometry/layout diagnostics for local diagnosis.

Renderer builds receive `AIOPSTERM_TERMINAL_DEBUG_LOGS` through the preload runtime env bridge. Use the debug switch only while investigating terminal behavior; performance validation should use formal mode unless the test is specifically about logging.

## RenderGroup Model

The v1 implementation uses one `OffscreenCanvas` per mounted pane while all panes share one render worker. This keeps the existing Vue pane lifecycle intact while moving core parsing and painting off the main thread.

The protocol already carries `groupId` and `surface` so the next renderer step can merge all visible split panes in a workspace region into one large RenderGroup canvas. Codex terminals use a separate group id from workspace panes.

## Fallback

The threaded path is enabled only when all of these are true:

- `AIOPSTERM_THREADED_TERMINAL=1`.
- `Worker` is available.
- `HTMLCanvasElement.transferControlToOffscreen` is available.

Electron preview and packaged renderer builds read the runtime flag through the preload bridge, so `AIOPSTERM_THREADED_TERMINAL=1 scripts/build-and-start.sh --skip-build` is enough to enable the threaded path for an existing build. `VITE_AIOPSTERM_THREADED_TERMINAL=1` is only needed for renderer-only test harnesses that do not have the preload bridge available.

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

The harness is installed dynamically from `src/renderer/src/services/terminal/terminalStressHarness.ts` when `AIOPSTERM_TERMINAL_STRESS=1` or `VITE_AIOPSTERM_TERMINAL_STRESS=1` is set. The terminal workspace controller only passes existing runtime hooks into that module, so stress-only panel creation, frame sampling, GC sampling, and regression probes do not live in the normal business controller.

The stress result also includes `regressions` probes for the recent terminal failures:

- New worker-buffer content must become visible after queued output flushes.
- Foreground/background switching must repaint the newly visible terminal.
- Same-text ANSI style changes must repaint dirty rows, covering Codex-style shimmer animations.
- Scrollback must expose a themed scrollbar, move the viewport, and keep the cursor tied to the terminal viewport.
- Soft-wrapped selection must copy one logical line without inserted newlines.
- Focus, IME input target, `Ctrl+Shift+C`, and plain `Ctrl+C` must stay separated.

## Current Limits

The v1 path is built for throughput validation. Threaded rendering supports text output, ANSI foreground/background runs, cursor rendering, resize, direct PTY data, wheel and scrollbar scrollback, visible-viewport text selection, and background no-paint behavior. Rich xterm decorations, full scrollback-range selection, link hover handling, mouse application protocols, and WebGL rendering remain on the legacy path for now.

WebGL is intentionally deferred: the first threaded renderer uses worker 2D canvas because that covers modern Electron/Chromium machines and avoids GL context count pressure. A later WebGL renderer should keep one context per visible RenderGroup, not one context per terminal.
