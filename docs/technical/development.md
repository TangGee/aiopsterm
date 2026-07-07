# Development

This document captures maintainer-facing repository structure and verification expectations.

For architecture rules, see [Architecture Design Principles](architecture-principles.md).

## Repository Structure

- `src/main`: Electron main-process bootstrap, runtime composition, IPC registration, and backend integrations.
- `src/main/backend`: main-process domain runtimes for persistence, OS access, subprocesses, sockets, credentials, SSH, database, Kubernetes, Codex, and app services.
- `src/main/ipc`: IPC channel registration by domain.
- `src/preload`: secure preload bridge construction.
- `src/shared`: process-neutral contracts, DTOs, shared rules, and selected Node-only shared runtimes consumed by main/tests.
- `src/renderer/src/components`: Vue presentation and container components.
- `src/renderer/src/services`: renderer clients, guards, controllers, and pure runtime helpers grouped by domain subdirectory.
- `src/renderer/src/stores`: Pinia store composition and shell/domain state factories.
- `resources`: packaged icons and helper scripts.
- `scripts`: build, packaging, audit, and smoke-test automation.
- `tests`: Vitest and Playwright-oriented test coverage.

## Main Backend Directories

Main-process backend files are grouped by product or platform domain under `src/main/backend/`.

Use these directories for new backend files:

- `agent`
- `ai`
- `app`
- `assets`
- `chat`
- `codex`
- `control`
- `database`
- `extensions`
- `files`
- `knowledge`
- `kubernetes`
- `mcp`
- `quick-commands`
- `settings`
- `ssh`
- `terminal`
- `user`

Keep backend domain facades stable when they protect IPC, runtime composition, or tests from churn. Add root-level `src/main/backend/*.ts` files only for deliberate cross-domain compatibility or composition points.

## Renderer Service Directories

Renderer service files are grouped by product domain under `src/renderer/src/services/`.

Use these directories for new service files:

- `ai`
- `app`
- `assets`
- `common`
- `database`
- `extensions`
- `files`
- `knowledge`
- `kubernetes`
- `quick-commands`
- `settings`
- `terminal`
- `user`
- `workspace`

Avoid adding new root-level service files unless the file is intentionally a cross-domain compatibility facade. Prefer preserving public method names while moving implementation into the owning domain directory.

## Verification

For structural TypeScript or import-path changes, run:

```bash
npm run typecheck
```

For renderer UI text changes, run:

```bash
npm run audit:i18n
```

This checks that tracked renderer UI text is covered by explicit i18n keys or the static legacy text catalog.

For runtime or user-visible behavior changes, add focused tests at the changed boundary and run the relevant test command. Full end-to-end verification remains the release-level regression gate:

```bash
npm run test:e2e
```

Package and release work should also use the package audits documented in the usage package verification guide.

For background preset changes, regenerate the deterministic WebP assets and review previews:

```bash
node scripts/generate-backgrounds.mjs --preview-dir test-results/background-previews
```

This script writes `src/renderer/src/assets/backgrounds/<id>.webp`. Keep `src/renderer/src/config/settings.ts` in sync with the generated preset ids.

## Terminal Performance Verification

Terminal renderer throughput changes must be validated with the threaded stress harness before claiming performance success. Use the short gates while iterating:

```bash
AIOPSTERM_TERMINAL_STRESS=1 VITE_AIOPSTERM_TERMINAL_STRESS=1 AIOPSTERM_TERMINAL_STRESS_PROFILE=mixed-switch AIOPSTERM_TERMINAL_STRESS_DURATION_MS=10000 AIOPSTERM_TERMINAL_STRESS_SWITCH_INTERVAL_MS=5000 npm run test:e2e -- tests/e2e/terminal-stress.spec.ts --reporter=list
AIOPSTERM_TERMINAL_STRESS=1 VITE_AIOPSTERM_TERMINAL_STRESS=1 AIOPSTERM_TERMINAL_STRESS_PROFILE=mixed-switch AIOPSTERM_TERMINAL_STRESS_DURATION_MS=60000 AIOPSTERM_TERMINAL_STRESS_SWITCH_INTERVAL_MS=5000 npm run test:e2e -- tests/e2e/terminal-stress.spec.ts --reporter=list
```

The release-level stress profile is 20 minutes:

```bash
AIOPSTERM_TERMINAL_STRESS=1 VITE_AIOPSTERM_TERMINAL_STRESS=1 AIOPSTERM_TERMINAL_STRESS_PROFILE=mixed-switch AIOPSTERM_TERMINAL_STRESS_DURATION_MS=1200000 AIOPSTERM_TERMINAL_STRESS_SWITCH_INTERVAL_MS=5000 npm run test:e2e -- tests/e2e/terminal-stress.spec.ts --reporter=list
```

