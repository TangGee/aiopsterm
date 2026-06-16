# Codex CLI AI Panel

The right AI panel now has two modes:

- `Codex CLI`: embeds the copied Codex CLI/TUI as a PTY-backed xterm session.
- `Classic Chat`: keeps the existing aiopsterm chat and command-card UI for later reuse.

## Runtime Boundary

aiopsterm starts Codex through Electron main process IPC, not from renderer code.

- Main IPC channels are `codex:create`, `codex:set-target`, `codex:write`, `codex:resize`, and `codex:kill`.
- Renderer events are streamed through `codex:data`, `codex:lifecycle`, and `codex:exit`.
- The Codex process runs with `CODEX_HOME=<app userData>/codex-agent`.
- aiopsterm writes `<app userData>/codex-agent/config.toml` before each Codex session starts.
- The default development binary is `codex/codex-rs/target/release/codex`.
- `AIOPSTERM_CODEX_BIN` can point at a different binary for local experiments.

This keeps Codex persistence out of project `.codex` and the default user `~/.codex` directory.

The generated Codex config also isolates the embedded agent from aiopsterm's implementation workspace:

- `instructions` is replaced with an aiopsterm operations-agent prompt.
- `developer_instructions` carries the selected workspace unit and terminal target context.
- `include_environment_context`, `include_permissions_instructions`, `include_apps_instructions`, and `include_collaboration_mode_instructions` are disabled.
- `project_doc_max_bytes = 0` prevents local `AGENTS.md` project docs from being injected.
- `web_search = "disabled"` and local/browser/app/plugin/agent/image-generation features are disabled.

## Iteration Rules

Each Codex integration slice should record:

- The toolset being enabled, disabled, or deferred.
- Prompt changes and the host context they assume.
- Tests run and regressions checked.
- Overall product completion after the slice.

Prefer adapter code in aiopsterm over modifying `codex/`. If `codex/` must change, commit that change separately with a `codex:` commit message.

## Current Toolset Review

Codex local command tools are disabled for the embedded aiopsterm mode. Host operations go through a required MCP server named `aiopsterm_remote`.

Enabled tools:

- `mcp__aiopsterm_remote__run_command`: writes a marker-wrapped, non-interactive command to the selected real aiopsterm terminal session and returns captured output plus exit code. Codex config sets this tool to `approval_mode = "prompt"` so remote execution stays approval-gated.
- `mcp__aiopsterm_remote__target_context`: returns the selected terminal target context without running a command. Codex config sets this tool to `approval_mode = "approve"` because it is read-only.

Prompt boundaries now explicitly require the embedded agent to:

- Treat the local Codex process, cwd, filesystem, and project docs as client implementation details, not host state.
- Call `target_context` before the first command when the target is ambiguous or may have changed.
- Continue in analysis/Q&A mode when no live terminal is selected instead of fabricating output.
- Prefer read-only diagnostics, require explicit confirmation for risky host changes, and stop without bypass suggestions when aiopsterm reports a security block.

Disabled or intentionally unavailable:

- Codex shell/unified-exec/code-mode local execution.
- Local project `AGENTS.md`, skills, apps, plugins, browser/computer-use, image generation, web search, and Codex multi-agent tools.
- Default request-user-input tooling; aiopsterm should own any end-user prompting UX.

Deferred toolset work:

- Add interactive command/session streaming semantics beyond marker-delimited non-interactive commands.
- Add separate structured file/search tools for remote host inspection instead of asking the model to compose all search operations as shell commands.
- Evaluate whether future app-server integration should replace the PTY/TUI embedding while keeping the same aiopsterm MCP boundary.

## Terminal Bridge

`resources/codex-aiopsterm-mcp.js` is packaged as an extra resource and started by Codex as a stdio MCP server. It does not execute commands locally. It forwards `tools/call` requests to the Electron main-process Unix/pipe socket exposed by `src/main/backend/codexTerminalBridge.ts`.

The bridge keeps a registry of active aiopsterm terminal sessions. `run_command` resolves the requested or currently selected terminal, writes:

```text
echo '<start marker>'; <command>; __aiopsterm_status=$?; echo '<end marker>':$__aiopsterm_status
```

and captures output from normal terminal data events until the end marker appears. The wrapper uses `echo` instead of `printf` because some relay shells are restricted and do not provide `printf`.

The selected target is dynamic. The AI panel sends the active workspace terminal context through `codex:set-target` when Codex starts and whenever the active terminal panel changes. The bridge then uses strict selected-target mode: if the current panel has no live terminal session, MCP `run_command`/`target_context` return `NO_TERMINAL_SESSION` instead of falling back to an older SSH or local terminal. Runtime logs use `renderer.codex-target.*` and `codex.target.*` events to show which terminal session is selected and whether it is registered.

The bridge is deliberately terminal-based for this slice. It lets Codex operate on hosts reached through aiopsterm's existing SSH, relay, and local terminal flows without giving Codex direct access to client-local shell tools.

## Build

Use:

```bash
scripts/build-and-start.sh
```

The script builds the Codex CLI binary when missing, builds aiopsterm, then starts Electron preview. Use `--skip-codex` only when `codex/codex-rs/target/release/codex` already exists or `AIOPSTERM_CODEX_BIN` is set.

## Verification

Current slice verification:

- `npm run typecheck`
- `npx vitest run tests/codex-cli-backend.test.ts tests/codex-terminal-bridge.test.ts tests/local-terminal-backend.test.ts`
- `npx vitest run tests/app-shell.test.ts`
- `npm run build`

Full `npm test` currently reaches 779 passing tests and 2 skipped tests, with 17 failures isolated to SQLite-backed tests because the local `better-sqlite3` native module was built for `NODE_MODULE_VERSION 125` while the Vitest Node runtime requires `NODE_MODULE_VERSION 115`. Rebuild the native dependency for the active Node runtime before using full-suite SQLite results as a regression signal.
