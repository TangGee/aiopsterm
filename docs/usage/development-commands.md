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
```

Run Electron end-to-end checks and generate acceptance screenshots under `test-results/`:

```bash
npm run e2e
```

The Playwright launcher sets explicit backend-double switches for deterministic E2E runs: `AIOPSTERM_SSH_TERMINAL_BACKEND_DOUBLE=1`, `AIOPSTERM_AI_CHAT_BACKEND_DOUBLE=1`, `AIOPSTERM_DB_AI_BACKEND_DOUBLE=1`, and `AIOPSTERM_USER_ACCOUNT_CODE_BACKEND_DOUBLE=1`. These switches live in main/backend runtimes only; renderer code still consumes preload/main results and runtime events. The normal development/production path does not infer backend doubles from `NODE_ENV=test`: SSH opens real `ssh2` sessions, AI chat requires a configured provider or real local model backend, and Database AI requires a configured provider before generated responses are available.

Development seed rows are explicit opt-ins. Use `AIOPSTERM_CHAT_HISTORY_ENABLE_SEED=1`, `AIOPSTERM_AI_TODO_ENABLE_SEED=1`, `AIOPSTERM_QUICK_COMMANDS_ENABLE_SEED=1`, `AIOPSTERM_ALIASES_ENABLE_SEED=1`, `AIOPSTERM_ASSETS_ENABLE_SEED=1`, `AIOPSTERM_FILES_ENABLE_SEED=1`, `AIOPSTERM_KUBERNETES_ENABLE_SEED=1`, `AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED=1`, or `AIOPSTERM_USER_ACCOUNT_ENABLE_SEED=1` only when you intentionally want the backend to expose development conversations, Focus Chain rows, Quick Commands, Alias rows, asset/file-session rows, Kubernetes catalog rows, settings rules, or account/trusted-device rows; `NODE_ENV=test` does not enable those seeds by itself. The Playwright launcher enables the seed switches that its acceptance flow asserts, so those fixtures remain test-owned rather than normal runtime defaults.

`npm run e2e` is an alias for the longer script name:

```bash
npm run test:e2e
```

Build the Electron renderer and main process:

```bash
npm run build
```

Rebuild native Electron modules explicitly:

```bash
npm run rebuild:native
```

Regenerate self-owned app icon PNGs from the local generator:

```bash
npm run generate:icons
```

Build Linux packages:

```bash
npm run build:linux
```

`build:linux` first regenerates the self-owned app icon PNGs, then runs `rebuild:native` with an explicit Electron headers URL, then runs electron-builder with automatic rebuild disabled. Linux packaging uses the self-owned PNG icon set under `resources/icons`, registers the `aiopsterm://` desktop protocol, and trims packaged native-module build-only files through the `afterPack` hook. If the environment cannot download Electron headers, packaging fails before app packaging starts. In that case, rerun the same command after network access is restored or provide a local Electron headers cache.

Successful Linux packaging produces:

- `dist/aiopsterm-0.1.0-linux-x86_64.AppImage`
- `dist/aiopsterm-0.1.0-linux-amd64.deb`

Run package-level smoke and audit checks after Linux packaging:

```bash
npm run smoke:packaged
npm run audit:linux-package
```

See [Package Verification](package-verification.md) for the exact package checks.
