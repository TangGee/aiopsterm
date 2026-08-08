# Development

This document captures maintainer-facing repository structure and verification expectations.

For architecture rules, see [Architecture Design Principles](architecture-principles.md).

## Path And State Ownership Rules

Use the domain path runtime for each path semantic: filesystem paths use Node/Electron path APIs, project and Knowledge paths use their dedicated relative-path runtimes, remote SFTP paths use POSIX normalization, and provider URL paths use `src/shared/modelProviderEndpoint.ts`. Do not add a second normalizer for an existing semantic.

Renderer state that participates in a cross-module workflow must be changed through its owner action. In particular, Kubernetes modal state is updated through `workspace.updateK8sUiState`; components and modal renderers should not assign the store fields directly. The state ownership audit protects these fields and should be extended when a new shared workflow state is introduced.

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

For store ownership, panel lifecycle, or main/shared registry changes, run:

```bash
npm run audit:state-ownership
```

The audit rejects direct writes to protected workspace fields, direct `v-model` bindings to those fields, `activePanelId` writes outside its navigation owner, and exported mutable bindings or containers in main/shared code. It runs automatically before `npm test` and `npm run build`.

For plugin manifest, runtime, contribution, or packaging changes, run:

```bash
npm run typecheck
npx vitest run tests/extensions-backend.test.ts tests/extensions-client.test.ts
npm run audit:i18n
npm run audit:package-config
npm run audit:client-mocks
```

Built-in plugin manifests live under `resources/builtin-plugins`. External plugin package development is documented in the [Developer Integration Guides](../developer/index.md), and runtime trust boundaries are documented in [Plugin Runtime](plugin-runtime.md).

For runtime or user-visible behavior changes, add focused tests at the changed boundary and run the relevant test command. Full end-to-end verification remains the release-level regression gate:

```bash
npm run test:e2e
```

## Local JumpServer Integration Lab

The current development workstation has an isolated JumpServer v4.10.17 lab for
testing the real asset refresh integration. The VM disk and JumpServer data are
stored on the internal Samsung SSD at:

```text
/media/tlinux/0e309940-ef14-4090-84c0-346ff5b89a2d/jumpserver-lab
```

Do not move this lab to `/media/tlinux/sdd`; that mount is a slower removable
disk. The lab runs in a 4 vCPU, 8 GiB QEMU/KVM virtual machine so it does not
consume the host Docker data directory. Its host ports are bound to loopback
only:

- Web and API: `http://127.0.0.1:8080`
- JumpServer SSH gateway: `127.0.0.1:2222`
- VM maintenance SSH: `127.0.0.1:10022`

Use the lab controller to manage and inspect it:

```bash
/media/tlinux/0e309940-ef14-4090-84c0-346ff5b89a2d/jumpserver-lab/labctl.sh start
/media/tlinux/0e309940-ef14-4090-84c0-346ff5b89a2d/jumpserver-lab/labctl.sh status
/media/tlinux/0e309940-ef14-4090-84c0-346ff5b89a2d/jumpserver-lab/labctl.sh stop
```

The controller status check expects HTTP 200 from the Web entry point and HTTP
401 from the asset API when no token is supplied. This proves that the service
and authentication boundary are available, but it does not prove an authorized
asset synchronization.

Run the opt-in live backend test with a disposable administrator Private Token:

```bash
AIOPSTERM_LIVE_JUMPSERVER_URL=http://127.0.0.1:8080 \
AIOPSTERM_LIVE_JUMPSERVER_TOKEN='<private-token>' \
npm run test:live:jumpserver
```

The test uses the actual JumpServer and aiopsterm SQLite backends. It creates a
uniquely named Linux host in JumpServer, refreshes it into an isolated temporary
aiopsterm database, renames it remotely and verifies an in-place update, deletes
it remotely and verifies stale-record removal, then removes all temporary local
state. JumpServer calls the credential a Private Token, but its HTTP
authentication scheme is `Authorization: Token <private-token>`.

For an end-to-end refresh test:

1. Open `http://127.0.0.1:8080`, sign in with the initial administrator
   account, and replace the default password.
2. Create a JumpServer Private Token for the test administrator.
3. Create one Linux host asset with a unique name, address, platform, and node.
4. In aiopsterm, configure the JumpServer API URL as
   `http://127.0.0.1:8080` and save the Private Token.
5. Run Refresh JumpServer Resources and confirm that the host appears once with
   its JumpServer asset id, address, platform, and node path.
6. Rename the host in JumpServer, refresh again, and confirm the existing local
   record is updated instead of duplicated.
7. Disable or delete the host in JumpServer, refresh again, and confirm the
   product's documented stale-resource behavior.

The VM currently enables only the components needed for asset API testing:
Core, Celery, Web, PostgreSQL, and Redis. Koko, Lion, and Chen are disabled, so
interactive protocol-gateway testing requires a separate lab configuration.
`labctl.sh` and the VM files are workstation-local artifacts and are not part of
the application package.

