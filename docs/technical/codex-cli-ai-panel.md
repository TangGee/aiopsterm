# Codex CLI AI Panel

The right AI panel now has two modes:

- `Codex CLI`: embeds the copied Codex CLI/TUI as a PTY-backed xterm session.
- `Classic Chat`: keeps the existing aiopsterm chat and command-card UI for later reuse.

## Runtime Boundary

aiopsterm starts Codex through Electron main process IPC, not from renderer code.

- Main IPC channels are `codex:create`, `codex:write`, `codex:resize`, and `codex:kill`.
- Renderer events are streamed through `codex:data`, `codex:lifecycle`, and `codex:exit`.
- The Codex process runs with `CODEX_HOME=<app userData>/codex-agent`.
- The default development binary is `codex/codex-rs/target/release/codex`.
- `AIOPSTERM_CODEX_BIN` can point at a different binary for local experiments.

This keeps Codex persistence out of project `.codex` and the default user `~/.codex` directory.

## Iteration Rules

Each Codex integration slice should record:

- The toolset being enabled, disabled, or deferred.
- Prompt changes and the host context they assume.
- Tests run and regressions checked.
- Overall product completion after the slice.

Prefer adapter code in aiopsterm over modifying `codex/`. If `codex/` must change, commit that change separately with a `codex:` commit message.

## Current Toolset Review

This slice only embeds the upstream Codex CLI/TUI. It does not yet replace Codex shell tools with aiopsterm remote-host tools.

Deferred toolset work:

- Bind shell execution to the selected aiopsterm terminal or remote host.
- Define remote host prompt context.
- Add dangerous command approval rules for remote operations.
- Audit Codex tool prompts before enabling remote execution.

## Build

Use:

```bash
scripts/build-and-start.sh
```

The script builds the Codex CLI binary when missing, builds aiopsterm, then starts Electron preview. Use `--skip-codex` only when `codex/codex-rs/target/release/codex` already exists or `AIOPSTERM_CODEX_BIN` is set.

## Verification

Current slice verification:

- `npm run typecheck`
- `npx vitest run tests/codex-cli-backend.test.ts tests/local-terminal-backend.test.ts`
- `npx vitest run tests/app-shell.test.ts`
- `npm run build`

Full `npm test` currently reaches 779 passing tests and 2 skipped tests, with 17 failures isolated to SQLite-backed tests because the local `better-sqlite3` native module was built for `NODE_MODULE_VERSION 125` while the Vitest Node runtime requires `NODE_MODULE_VERSION 115`. Rebuild the native dependency for the active Node runtime before using full-suite SQLite results as a regression signal.
