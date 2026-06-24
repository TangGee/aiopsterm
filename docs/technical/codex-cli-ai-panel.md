# Codex CLI AI Panel

The right AI panel now has two modes:

- `Codex CLI`: embeds the copied Codex CLI/TUI as a PTY-backed xterm session.
- `Classic Chat`: keeps the existing aiopsterm chat and command-card UI for later reuse.

The selected AI panel mode is persisted in renderer storage. The default remains `Codex CLI`, but when the user leaves the panel in `Classic Chat`, a later mount restores Classic Chat and does not start the Codex PTY in the background. Switching back to `Codex CLI` starts or resumes the embedded TUI on demand. The header uses a compact mode menu so the tab row has room for both Classic Chat tabs and Codex tabs.

Codex mode now supports multiple conversation tabs. Each tab owns its own Codex PTY session, xterm instance, lifecycle status, bound terminal target, and pending target-context file. Creating a new Codex tab can bind the current terminal target and start a new Codex session; switching tabs resynchronizes the aiopsterm terminal bridge target for the active tab before forwarding user input.

Codex tabs can also stay linked with the main terminal workspace. The renderer persists this preference in `aiopsterm.aiPanelWorkspaceLinkMode`, defaulting to `follow-workspace`. In that mode, changing the active terminal tab selects an already-bound Codex tab for that terminal, and selecting a Codex tab activates its bound terminal in the main workspace. The sync is guarded to avoid feedback loops. It never creates a Codex tab implicitly; if the current terminal has no bound Codex conversation, the AI panel shows a bind/new-session hint and leaves the active Codex tab unchanged. Switching the header link button to manual mode stores `manual` and disables both automatic directions.

Classic Chat startup is now scheduled so visible AI data is restored early only when Classic Chat is the persisted panel mode. During `hydrateConfig()`, default Codex CLI mode skips Classic Chat history, AI todo state, context catalog, and command catalog loading so the embedded Codex terminal can start without waiting on chat-side catalogs. If the user persisted Classic Chat, or switches from Codex CLI to Classic Chat, `hydrateClassicChatData()` loads chat history, AI todo state, context catalog, and command catalog together. Slower secondary catalogs such as files, Kubernetes, extensions, and knowledge base are no longer loaded during app startup; their panels refresh from the backend when the user enters the corresponding module. Extension catalog refreshes are deduplicated so the left plugin panel and main plugin workspace do not issue parallel duplicate requests.

Classic Chat's no-model state is independent from transcript emptiness. If the model catalog contains no available chat model, the panel shows the configure/login prompt even when a historical transcript has already been restored, so the user always sees the required setup action before trying to send.

Classic Chat restore also protects the renderer from oversized saved transcripts. `restoreChatConversation()` returns the newest bounded message window instead of sending an arbitrarily large conversation to the UI. When older rows are omitted, the backend prepends a `context_truncated` system marker, returns `totalMessages` / `returnedMessages` / `truncated` metadata, and keeps the full transcript in `userData/chat-history.json`. Later `updateChatConversation()` calls that include the truncation marker merge the visible window back into the existing full transcript instead of overwriting hidden older messages. This is a guardrail, not full pagination; long-term history paging/windowed rendering remains the next refinement if users need to browse the omitted rows directly.

## Runtime Boundary

aiopsterm starts Codex through Electron main process IPC, not from renderer code.

