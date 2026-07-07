# Development Commands

Install dependencies:

```bash
npm install
```

The repo-local `.npmrc` points npm, Electron downloads, Electron headers, and electron-builder helper binaries at mirror endpoints so native rebuilds do not depend on the default Electron artifact host.

Start the desktop app in development mode:

```bash
npm run dev
```

Run checks:

```bash
npm run typecheck
npm test
npm run audit:client-mocks
```

`audit:client-mocks` fails if renderer source reintroduces page-level business mock files, imports from `src/renderer/src/data`, backend seed/double switches, shared seed modules, imports from the reference-only `external-reference/` tree, renderer-generated backend business id prefixes, generic string-prefix renderer id helpers, or business fixture exports/fields hidden under `src/renderer/src/config`. It also scans source, scripts, package scripts, and build/package config for `external-reference/` reference-tree paths so the reference implementation cannot be copied, built from, or packaged by aiopsterm; explicit package exclusions such as `!external-reference/**` remain allowed. UI placeholders, static UI config metadata, UI-only id helpers with explicit prefix unions, `.external-reference` plugin package names, and backend/test-only seeds remain allowed behind their existing boundaries.

Run the opt-in live SSH/SFTP backend verification against a real host:

```bash
AIOPSTERM_LIVE_SSH_ENABLE=1 \
AIOPSTERM_LIVE_SSH_HOST=example.com \
AIOPSTERM_LIVE_SSH_PORT=22 \
AIOPSTERM_LIVE_SSH_USERNAME=root \
AIOPSTERM_LIVE_SSH_PASSWORD='set-in-your-shell-only' \
npm run test:live:ssh
```

`AIOPSTERM_LIVE_SSH_HOST` may also include `host:port` when the separate port variable is omitted. The test is skipped unless `AIOPSTERM_LIVE_SSH_ENABLE=1` is set, stores credentials only in a temporary backend database, writes under `AIOPSTERM_LIVE_SSH_REMOTE_DIR` or a generated `/tmp/aiopsterm-live-*` directory on the remote host, and cleans that directory after the run. Use `AIOPSTERM_LIVE_SSH_PRIVATE_KEY` plus optional `AIOPSTERM_LIVE_SSH_PASSPHRASE` instead of the password variable for key-based verification.

Run Electron end-to-end checks and generate acceptance screenshots under `test-results/`:

```bash
npm run e2e
```

The Playwright launcher sets explicit backend-double switches for deterministic E2E runs: `AIOPSTERM_SSH_TERMINAL_BACKEND_DOUBLE=1`, `AIOPSTERM_AI_CHAT_BACKEND_DOUBLE=1`, `AIOPSTERM_DB_AI_BACKEND_DOUBLE=1`, `AIOPSTERM_USER_ACCOUNT_CODE_BACKEND_DOUBLE=1`, and `AIOPSTERM_USER_EXTERNAL_OPEN_BACKEND_DOUBLE=1`. These switches live in main/backend runtimes only and are read through `src/shared/runtimeSwitches.ts`; renderer code still consumes preload/main results and runtime events. The normal development/production path does not infer backend doubles from `NODE_ENV=test` or truthy strings such as `true`: SSH opens real `ssh2` sessions, AI chat requires a configured provider or real local model backend, Database AI requires a configured provider before generated responses are available, and user login/account-center opens require configured HTTP(S) URLs plus the OS external opener.

E2E-only file/dialog fixtures are also explicit. `AIOPSTERM_E2E_DIALOG_FIXTURES=1` lets the Playwright run auto-select generated import files, test images, kubeconfig files, save-dialog paths, and log-directory open results. `AIOPSTERM_MCP_DISCOVERY_DISABLE=1` keeps E2E MCP settings deterministic by reusing configured MCP rows without spawning external MCP discovery processes. `NODE_ENV=test` alone does not enable either behavior.