## Cline Agent Sidecar Verification

Electron 31 cannot load the Node 22-oriented Cline SDK directly. Classic host management and DB AI therefore use an independent bundle executed by the exact-pinned Node `22.20.0` runtime. Bun `1.3.13` is only the bundler and is not distributed. After changing Agent contracts, profiles, provider mapping, tool bridges, persistence, approvals, abort handling, or packaging, run:

```bash
npm run typecheck
npm run test -- tests/cline-agent-runtime.test.ts tests/cline-agent-sidecar-runtime.test.ts tests/cline-agent-sidecar-supervisor.test.ts tests/cline-agent-profiles.test.ts tests/classic-cline-ai-chat-runtime.test.ts tests/ai-chat-action-runtime.test.ts tests/ai-panel-history-runtime.test.ts tests/codex-terminal-bridge.test.ts tests/database-backend.test.ts
npm run build:cline-sidecar
npm run audit:cline-sidecar
npm run audit:package-config
```

The sidecar audit launches the actual current-platform Node runtime and bundle, validates the versioned ready/ping/graceful-shutdown/zero-exit sequence, and creates/stops sessions for every supported provider mapping without network calls. A deterministic proxied SSE scenario also proves `model -> approval -> tool -> result -> model -> final`. The audit verifies bundle hashes, the metafile dependency boundary, the complete CycloneDX component inventory, third-party notices, Node's upstream license file, and the absence of Claude Agent SDK and SAP SDK implementation code. The ignored output directory must be rebuilt on each target OS. Release verification must additionally prove that packaged resources contain the runtime, bundle, manifest, metafile, SBOM, notices, Node license, Cline license, and attribution while `app.asar` excludes `@cline/*`, sidecar source, and `external-reference/`. macOS and Windows validation must run on native signing/package runners; Linux output does not prove those platform artifacts.

Package and release work should also use the package audits documented in the usage package verification guide.

### Native Module ABI During Tests

`better-sqlite3` and `node-pty` are native Node addons. Electron 31 uses module ABI 125, while the repository's Node 22 test runtime uses ABI 127. A single `better_sqlite3.node` cannot serve both processes. A development installation therefore keeps two physical SQLite bindings below `better-sqlite3/lib/binding/node-v<abi>-<platform>-<arch>/`. This is still one npm package, one application database, and one business implementation; only the approximately 2 MiB ABI-specific machine-code binding is duplicated. The existing `bindings` loader selects the matching file from `process.versions.modules`, so Vitest and Electron do not overwrite each other's SQLite binary.

`npm test` prepares and verifies only the Node/Vitest binding. This path does not resolve, launch, rebuild, or otherwise require the Electron runtime, so Node-only CI can run with just its own installed binding. To prepare or verify it explicitly:

```bash
npm run native:ensure:node
npm run native:ensure:node -- --check
```

`npm run dev`, `npm start`, `npm run build:start`, and both source E2E commands prepare the Node and Electron SQLite bindings, then verify both runtimes. Package builds force-refresh the Electron binding before packaging. To prepare or verify Electron explicitly:

```bash
npm run native:ensure:electron
npm run native:ensure:electron -- --check
```

The explicit recovery commands remain `npm run rebuild:native:node` and `npm run rebuild:native:electron`; `npm run rebuild:native` stays as the Electron-refresh alias used by package jobs. Node rebuilds discard inherited Electron/cross-build npm variables. Preparation is serialized with a token-owned workspace lock: a dead PID is recovered immediately, a live owner is never evicted merely because a build is long, malformed lock data must be explicitly stale, and a process removes only its own lock. The versioned manifest supports a Node-only record and preserves another runtime record only when its path and SHA-256 remain valid.

The guard removes and rejects every `bindings@1.5.0` candidate that precedes `lib/binding`, including `build`, `Debug`, `Release`, `out`, `compiled`, and `addon-build` variants. It probes `better-sqlite3` with an in-memory query and verifies `node-pty` in each runtime included by the command, so an ABI mismatch fails before application or test startup. On Windows, stop every process using the target runtime before a forced rebuild or package rebuild; Windows does not allow a loaded `.node` file to be replaced, and the helper preserves the old destination when replacement cannot begin safely.

The development tree needs both SQLite ABI bindings, but an application package does not. The `afterPack` hook validates the manifest and Electron binding hash, deletes the Node binding and all shadow candidates, and writes an Electron-only manifest. `audit:packaged-app` requires that sole binding and uses the packaged Electron executable with `ELECTRON_RUN_AS_NODE=1` to run a real in-memory `SELECT 1`. Treat any guard or packaged probe failure as an environment/build failure, not as a passing product verification.

For background preset changes, regenerate the deterministic WebP assets and review previews:

```bash
node scripts/generate-backgrounds.mjs --preview-dir test-results/background-previews
```

This script writes `src/renderer/src/assets/backgrounds/<id>.webp`. Keep `src/renderer/src/config/settings.ts` in sync with the generated preset ids.