Check frame percentiles, paint latency, foreground/background switch latency, foreground/background write counters, real PTY echo latency, CDP live heap delta, canvas count, queue backlog, and worker error counts in the `[terminal-stress]` JSON line. The release default is threaded core plus worker 2D RenderGroup painting; WebGL validation must explicitly set `AIOPSTERM_TERMINAL_RENDER_BACKEND=webgl2` and should be treated as an experimental acceleration gate until switch and paint tail latency match the 2D backend. Heap sampling and heap snapshot artifacts are written to `test-results/terminal-stress/`; the JSON also includes allocation hotspots and a post-GC object summary for retained-object inspection. `performance.memory` fields are useful diagnostics, while retained-object assertions use CDP `Runtime.getHeapUsage` and heap snapshot object sizes. Do not treat a 10-second smoke pass as evidence for the 20-minute target.

The stress memory report separates live-state and teardown evidence. The live-state samples run after the write/switch workload, regression probes, and two GC runs while stress terminal panels and threaded hosts still exist; this verifies that long-running output, queues, cached snapshots, and visible surfaces do not grow unexpectedly under load. The `teardown` section then closes the stress terminal UI panels without killing reusable PTY sessions, waits for threaded hosts/canvases to detach, runs GC twice again, and reports host/canvas/heap deltas against the pre-stress baseline. The CDP heap snapshot is taken after this teardown phase, so retained-object inspection represents the close-all-UI state.

The foreground/background switch latency gate is deliberately looser than normal foreground paint and echo latency. The switch path includes DOM split-layout replacement, threaded host surface reattachment, fit/resize, and the first repaint of the newly visible pane; users can tolerate this being slower than normal keystroke echo. The stress gate still requires the switched pane to become paintable and repaint within 500 ms p95, and treats missing surface attachment or missing repaint as a functional regression.

The same result includes `regressions` probes for content freshness, foreground/background switching, ANSI same-text repaint, scrollback/scrollbar behavior, soft-wrapped selection copying, and keyboard/IME focus. Any failed probe should be treated as a functional terminal regression even when frame metrics look healthy.

Set `AIOPSTERM_TERMINAL_DEBUG_LOGS=1` only when collecting detailed terminal diagnostics. Formal mode keeps slow warnings and errors but throttles terminal data summaries and threaded worker perf logs so logging does not become the stress-test bottleneck.

## Platform Iteration

Cross-platform work should stay iterative: make one narrow platform change, add focused tests or audits for that boundary, then commit locally. Do not push from the implementation loop unless a separate release or collaboration step asks for it.

Keep compatibility layers thin and prefer Electron or Node runtime facilities over app-wide branching. Current platform seams are:

- `src/main/backend/app/platformRuntime.ts` for local shell defaults, executable suffix lookup, and transient socket/named-pipe paths.
- `src/main/backend/app/nativeNotificationRuntime.ts` for Electron native desktop notifications behind a testable adapter.
- `src/renderer/src/services/files/filesRuntime.ts` for file-browser path style. Local Windows sessions use Windows paths; remote and SFTP sessions keep POSIX paths.
- Existing Electron preload IPC for platform discovery, such as `window.aiops.platform()`, instead of renderer-side OS probing.

Package scripts are platform entry points, not proof of support:

```bash
npm run build:linux:appimage
npm run build:linux
npm run build:deb
npm run build:mac
npm run build:mac:dir
npm run build:win
npm run build:win:dir
```

Use the target wrappers when validating the four installable package outputs independently:

```bash
npm run package:build -- linux-appimage
npm run package:build -- linux-deb
npm run package:build -- macos
npm run package:build -- windows
npm run package:verify -- linux-appimage
npm run package:verify -- linux-deb
npm run package:verify -- macos
npm run package:verify -- windows
```

`package:build:matrix` builds the targets that belong to the current host platform by default. Each wrapper refuses to run a target on the wrong OS and clears that target's previous artifact/unpacked output before building, so Linux development can prove the Linux AppImage/deb scripts but cannot be used as evidence for macOS or Windows packages.

`build:codex` is a Node dispatcher. Linux and macOS continue through the shell-based Codex package builder. Windows stays in the Node entrypoint and invokes Codex's Python package builder against the Windows MSVC target, so the default Windows flow builds `codex.exe`, `rg.exe`, `codex-command-runner.exe`, and `codex-windows-sandbox-setup.exe` from the local `codex/` source package inputs. `AIOPSTERM_CODEX_PACKAGE_DIR` and `AIOPSTERM_CODEX_BIN` remain cache/custom-package overrides; individual Windows helper overrides are `AIOPSTERM_CODEX_RG_BIN`, `AIOPSTERM_CODEX_COMMAND_RUNNER_BIN`, and `AIOPSTERM_CODEX_WINDOWS_SANDBOX_SETUP_BIN`.

For package-facing changes, run at least:

```bash
npm run audit:package-config
npm run typecheck
```

After a package build on the target platform, run:

```bash
npm run test:e2e:packaged
```

The packaged E2E launches the unpacked packaged app with an isolated user-data directory, checks the main window, local terminal surface, Files module entry point, and verifies packaged control notifications through the platform control socket or Windows named pipe.
