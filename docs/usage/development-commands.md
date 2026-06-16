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

The script runs `npm run build`, stops any existing aiopsterm preview process, then starts `electron-vite preview --skipBuild --noSandbox`. This avoids the Electron single-instance lock making a second preview appear to flash and exit. Use `npm run build:start -- --skip-build` to reopen the latest existing build without rebuilding. Use `scripts/build-and-start.sh --no-restart` only when you want the script to detect an existing preview and exit without replacing it.

Rebuild native Electron modules explicitly:

```bash
npm run rebuild:native
```

Regenerate self-owned app icon PNGs from the local GPT-generated source image:

```bash
npm run generate:icons
```

The source bitmap lives at `resources/app-icon-source.png`. `generate:icons` reads that self-owned PNG and writes the Linux runtime/package sizes under `resources/icons`. During development the main process loads `resources/icons/256x256.png`; packaged builds copy `resources/icons` into Electron resources so Linux windows can load `icons/256x256.png` at runtime.

Build Linux packages:

```bash
npm run build:linux
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

`build:linux` and `build:deb` first regenerate the self-owned app icon PNGs from `resources/app-icon-source.png`, then build the bundled Codex CLI binary with `build:codex`, run `rebuild:native` with an explicit Electron headers URL, then run electron-builder with automatic rebuild disabled. Linux packaging uses the self-owned PNG icon set under `resources/icons`, copies those PNGs into packaged resources for runtime window icons, copies the single built Codex CLI executable into `resources/codex/codex`, registers the `aiopsterm://` desktop protocol, and trims packaged native-module build-only files through the `afterPack` hook. If the environment cannot download Electron headers, packaging fails before app packaging starts. In that case, rerun the same command after network access is restored or provide a local Electron headers cache.

`build:mac` uses the same self-owned build output and electron-builder config, with `dmg` and `zip` targets matching the External reference-style desktop package split. Run it on macOS because macOS targets require the platform signing and packaging toolchain; Linux development machines should use `audit:package-config` to verify the macOS target configuration without attempting to produce a macOS package.

Successful Linux packaging produces:

- `dist/aiopsterm-0.1.0-linux-x86_64.AppImage`
- `dist/aiopsterm-0.1.0-linux-amd64.deb`

Run package-level smoke and audit checks after Linux packaging, and run the cross-platform package config audit before packaging changes are merged:

```bash
npm run audit:package-config
npm run smoke:packaged
npm run audit:linux-package
```

See [Package Verification](package-verification.md) for the exact package checks.
