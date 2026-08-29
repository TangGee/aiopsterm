# xterm Fork

aiopsterm owns local `@xterm/xterm` and `@xterm/headless` packages under `vendor/xterm/`.

The root package uses `file:` dependencies:

```json
"@xterm/headless": "file:vendor/xterm/headless",
"@xterm/xterm": "file:vendor/xterm/xterm"
```

Keep imports unchanged as `@xterm/headless` and `@xterm/xterm`. The package manager resolves those names to the local fork.

The fork keeps the official CommonJS/UMD `main` bundles. `electron.vite.config.ts` includes `vendor/xterm` in renderer CommonJS handling so Vite/Rollup can consume the local `file:` dependency after symlink resolution.

## Upstream Base

- Upstream project: `xtermjs/xterm.js`
- Base package version: `5.5.0`
- npm `gitHead`: `9ba6c00a195c95fcf8292a2b9084d91450e5daae`
- Initial fork material: official npm package artifacts, including source maps with embedded upstream TypeScript source content.

## Where To Change

- Terminal parser, buffer, scrollback, and headless terminal semantics: `vendor/xterm/headless`.
- Browser xterm compatibility renderer behavior: `vendor/xterm/xterm`.
- aiopsterm threaded scheduling, worker protocol, canvas rendering, scrollbar, and selection glue: `src/renderer/src/services/terminal`.

Do not patch `node_modules`; reinstalling dependencies will discard it. Do not import or copy from reference-only source trees.

## Verification

After changing the fork or its package metadata, run:

```bash
npm install --ignore-scripts
npm run typecheck
```

For threaded terminal behavior, also run the focused Vitest or stress gates documented in [Development](development.md) and [Threaded Terminal Renderer](terminal-renderer-architecture.md).