- Main IPC channels are `codex:create`, `codex:set-target`, `codex:set-pending-context`, `codex:write`, `codex:resize`, and `codex:kill`.
- Renderer events are streamed through `codex:data`, `codex:lifecycle`, and `codex:exit`.
- The Codex process runs with `CODEX_HOME=<app userData>/codex-agent`.
- aiopsterm sets `AIOPSTERM_CODEX_FLAT_MCP_TOOLS=1` for the embedded Codex process. This enables the local Codex compatibility patch that exposes MCP tools to OpenAI-compatible Responses providers as flat function tools such as `mcp__aiopsterm_remote__target_context`, while execution still routes through the same MCP bridge and approval rules.
- aiopsterm refreshes its managed portions of `<app userData>/codex-agent/config.toml` when the main process starts and again before each Codex session starts. User-owned settings outside the aiopsterm managed blocks, such as project trust and TUI preferences, are preserved.
- aiopsterm also assigns each Codex child process an `AIOPSTERM_CODEX_PENDING_CONTEXT_FILE` under `<app userData>/codex-agent/aiopsterm-pending-context/`. The renderer overwrites that file when the active Codex tab's bound terminal target changes.
- The Codex process cwd is also fixed to `<app userData>/codex-agent`; renderer-provided cwd is ignored so local HOME or project paths are not accidentally model-visible as target state.
- Codex CLI model access is derived from aiopsterm's OpenAI-compatible provider settings when that provider is configured for `Responses`. The generated Codex config writes `model`, `model_provider`, provider `base_url`, `env_key`, and `wire_api = "responses"`; the API key is injected only into the Codex child-process environment as `AIOPSTERM_CODEX_API_KEY` and is not written to `config.toml`.
- aiopsterm's Base URL normalization is preserved for Codex. A trailing `#` still means "do not auto-add `/v1`"; full operation URLs ending in `/responses` or `/chat/completions` are reduced to the provider base URL before Codex appends its Responses operation path.
- The default development entrypoint is `codex/codex-rs/target/<triple>/aiopsterm-codex-package/bin/codex`, built from the locally modified `codex/` source tree.
- Packaged builds copy the complete generated Codex package directory into `resources/codex/`. This includes `codex-package.json`, `bin/codex` or `bin/codex.exe`, `codex-path/rg` or `codex-path/rg.exe`, and platform resources such as Linux `codex-resources/bwrap` or Windows `codex-resources/codex-command-runner.exe` plus `codex-resources/codex-windows-sandbox-setup.exe`; it does not copy the Codex source tree.
- `build:codex` uses Codex's own `scripts/build_codex_package.py` against the platform target triple. Linux/macOS enter through the POSIX shell wrapper; Windows enters through the Node dispatcher because `.sh` scripts are not a native Windows build surface. On Linux this matches Codex's upstream packaging strategy by building the musl target so the runtime does not depend on distribution OpenSSL 1.1 libraries.
- `audit:codex-runtime` verifies that the generated package is complete, the entrypoint is executable, answers `codex --version`, has no unresolved Linux dynamic dependencies, and does not depend on `libssl.so.1.1` or `libcrypto.so.1.1`.
- `AIOPSTERM_CODEX_PACKAGE_DIR` can point at a complete Codex package directory for packaging and startup. `AIOPSTERM_CODEX_BIN` can point at a package entrypoint for local experiments, but release packaging rejects a bare binary without package metadata.
- Linux musl package builds need the same native toolchain Codex uses for releases: `ca-certificates curl musl-tools pkg-config libcap-dev g++ clang libc++-dev libc++abi-dev lld xz-utils`. If CI provides prebuilt helpers, set `AIOPSTERM_CODEX_BWRAP_BIN` and/or `AIOPSTERM_CODEX_RG_BIN` so the package builder stages those files while still building the Codex entrypoint from the local modified `codex/` source. Windows package builds need Python 3, rustup, and the MSVC C++ build tools/Windows SDK; optional helper overrides are `AIOPSTERM_CODEX_RG_BIN`, `AIOPSTERM_CODEX_COMMAND_RUNNER_BIN`, and `AIOPSTERM_CODEX_WINDOWS_SANDBOX_SETUP_BIN`. The package builder also downloads Codex-built V8 artifacts from the OpenAI Codex release cache unless `RUSTY_V8_ARCHIVE` and `RUSTY_V8_SRC_BINDING_PATH` are preconfigured.

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

