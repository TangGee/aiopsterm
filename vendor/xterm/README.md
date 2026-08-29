# aiopsterm xterm Fork

This directory contains aiopsterm's local fork of the xterm packages used by the terminal runtime.

## Packages

- `headless`: package name `@xterm/headless`, consumed by the threaded terminal core worker.
- `xterm`: package name `@xterm/xterm`, consumed by the legacy compatibility renderer and xterm addons.

Both packages are wired through root `package.json` `file:` dependencies. Keep imports as `@xterm/headless` and `@xterm/xterm`; npm resolves those names to this vendor tree.

The packages keep the official CommonJS/UMD `main` bundles. The renderer build config includes `vendor/xterm` in Vite/Rollup CommonJS handling because `file:` dependencies resolve to this directory instead of a normal registry package path.

## Upstream Base

- Upstream project: `https://github.com/xtermjs/xterm.js`
- Package version: `5.5.0`
- npm `gitHead`: `9ba6c00a195c95fcf8292a2b9084d91450e5daae`
- Initial source material: official npm packages `@xterm/headless@5.5.0` and `@xterm/xterm@5.5.0`

The published bundles include source maps with `sourcesContent`, so the initial fork preserves the upstream TypeScript source context even though the runtime entry points are the published bundles.

## Maintenance Rules

- Make xterm and headless terminal-core changes in this directory, not in `node_modules`.
- After package metadata or dependency changes, run `npm install --ignore-scripts` so `package-lock.json` and `node_modules/@xterm/*` point at this fork.
- Do not copy from reference-only source trees.
- Record behavior changes in `docs/technical/xterm-fork.md` and terminal renderer behavior changes in `docs/technical/terminal-renderer-architecture.md`.
