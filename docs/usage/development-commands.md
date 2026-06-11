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

The Playwright launcher sets `AIOPSTERM_SSH_TERMINAL_BACKEND_DOUBLE=1` for deterministic SSH tab creation in E2E runs. This switch lives in the main/backend SSH terminal runtime only; renderer code still consumes `createTerminal()` results and `terminal:data` events, and the normal development/production path opens real `ssh2` sessions.

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
