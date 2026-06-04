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

Build Linux packages:

```bash
npm run build:linux
```

`build:linux` first runs `rebuild:native` with an explicit Electron headers URL, then runs electron-builder with automatic rebuild disabled. If the environment cannot download Electron headers, packaging fails before app packaging starts. In that case, rerun the same command after network access is restored or provide a local Electron headers cache.

Successful Linux packaging produces:

- `dist/aiopsterm-0.1.0-linux-x86_64.AppImage`
- `dist/aiopsterm-0.1.0-linux-amd64.deb`