- `mcp__aiopsterm_remote__list_terminals`: lists visible aiopsterm terminal sessions registered with the embedded bridge and marks the selected target. Codex config sets this tool to `approval_mode = "approve"` because it is read-only.
- `mcp__aiopsterm_remote__run_command`: runs a command against the selected real aiopsterm terminal session. Its default `execution: "terminal"` writes to the visible terminal. `execution: "background"` uses an independent execution channel only for parallel work or when the visible terminal is occupied by a foreground program; it does not write to the visible terminal and currently supports `mode: "wait"` only. The default `mode: "wait"` captures output plus exit code; `mode: "return_immediately"` writes the command as normal terminal input and returns after the write without waiting for exit, for long-running foreground commands or commands that manage their own backgrounding. Codex config sets this tool to `approval_mode = "prompt"` so remote execution stays approval-gated.
- `mcp__aiopsterm_remote__read_terminal_output`: reads a bounded line range from the recent visible output cache for the selected terminal. It supports `offset`/`limit` pagination and can include output produced by commands the user typed manually in that terminal. Codex config sets this tool to `approval_mode = "approve"` because it is read-only.
- `mcp__aiopsterm_remote__read_file`: reads a bounded line range from a remote file through the selected terminal. Codex config sets this tool to `approval_mode = "approve"` because it is read-only.
- `mcp__aiopsterm_remote__glob_search`: runs a bounded remote file-name search through the selected terminal and returns structured path entries. Codex config sets this tool to `approval_mode = "approve"` because it is read-only.
- `mcp__aiopsterm_remote__grep_search`: runs a bounded remote content search through the selected terminal and returns structured matches when no context lines are requested. Codex config sets this tool to `approval_mode = "approve"` because it is read-only.
- `mcp__aiopsterm_remote__target_context`: returns the selected terminal target context without running a command. Codex config sets this tool to `approval_mode = "approve"` because it is read-only.

Codex normally exposes MCP tools as Responses `namespace` tools. Some OpenAI-compatible Responses providers accept the request but do not reliably call namespace tools. The embedded aiopsterm process therefore enables the flat MCP compatibility path above: model-visible names are flat function tools, but raw MCP server/tool names are preserved internally for dispatch.

Prompt boundaries now explicitly require the embedded agent to:

- Treat the local Codex process, cwd, filesystem, and project docs as client implementation details, not host state.
- Call `target_context` before the first command when the target is ambiguous or may have changed, and use `list_terminals` when it needs to understand available aiopsterm terminal targets.
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

`resources/codex-aiopsterm-mcp.js` is packaged as an extra resource and started by Codex as a stdio MCP server. It does not execute commands locally. It forwards `tools/call` requests to the Electron main-process Unix/pipe socket exposed by `src/main/backend/codex/codexTerminalBridge.ts`.

The bridge keeps a registry of active aiopsterm terminal sessions. `list_terminals` snapshots that registry without creating, focusing, closing, or writing to terminals. `run_command` resolves the requested or currently selected terminal. In default `mode: "wait"` it writes:

```text
echo '<start marker>'; <command>; __aiopsterm_status=$?; echo '<end marker>':$__aiopsterm_status
```

and captures output from normal terminal data events until the end marker appears. The wrapper uses `echo` instead of `printf` because some relay shells are restricted and do not provide `printf`.

In `mode: "return_immediately"`, `run_command` writes the command plus a trailing newline directly to the selected terminal and returns after the write is accepted. It does not inject markers, wait for process exit, capture output, or return an exit code. Models should use this mode for foreground long-running commands that should visibly occupy the terminal, and use ordinary shell forms such as `nohup ... &` or `cmd &` when they want the remote shell to background the task.

In `execution: "background"`, `run_command` does not write to the visible PTY. Local sessions start a hidden local shell subprocess. Direct SSH, proxy SSH, and TCP-forward jump-host sessions open an independent ssh2 `exec` channel on the target connection. Relay-shell fallback sessions use a hidden relay PTY with the same relay ControlPath and prompt inference path, then execute a marker-wrapped command after the target prompt is inferred. This mode is intended only for parallel diagnostics or when the visible terminal is busy with a foreground program; the generated Codex instructions tell agents to keep using `execution: "terminal"` by default. Arbitrary user-typed nested SSH inside an unrelated terminal cannot be safely reconstructed as a background target.

`read_terminal_output` reads from a main-process visible-output ring buffer populated after the bridge's display filtering has removed marker wrappers and hidden command echoes. The cache is keyed by terminal session, keeps up to 10000 visible lines, and returns absolute offset metadata (`availableStartOffset`, `startOffset`, `nextOffset`, `availableEndOffset`, `totalLines`, and `truncated`) so callers can page forward and detect when older output has been dropped. This cache is separate from renderer xterm scrollback, whose default is 1000 lines and is user-configurable.

The selected target is explicit per Codex AI tab. A new Codex tab starts unbound and does not launch Codex until the user binds a real terminal target. The user can bind the current terminal, drag a terminal tab into the AI panel, or choose a host from the target picker; host picker binding opens a new terminal session first and then binds that session. The bridge uses strict selected-target mode for the active Codex tab: if the bound terminal is unavailable, MCP `run_command`/`target_context` return `NO_TERMINAL_SESSION` instead of falling back to an older SSH or local terminal. Runtime logs use `renderer.codex-target.*` and `codex.target.*` events to show which terminal session is bound and whether it is registered.

