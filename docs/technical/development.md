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
