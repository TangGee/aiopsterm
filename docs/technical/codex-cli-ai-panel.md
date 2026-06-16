# Codex CLI AI Panel

The right AI panel now has two modes:

- `Codex CLI`: embeds the copied Codex CLI/TUI as a PTY-backed xterm session.
- `Classic Chat`: keeps the existing aiopsterm chat and command-card UI for later reuse.

The selected AI panel mode is persisted in renderer storage. The default remains `Codex CLI`, but when the user leaves the panel in `Classic Chat`, a later mount restores Classic Chat and does not start the Codex PTY in the background. Switching back to `Codex CLI` starts or resumes the embedded TUI on demand.

Classic Chat startup is now scheduled so visible AI data is restored early only when Classic Chat is the persisted panel mode. During `hydrateConfig()`, default Codex CLI mode skips Classic Chat history, AI todo state, context catalog, and command catalog loading so the embedded Codex terminal can start without waiting on chat-side catalogs. If the user persisted Classic Chat, or switches from Codex CLI to Classic Chat, `hydrateClassicChatData()` loads chat history, AI todo state, context catalog, and command catalog together. Slower secondary catalogs such as files, Kubernetes, extensions, and knowledge base are no longer loaded during app startup; their panels refresh from the backend when the user enters the corresponding module. Extension catalog refreshes are deduplicated so the left plugin panel and main plugin workspace do not issue parallel duplicate requests.

Classic Chat's no-model state is independent from transcript emptiness. If the model catalog contains no available chat model, the panel shows the configure/login prompt even when a historical transcript has already been restored, so the user always sees the required setup action before trying to send.

Classic Chat restore also protects the renderer from oversized saved transcripts. `restoreChatConversation()` returns the newest bounded message window instead of sending an arbitrarily large conversation to the UI. When older rows are omitted, the backend prepends a `context_truncated` system marker, returns `totalMessages` / `returnedMessages` / `truncated` metadata, and keeps the full transcript in `userData/chat-history.json`. Later `updateChatConversation()` calls that include the truncation marker merge the visible window back into the existing full transcript instead of overwriting hidden older messages. This is a guardrail, not full pagination; long-term history paging/windowed rendering remains the next refinement if users need to browse the omitted rows directly.

## Runtime Boundary

aiopsterm starts Codex through Electron main process IPC, not from renderer code.

- Main IPC channels are `codex:create`, `codex:set-target`, `codex:write`, `codex:resize`, and `codex:kill`.
- Renderer events are streamed through `codex:data`, `codex:lifecycle`, and `codex:exit`.
- The Codex process runs with `CODEX_HOME=<app userData>/codex-agent`.
- aiopsterm writes `<app userData>/codex-agent/config.toml` before each Codex session starts.
- The Codex process cwd is also fixed to `<app userData>/codex-agent`; renderer-provided cwd is ignored so local HOME or project paths are not accidentally model-visible as target state.
- Codex CLI model access is derived from aiopsterm's OpenAI-compatible provider settings when that provider is configured for `Responses`. The generated Codex config writes `model`, `model_provider`, provider `base_url`, `env_key`, and `wire_api = "responses"`; the API key is injected only into the Codex child-process environment as `AIOPSTERM_CODEX_API_KEY` and is not written to `config.toml`.
- aiopsterm's Base URL normalization is preserved for Codex. A trailing `#` still means "do not auto-add `/v1`"; full operation URLs ending in `/responses` or `/chat/completions` are reduced to the provider base URL before Codex appends its Responses operation path.
- The default development binary is `codex/codex-rs/target/release/codex`.
- Packaged builds copy only the built Codex CLI executable into `resources/codex/codex` (or the platform executable name), not the Codex source tree.
- `AIOPSTERM_CODEX_BIN` can point at a different binary for local experiments.

This keeps Codex persistence out of project `.codex` and the default user `~/.codex` directory.

The generated Codex config also isolates the embedded agent from aiopsterm's implementation workspace:

- `instructions` is replaced with an aiopsterm operations-agent prompt.
- `developer_instructions` carries the selected workspace unit and terminal target context.
- `include_environment_context`, `include_permissions_instructions`, `include_apps_instructions`, and `include_collaboration_mode_instructions` are disabled.
- `project_doc_max_bytes = 0` prevents local `AGENTS.md` project docs from being injected.
- `web_search = "disabled"` and local/browser/app/plugin/agent/image-generation features are disabled.
- Because `<environment_context>` is disabled, the agent must use `target_context` plus remote commands for cwd, shell, current date/time, timezone, hostname, and filesystem facts.

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
- `mcp__aiopsterm_remote__read_file`: reads a bounded line range from a remote file through the selected terminal. Codex config sets this tool to `approval_mode = "approve"` because it is read-only.
- `mcp__aiopsterm_remote__glob_search`: runs a bounded remote file-name search through the selected terminal and returns structured path entries. Codex config sets this tool to `approval_mode = "approve"` because it is read-only.
- `mcp__aiopsterm_remote__grep_search`: runs a bounded remote content search through the selected terminal and returns structured matches when no context lines are requested. Codex config sets this tool to `approval_mode = "approve"` because it is read-only.
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
- Add richer result pagination and offload files for very large remote file/search outputs.
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

The embedded Codex xterm owns its own clipboard affordance because it does not share the main workspace terminal context menu. Selecting text and right-clicking copies the selected Codex terminal text; `Ctrl+Shift+C` / `Cmd+Shift+C` also copy the xterm selection without forwarding that key event to the Codex process.

## Build

Use:

```bash
scripts/build-and-start.sh
```

The script builds the Codex CLI binary when missing, builds aiopsterm, then starts Electron preview. Use `--skip-codex` only when `codex/codex-rs/target/release/codex` already exists or `AIOPSTERM_CODEX_BIN` is set. Package scripts run `npm run build:codex` before electron-builder, and the afterPack hook copies the resulting executable into packaged resources.

## Verification

Current slice verification:

- `npm run typecheck`
- `npx vitest run tests/chat-history-backend.test.ts tests/workspace-store.test.ts`
- `npx vitest run tests/app-shell.test.ts`
- `npx vitest run tests/app-shell.test.ts tests/codex-cli-backend.test.ts tests/codex-terminal-bridge.test.ts`
- `npx vitest run tests/package-config.test.ts`
- `npm run audit:package-config`
- `npm run build`

Full `npm test` currently reaches 779 passing tests and 2 skipped tests, with 17 failures isolated to SQLite-backed tests because the local `better-sqlite3` native module was built for `NODE_MODULE_VERSION 125` while the Vitest Node runtime requires `NODE_MODULE_VERSION 115`. Rebuild the native dependency for the active Node runtime before using full-suite SQLite results as a regression signal.
