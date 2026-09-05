# Contributing

Thank you for your interest in improving aiopsterm. This guide covers the
development setup, quality gates, and pull request workflow. By participating
you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

For deeper maintainer-facing detail, read
[docs/technical/development.md](docs/technical/development.md) and
[docs/usage/development-commands.md](docs/usage/development-commands.md).

## Development Environment

- **Platforms:** macOS, Linux, or Windows. Development and unit tests work on
  all three; platform packages must be built on their native OS.
- **Node.js:** 20, 22, or 24. Node 22 is the reference version used by CI and
  by the packaged agent runtime.
- **Rust toolchain:** only required for full package builds, which compile the
  embedded Codex runtime. `rustup` installs the toolchain declared in
  `codex/codex-rs/rust-toolchain.toml` automatically. Day-to-day development
  does not need Rust.

## Quick Start

```bash
git clone https://github.com/TangGee/aiopsterm.git
cd aiopsterm
npm ci
npm run native:ensure:node   # prepare native modules (better-sqlite3, node-pty) for the Node test runtime
npm run dev                  # prepare the Electron binding and launch the app
```

## Quality Gates

Run these before opening a pull request:

- `npm test` — runs the i18n, state-ownership, and best-practices-docs audits,
  prepares the Node native binding, then runs the Vitest suite.
- `npm run build` — runs the same audits plus `npm run typecheck` and the
  electron-vite production build.

The audits available as individual npm scripts:

| Script | What it checks |
| ------ | -------------- |
| `npm run audit:i18n` | renderer UI text is covered by i18n keys |
| `npm run audit:state-ownership` | protected store fields are written only through owner actions |
| `npm run audit:best-practices-docs` | the bilingual user guide trees stay aligned |
| `npm run audit:package-config` | electron-builder packaging configuration |
| `npm run audit:client-mocks` | no client-side mocks leak into production paths |

Never commit secrets, private keys, certificates, build artifacts, or user
data.

## Full Package Builds

A complete installer additionally compiles two bundled runtimes:

- The **embedded Codex runtime** (`npm run build:codex`). Its source is a
  separate public repository, [TangGee/aiopsterm-codex](https://github.com/TangGee/aiopsterm-codex);
  `scripts/ensure-codex-source.mjs` clones the exact commit recorded in
  `codex-source.json` into `codex/` when that directory is absent. This step
  requires the Rust toolchain.
- The **Cline agent sidecar** (`npm run build:cline-sidecar`), bundled with an
  exact-pinned Node 22.20.0 runtime.

Per-platform entry points:

- Linux: `bash scripts/build-linux.sh` (AppImage and deb)
- macOS: `bash scripts/build-macos.sh` (dmg and zip)
- Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows.ps1` (NSIS)

Each wrapper can install missing toolchain prerequisites and verifies the
resulting package. See
[docs/usage/development-commands.md](docs/usage/development-commands.md) for
flags such as `--skip-setup`, `--run-tests`, and `--china-mirror`.

## Branching And Pull Requests

1. Fork the repository and create a feature branch from `master`.
2. Make your change with focused commits.
3. Run `npm test` and `npm run build` locally.
4. Open a pull request against `master` of `TangGee/aiopsterm`. The PR must
   pass CI (audits, typecheck, and unit tests on GitHub Actions) before it can
   be merged.

Describe user-visible changes in the PR description so maintainers can judge
the documentation impact.

## Commit Style

Follow the existing history: a conventional `type: summary` subject line in
English, for example:

- `fix: refresh Codex history after session edits`
- `feat: add configurable agent session parsers`
- `docs: align open source repository workflow`

Common types are `feat`, `fix`, `docs`, `refactor`, `chore`, and `test`.

## Documentation

Documentation lives under `docs/` and is bilingual: the user guide keeps
aligned `zh-CN` and `en-US` trees. When you change user-visible behavior,
update the matching documentation in both languages in the same change. Run
`npm run audit:best-practices-docs` after editing guide prose, links,
filenames, or images.

## License

By contributing, you agree that your contributions are licensed under the
Apache License 2.0 that covers aiopsterm's own code; see [LICENSE](LICENSE).