Development seed rows are explicit opt-ins. Use `AIOPSTERM_CHAT_HISTORY_ENABLE_SEED=1`, `AIOPSTERM_AI_TODO_ENABLE_SEED=1`, `AIOPSTERM_QUICK_COMMANDS_ENABLE_SEED=1`, `AIOPSTERM_ALIASES_ENABLE_SEED=1`, `AIOPSTERM_ASSETS_ENABLE_SEED=1`, `AIOPSTERM_DATABASE_ENABLE_SEED=1`, `AIOPSTERM_FILES_ENABLE_SEED=1`, `AIOPSTERM_KNOWLEDGE_ENABLE_SEED=1`, `AIOPSTERM_KUBERNETES_ENABLE_SEED=1`, `AIOPSTERM_MCP_ENABLE_SEED=1`, `AIOPSTERM_MODEL_SETTINGS_ENABLE_SEED=1`, `AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED=1`, `AIOPSTERM_SKILLS_ENABLE_SEED=1`, `AIOPSTERM_USER_ACCOUNT_ENABLE_SEED=1`, or `AIOPSTERM_WORKSPACE_PREFERENCES_ENABLE_SEED=1` only when you intentionally want the backend to expose development conversations, internal AI lifecycle rows, Quick Commands, Alias rows, asset/database/file-session rows, Knowledge Base docs/images, Kubernetes catalog rows, MCP server rows, settings model rows, settings rules, Skill files, account/trusted-device rows, or development asset expanded-group preferences; these switches also require exact `1`, and `NODE_ENV=test` does not enable those seeds by itself. The Playwright launcher enables the seed switches that its acceptance flow asserts, so those fixtures remain test-owned rather than normal runtime defaults.

`npm run e2e` is an alias for the longer script name:

```bash
npm run test:e2e
```

Build the Electron renderer and main process:

```bash
npm run build
```

Build and then start the latest Electron preview window:

```bash
npm run build:start
```

The script first builds a local Codex dev package from the modified `codex/` source tree, then runs `npm run build`, stops any existing aiopsterm preview process, and starts `electron-vite preview --skipBuild --noSandbox`. This keeps embedded-Codex patches, such as aiopsterm's hidden pending target-context injection, in sync with the preview app. On Linux, install the local Codex build prerequisites first:

```bash
sudo apt-get install -y pkg-config libssl-dev bubblewrap
```

If `libssl-dev` is missing and sudo is not available, the dev builder can download that development package from the configured apt mirror and unpack it into `.cache/aiopsterm-codex-dev/` for the build. If `/usr/local` exposes older OpenSSL 1.1 headers or pkg-config files, the builder ignores that default and prefers a supported OpenSSL 3 pkg-config path, falling back to the cached `libssl-dev` overlay so Codex does not link against OpenSSL 1.1. The dev and release Codex builders read `codex/codex-rs/rust-toolchain.toml`, install the declared Rust toolchain when needed, and export `RUSTUP_TOOLCHAIN` before running Cargo; this prevents older default Cargo versions from failing on Codex's Rust 2024 edition workspace. Before Cargo starts, they also detect zero-byte Rust artifacts under the active Codex Cargo profile and delete that profile cache, which recovers from interrupted builds or host OS switches that leave invalid `.rlib`, `.rmeta`, or object files in `codex/codex-rs/target`. If rustup's default endpoint is unreachable, the installer retries with the `rsproxy.cn` mirror, or you can preconfigure `RUSTUP_DIST_SERVER` and `RUSTUP_UPDATE_ROOT` yourself. The dev build uses the host GNU target and `dev-small` Cargo profile, not the musl release target; the script disables debug assertions for that profile so embedded Codex preview sessions log recoverable stream-state anomalies instead of panicking. It prefetches Codex-built V8 artifacts through configurable GitHub mirrors; set `AIOPSTERM_GITHUB_MIRROR` to a comma-separated list if the defaults are not reachable from your network. Use `npm run build:start -- --skip-build` to reuse the latest existing aiopsterm build while still rebuilding Codex; use `--skip-codex` only when the Codex dev package is already current. Use `scripts/build-and-start.sh --no-restart` only when you want the script to detect an existing preview and exit without replacing it.

Rebuild native Electron modules explicitly:

```bash
npm run rebuild:native
```

Regenerate self-owned app icon PNGs from the local GPT-generated source image:

```bash
npm run generate:icons
```

The source bitmap lives at `resources/app-icon-source.png`. `generate:icons` reads that self-owned PNG and writes the Linux runtime/package sizes under `resources/icons`. During development the main process loads `resources/icons/256x256.png`; packaged builds copy `resources/icons` into Electron resources so Linux windows can load `icons/256x256.png` at runtime.

Regenerate built-in app background presets:

```bash
node scripts/generate-backgrounds.mjs --preview-dir test-results/background-previews
```

The script renders deterministic SVG artwork through Playwright Chromium and writes WebP files under `src/renderer/src/assets/backgrounds`. Keep `src/renderer/src/config/settings.ts` synchronized with the generated preset ids.

Build Linux packages:

```bash
npm run build:linux
```

Build only the Linux AppImage package:

```bash
npm run build:linux:appimage
```

Build only the Debian package:

```bash
npm run build:deb
```

Build macOS packages on a macOS runner:

```bash
npm run build:mac
```

For a macOS unpacked directory build during package debugging:

```bash
npm run build:mac:dir
```

Build Windows packages on a Windows runner:

```bash
npm run build:win
```

For a Windows unpacked directory build during package debugging:

```bash
npm run build:win:dir
```

`build:linux`, `build:linux:appimage`, and `build:deb` first regenerate the self-owned app icon PNGs from `resources/app-icon-source.png`, then build and audit the bundled Codex package with `build:codex`, run `rebuild:native` with an explicit Electron headers URL, then run electron-builder with automatic rebuild disabled. Linux `build:codex` runs the locally modified `codex/` tree's package builder for the musl target (`x86_64-unknown-linux-musl` on x64), uses the Rust toolchain declared by Codex, and rejects runtimes that still depend on OpenSSL 1.1 dynamic libraries. The Linux build host needs `ca-certificates curl musl-tools pkg-config libcap-dev g++ clang libc++-dev libc++abi-dev lld xz-utils`; CI can also supply `AIOPSTERM_CODEX_BWRAP_BIN` / `AIOPSTERM_CODEX_RG_BIN` for prebuilt helper resources, and `RUSTY_V8_ARCHIVE` plus `RUSTY_V8_SRC_BINDING_PATH` when V8 artifacts are pre-cached. Linux packaging uses the self-owned PNG icon set under `resources/icons`, copies those PNGs into packaged resources for runtime window icons, copies the complete generated Codex package into `resources/codex`, registers the `aiopsterm://` desktop protocol, and trims packaged native-module build-only files through the `afterPack` hook. If the environment cannot download Electron headers or Codex release artifacts, packaging fails before app packaging starts. In that case, rerun the same command after network access is restored or provide the corresponding local caches.

`build:mac` uses the same self-owned build output and electron-builder config, with `dmg` and `zip` targets matching the External reference-style desktop package split. Run it on macOS because macOS targets require the platform signing and packaging toolchain; Linux development machines should use `audit:package-config` to verify the macOS target configuration without attempting to produce a macOS package.

`build:win` uses the same self-owned build output and electron-builder config, with the NSIS installer target. Run it on Windows. The Windows Codex build step does not run the POSIX shell builder; the Node `build:codex` dispatcher invokes Codex's Python package builder against `x86_64-pc-windows-msvc` or `aarch64-pc-windows-msvc`, using the Rust toolchain declared by `codex/codex-rs/rust-toolchain.toml`. The Windows runner needs Python 3, rustup, and the MSVC C++ build tools/Windows SDK. The generated Codex package includes `bin/codex.exe`, `codex-path/rg.exe`, `codex-resources/codex-command-runner.exe`, and `codex-resources/codex-windows-sandbox-setup.exe`. CI may still supply a complete cached package with `AIOPSTERM_CODEX_PACKAGE_DIR` / `AIOPSTERM_CODEX_BIN`, or individual helper overrides with `AIOPSTERM_CODEX_RG_BIN`, `AIOPSTERM_CODEX_COMMAND_RUNNER_BIN`, and `AIOPSTERM_CODEX_WINDOWS_SANDBOX_SETUP_BIN`.

Target-level commands wrap those platform scripts and fail fast on the wrong host:

```bash
npm run package:build -- linux-appimage
npm run package:build -- linux-deb
npm run package:build -- macos
npm run package:build -- windows
npm run package:build:matrix
```

Successful Linux packaging produces:

- `dist/aiopsterm-0.1.0-linux-x86_64.AppImage`
- `dist/aiopsterm-0.1.0-linux-amd64.deb`

Successful macOS packaging produces `dist/aiopsterm-0.1.0-macos-<arch>.dmg` and `dist/aiopsterm-0.1.0-macos-<arch>.zip` on a macOS runner. Successful Windows packaging produces `dist/aiopsterm-0.1.0-setup-<arch>.exe` on a Windows runner.

Run package-level smoke and audit checks after Linux packaging, and run the cross-platform package config audit before packaging changes are merged:

```bash
npm run audit:package-config
npm run smoke:packaged
npm run audit:linux-package
```

For target-specific package verification, run the target verifier after the target build on the same host:

```bash
npm run package:verify -- linux-appimage
npm run package:verify -- linux-deb
npm run package:verify -- macos
npm run package:verify -- windows
```

The packaged E2E test launches the unpacked packaged app, checks the main window/local terminal/Files module, and verifies packaged control notifications through the platform control socket or Windows named pipe:

```bash
npm run test:e2e:packaged
```

See [Package Verification](package-verification.md) for the exact package checks.