## Terminal Performance Verification

The tracked `test-data/terminal-100000-lines.txt` and `test-data/single-long-line.txt` files are synthetic UTF-8 terminal fixtures for manual large-output and long-line checks. They contain generated host names and paths rather than production data; automated tests do not load them by default.

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
npm run build:linux:one-click
npm run build:mac
npm run build:mac:dir
npm run build:mac:one-click -- --china-mirror
npm run build:win
npm run build:win:dir
```

Create a contributor-ready source archive with:

```bash
npm run package:source
```

The archive includes the main repository and local `codex/` repository Git metadata so the extracted source remains usable as a Git checkout. The packager creates temporary snapshot commits inside the archive only, leaving the current repositories untouched while ensuring both extracted worktrees have a clean `git status`. It must exclude the `external-reference/` reference tree, `control_compat/`, and `.git/modules/external-reference`; the packaging script fails if forbidden External reference source or Git objects are present. The generated archive and checksum are written below `release/source/` by default.

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

The Linux one-click wrapper (`npm run build:linux:one-click`) is the maintainer entrypoint for a complete native Linux package pass. Linux release artifacts are built on the Ubuntu 20.04/glibc 2.31 baseline; packaged-app verification inspects Electron, sidecar, shared-library, and native-addon ELF requirements and rejects a newer glibc dependency. The wrapper checks or installs missing toolchain commands with the host package manager, runs `npm ci` by default, builds AppImage and deb packages, and verifies both targets. `scripts/build-linux.sh` supports `--skip-setup`, `--skip-dependencies`, `--run-tests`, `--run-e2e`, `--china-mirror`, `--npm-registry <URL>`, `--appimage-only`, `--deb-only`, and `--setup-only`; mirror variables are scoped to child processes and low-memory hosts default Cargo to two build jobs. An explicit npm registry takes precedence over both the default registry and the npm registry selected by `--china-mirror` without changing the Electron or Rust mirror selection. China-mirror mode uses Gitee and npmmirror for the NVM/Node bootstrap, npmmirror for npm and Electron binaries, rsproxy for the rustup bootstrap, Rust, and Cargo, and a GitHub proxy for release/git inputs; Electron headers stay on the dedicated Electron CDN because npmmirror does not carry the archives consumed by `node-gyp`. AppImage packaging uses electron-builder's static `1.0.3` toolset with zstd compression, so the launcher does not require `libfuse.so.2`; the package audit rejects a launcher with a remaining FUSE 2 dependency.

The macOS one-click wrapper (`npm run build:mac:one-click`) performs the equivalent native macOS package pass. It checks Xcode Command Line Tools and the standard packaging commands, installs a pinned Node.js LTS toolchain in the user cache when the active Node release is unsupported, installs missing Python through Homebrew and rustup through the selected endpoint, runs `npm ci`, builds the dmg and zip through `package:build -- macos`, and finishes with `package:verify -- macos`. `scripts/build-macos.sh` supports `--skip-setup`, `--skip-dependencies`, `--run-tests`, `--run-e2e`, `--setup-only`, `--china-mirror`, `--npm-registry <URL>`, and `--codex-package-dir <DIR>` for the existing complete-package cache override. The China option uses process-local npmmirror, rsproxy, Tsinghua Homebrew settings, and the checksum-verified Codex V8 GitHub mirror prefetcher without changing persistent user configuration; if every GitHub mirror is unavailable, the source builder retains its normal direct-download fallback. Electron runtime headers remain on the official artifacts endpoint because npmmirror's Electron release checksum list does not include the mirrored header archive required by node-gyp verification. On machines without an Apple signing identity, afterPack applies a local ad-hoc signature so the locally generated DMG is not treated as a damaged app; this does not replace Developer ID signing or notarization for distribution. Set `AIOPSTERM_MAC_ADHOC_SIGN=0` to disable that fallback.

`build:codex` is a Node dispatcher. Linux and macOS continue through the shell-based Codex package builder. Windows stays in the Node entrypoint and invokes Codex's Python package builder against the Windows MSVC target, so the default Windows flow builds `codex.exe`, `rg.exe`, `codex-command-runner.exe`, and `codex-windows-sandbox-setup.exe` from the local `codex/` source package inputs. `AIOPSTERM_CODEX_PACKAGE_DIR` and `AIOPSTERM_CODEX_BIN` remain cache/custom-package overrides; individual Windows helper overrides are `AIOPSTERM_CODEX_RG_BIN`, `AIOPSTERM_CODEX_COMMAND_RUNNER_BIN`, and `AIOPSTERM_CODEX_WINDOWS_SANDBOX_SETUP_BIN`.

The repository does not require a remote Git host or hosted CI service for release verification. Native Windows verification can be run through `scripts/build-windows.ps1` (or its `.cmd` wrapper), Linux through `scripts/build-linux.sh`, and macOS through `scripts/build-macos.sh`. These wrappers apply download-source overrides only to their child processes and leave repository, user, and machine configuration unchanged.

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