Target changes are not written into the Codex PTY as visible text. Instead, the renderer updates the active session's pending context file with one hidden `[aiopsterm target bound]`, `[aiopsterm target changed]`, or `[aiopsterm target unbound]` block. The embedded Codex TUI reads and clears that file immediately before the next real user submission, prefixes the block before Codex's existing `## My request for Codex:` delimiter, and leaves transcript rendering focused on the user's actual request. Repeated target changes before the next user message replace the same file; if the user switches A -> B -> A before any AI turn observes B, the renderer clears the pending file because the final target matches the last target already delivered to Codex.

The bridge is deliberately terminal-based for this slice. It lets Codex operate on hosts reached through aiopsterm's existing SSH, relay, and local terminal flows without giving Codex direct access to client-local shell tools.

The embedded Codex xterm owns its own clipboard affordance because it does not share the main workspace terminal context menu. Selecting text and right-clicking copies the selected Codex terminal text; `Ctrl+Shift+C` / `Cmd+Shift+C` also copy the xterm selection without forwarding that key event to the Codex process.

Codex output is coalesced on both sides of the IPC boundary. The main process batches `codex:data` delivery and logs `codex.data.summary` / `codex.data.coalesced`; the renderer writes bounded batches into the visible Codex xterm and logs `renderer.codex-output.summary` / `renderer.codex-output.slow-write`. Inactive Codex conversations keep their output queued in runtime state but do not continuously write to hidden xterm hosts; when a conversation becomes visible again, the renderer flushes the preserved output before resuming incremental writes.

When the app background is active, the embedded Codex xterm is initialized with xterm transparency enabled and a fully transparent xterm theme background. The AI pane owns the readable glass layer on the Codex host: idle tabs stay lighter so the selected background remains visible, while ready/running tabs keep a darker translucent terminal surface for transcript readability.

## Build

Use:

```bash
scripts/build-and-start.sh
```

The script builds a local Codex dev package from the modified `codex/` source tree, audits that runtime, builds aiopsterm, then starts Electron preview. On Linux this dev package uses the host GNU target and Codex's `dev-small` Cargo profile, for example `codex/codex-rs/target/x86_64-unknown-linux-gnu/aiopsterm-codex-dev-package/bin/codex`, so local iteration does not require the musl release toolchain. The builder disables debug assertions for that profile to keep embedded preview runtime behavior close to release behavior when Codex stream events arrive out of order. It reads `codex/codex-rs/rust-toolchain.toml`, installs the declared Rust toolchain if needed, exports `RUSTUP_TOOLCHAIN`, and passes the rustup-managed Cargo path to the Codex package builder so older system Cargo versions do not fail on the Rust 2024 edition workspace. Before Cargo starts, the dev and release builders scan the active Codex Cargo profile for zero-byte Rust artifacts and delete the host/target profile cache when found; this handles interrupted builds and host OS switches that leave invalid `.rlib`, `.rmeta`, or object files under `codex/codex-rs/target`. It still needs `pkg-config`, OpenSSL development files, and `bubblewrap`; when system `libssl-dev` is missing on apt-based Linux, the dev builder can download and unpack `libssl-dev` into `.cache/aiopsterm-codex-dev/` from the configured apt mirror. If `/usr/local` contains older OpenSSL 1.1 headers or pkg-config files, the dev builder rejects that default and uses a supported OpenSSL 3 pkg-config source, including the cached `libssl-dev` overlay when needed, before the runtime audit verifies that the built Codex binary does not depend on `libssl.so.1.1` or `libcrypto.so.1.1`. Rustup installs retry with `rsproxy.cn` when the default endpoint is unreachable, and V8 release artifacts are prefetched through configurable GitHub mirrors via `AIOPSTERM_GITHUB_MIRROR`. Use `--skip-codex` only when that dev package already exists or `AIOPSTERM_CODEX_PACKAGE_DIR` / `AIOPSTERM_CODEX_BIN` is set. Package scripts run `npm run build:codex` before electron-builder; that release path still builds the musl package with the same declared Rust toolchain and the afterPack hook copies the resulting package directory into packaged resources.

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
