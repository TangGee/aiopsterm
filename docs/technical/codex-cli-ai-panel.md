# Codex CLI AI Panel

The right AI panel now has two modes:

- `Codex CLI`: embeds the locally built Codex CLI/TUI as a PTY-backed xterm session.
- `Classic Chat`: keeps the existing aiopsterm chat and command-card UI for later reuse.

When an AI-linked terminal has project-file context, the right assistant surface opens on project files by default. The selected surface is remembered per terminal session, so switching that terminal back to the AI surface persists; ordinary terminals and Host Agent surfaces retain their existing defaults.

The selected AI panel mode is persisted in renderer storage. The default remains `Codex CLI`, but when the user leaves the panel in `Classic Chat`, a later mount restores the panel mode and does not start the Codex PTY in the background. This mode preference does not reopen a closed transcript or Product Session. Switching back to `Codex CLI` starts or resumes the embedded TUI on demand. The header uses a compact mode menu so the tab row has room for both Classic Chat tabs and Codex tabs. Header popovers are mutually exclusive: opening More first closes the target picker and other panel popups, so a higher target-picker layer cannot cover the More menu.

Codex mode now supports multiple conversation tabs. Each tab owns its own Codex PTY session, xterm instance, lifecycle status, bound terminal target, and pending target-context file. The header `+` creates and selects a new unbound tab; it does not inherit the active workspace terminal or start Codex until the user binds a target. Creation waits for any in-flight Product Session hydration, and its explicit selection is protected from the default workspace-follow watcher until the new surface is mounted. The active tab is then scrolled into the visible part of the horizontal tab strip without moving keyboard focus. Switching existing tabs resynchronizes the aiopsterm terminal bridge target for the active tab before forwarding user input.

Codex tabs are indexed in the shared [Product Session Registry](product-session-registry.md). A product row stores the conversation title, `projectRoot`, `lastKnownCwd`, the stable target, current-main-process `isOpen`, and one current native Codex thread id; it does not store TUI output. The target label is not the conversation title. New empty rows use `Codex CLI`; once Codex's canonical thread metadata exposes a title or first user message, main publishes that bounded title with `codex:thread`, updates the Product Session, and the renderer updates the current tab. Renderer target/cwd synchronization never writes an existing row's title back, so it cannot overwrite main's native title. Registry construction in a new app process marks every row closed, so a full app restart restores no Codex tab and does not create a replacement. Renderer reloads and component remounts do not reconstruct the registry and therefore rebuild tabs for rows still open in that main-process lifetime. Closed sessions are reopened only from the Agents catalog; the Codex header lists current-process tabs and has no independent closed-session restore entry. Agents restore can fetch a row by id outside the renderer's newest-40 metadata cache. It first reuses a matching live terminal or attempts to reopen the saved local/SSH target at the last cwd, then starts `codex resume <threadId>` only after stable target/project validation and main's durable-rollout check. Target recovery failure opens an error tab with stored metadata but does not start the TUI or enable host tools. A definitely missing rollout clears only the matching stale binding and starts a replacement thread in the same Product Session; registry, binding-race, permission, and ambiguous I/O failures fail closed.

Codex tabs can also stay linked with the main terminal workspace. The renderer persists this preference in `aiopsterm.aiPanelWorkspaceLinkMode`, defaulting to `follow-workspace`. In that mode, changing the active terminal tab selects an already-bound Codex tab for that terminal, and selecting a Codex tab activates its bound terminal in the main workspace. The sync is guarded to avoid feedback loops. It never creates a Codex tab implicitly; if the current terminal has no bound Codex conversation, the AI panel shows a bind/new-session hint and leaves the active Codex tab unchanged. Switching the header link button to manual mode stores `manual` and disables both automatic directions.

Classic Chat data hydration is scheduled only when Classic is the persisted panel mode or the user switches to it. Both AppShell startup and the AI panel call `hydrateClassicChatData()` with `restoreIfEmpty:false` and `restoreSelection:false`: they load the conversation, todo, context, and command catalogs without applying `chat-history.json.selectedConversationId`, loading messages, or starting Cline. The AI panel then derives current tabs only from open Product Session rows; closed Classic rows are restored only from Agents. `appShellRuntime` is the sole global `workspace.hydrateConfig()` owner. Mounting `WorkspacePanel` refreshes its assets and keychain options but does not reapply global layout/config state. Default Codex mode skips the Classic catalogs so an explicitly created/bound Codex tab can start without waiting on them. Slower secondary catalogs such as files, Kubernetes, extensions, and knowledge base load when their workspace is entered, and extension refreshes are deduplicated.

Classic Chat's no-model state is independent from transcript emptiness. If the model catalog contains no available chat model, the panel shows the configure/login prompt even when a historical transcript has already been restored, so the user always sees the required setup action before trying to send.

Classic Chat restore also protects the renderer from oversized saved transcripts. `restoreChatConversation()` returns at most the newest 200 messages under a 2 MiB budget; the newest record is still retained when it alone exceeds that byte budget. When older rows are omitted, the backend prepends a `context_truncated` system marker, returns `totalMessages` / `returnedMessages` / `truncated` metadata, and keeps the full transcript in `userData/chat-history.json`. Later `updateChatConversation()` calls that include the truncation marker merge the loaded projection back into the existing full transcript instead of overwriting hidden older messages. The live Classic DOM initially mounts the newest 80 loaded messages, keeps at most 120 message nodes, and shifts by 40 with scroll-anchor compensation. While the viewport is already at the latest edge, same-message assistant streaming continues to follow the bottom; an operator scroll-up cancels pending follow requests until a new user message or conversation switch explicitly returns to latest. Store, persistence, metadata actions, export, and full-loaded-transcript search still use the complete loaded projection. Rows omitted by the backend restore budget do not yet have a user-facing paging API.

## Runtime Boundary

aiopsterm starts Codex through Electron main process IPC, not from renderer code.

- Main IPC channels are `codex:create`, `codex:set-target`, `codex:set-pending-context`, `codex:write`, `codex:resize`, and `codex:kill`.
- Renderer events are streamed through `codex:data`, `codex:lifecycle`, `codex:thread`, and `codex:exit`.
- The Codex process runs with `CODEX_HOME=<app userData>/codex-agent`.
- aiopsterm sets `AIOPSTERM_CODEX_FLAT_MCP_TOOLS=1` for the embedded Codex process. This enables the local Codex compatibility patch that exposes MCP tools to OpenAI-compatible Responses providers as flat function tools such as `mcp__aiopsterm_remote__target_context`, while execution still routes through the same MCP bridge and approval rules.
- aiopsterm refreshes its managed portions of `<app userData>/codex-agent/config.toml` when the main process starts and again before each Codex session starts. User-owned settings outside the aiopsterm managed blocks, such as project trust and TUI preferences, are preserved.
- aiopsterm also assigns each Codex child process an `AIOPSTERM_CODEX_PENDING_CONTEXT_FILE` under `<app userData>/codex-agent/aiopsterm-pending-context/`. The renderer overwrites that file when the active Codex tab's bound terminal target changes.
- The Codex process cwd is also fixed to `<app userData>/codex-agent`; product `projectRoot` is session metadata and does not replace this shared engine cwd, so a remote project path cannot become a client-local process path.
- Before a Codex session starts, the main process runs an asynchronous `codex --version` health check for the resolved binary. Successful checks are cached by binary path and mtime so opening additional sessions does not spawn a version probe every time. Failed checks are not cached and can be retried after the binary or environment is fixed.
- Codex CLI model access is derived from aiopsterm's OpenAI-compatible provider settings when that provider is configured for `Responses`. The generated Codex config writes `model`, `model_provider`, provider `base_url`, `env_key`, and `wire_api = "responses"`; the API key is injected only into the Codex child-process environment as `AIOPSTERM_CODEX_API_KEY` and is not written to `config.toml`.
- aiopsterm's Base URL normalization is preserved for Codex. A trailing `#` still means "do not auto-add `/v1`"; full operation URLs ending in `/responses` or `/chat/completions` are reduced to the provider base URL before Codex appends its Responses operation path.
- The default development entrypoint is `codex/codex-rs/target/<triple>/aiopsterm-codex-package/bin/codex`, built from the locally modified `codex/` source tree. The tracked `codex-source.json` locks the expected aiopsterm Codex repository and commit; `npm run codex:ensure-source` verifies an existing checkout and clones the locked commit only when `codex/` is missing.
- Packaged builds copy the complete generated Codex package directory into `resources/codex/`. This includes `codex-package.json`, `bin/codex` or `bin/codex.exe`, `codex-path/rg` or `codex-path/rg.exe`, and platform resources such as Linux `codex-resources/bwrap` or Windows `codex-resources/codex-command-runner.exe` plus `codex-resources/codex-windows-sandbox-setup.exe`; it does not copy the Codex source tree.
- `build:codex` uses Codex's own `scripts/build_codex_package.py` against the platform target triple. Linux/macOS enter through the POSIX shell wrapper; Windows enters through the Node dispatcher because `.sh` scripts are not a native Windows build surface. On Linux this matches Codex's upstream packaging strategy by building the musl target so the runtime does not depend on distribution OpenSSL 1.1 libraries.
- `audit:codex-runtime` verifies that the generated package is complete, the entrypoint is executable, answers `codex --version`, has no unresolved Linux dynamic dependencies, and does not depend on `libssl.so.1.1` or `libcrypto.so.1.1`.
- `AIOPSTERM_CODEX_PACKAGE_DIR` can point at a complete Codex package directory for packaging and startup. `AIOPSTERM_CODEX_BIN` can point at a package entrypoint for local experiments, but release packaging rejects a bare binary without package metadata.
- Linux musl package builds need the same native toolchain Codex uses for releases: `ca-certificates curl musl-tools pkg-config libcap-dev g++ clang libc++-dev libc++abi-dev lld xz-utils`. If CI provides prebuilt helpers, set `AIOPSTERM_CODEX_BWRAP_BIN` and/or `AIOPSTERM_CODEX_RG_BIN` so the package builder stages those files while still building the Codex entrypoint from the local modified `codex/` source. Windows package builds need Python 3, rustup, and the MSVC C++ build tools/Windows SDK; optional helper overrides are `AIOPSTERM_CODEX_RG_BIN`, `AIOPSTERM_CODEX_COMMAND_RUNNER_BIN`, and `AIOPSTERM_CODEX_WINDOWS_SANDBOX_SETUP_BIN`. The package builder also downloads Codex-built V8 artifacts from the OpenAI Codex release cache unless `RUSTY_V8_ARCHIVE` and `RUSTY_V8_SRC_BINDING_PATH` are preconfigured.

This keeps Codex persistence out of project `.codex` and the default user `~/.codex` directory.

aiopsterm launches a new thread with `codex` and restores one with `codex resume <threadId>`. The runtime contract also supports `codex fork <threadId>`, although the current panel has no user-facing fork action. The embedded TUI writes its primary thread id, reason, cwd, and rollout path atomically to `AIOPSTERM_CODEX_THREAD_INFO_FILE`. Main waits for a non-empty managed rollout, confirms the registry's unique one-product/one-current-thread binding, and only then emits `codex:thread`; provisional thread info cannot create resumable empty metadata. Missing rollout hints are retried directly, while full managed-directory fallback scans are rate-limited and bounded. After binding, main periodically reads Codex's canonical `state_5.sqlite` thread title/first-user metadata at a lower rate, so later native renames also propagate; it does not parse TUI output or guess from rollout text. Each publication carries the runtime's expected previous thread id. A stale resume, fork, switch, or title update whose Product Session binding has already moved fails closed, clears the PTY host-tool target, and stops that stale runtime. A later valid TUI thread switch updates that row's current binding and title while preserving target/cwd. Closing a tab first marks the product row closed and then stops only its PTY; the final tab may close without replacement. Failed stop attempts a compensating reopen, and an already-exited runtime is an idempotent success. Close preserves the rollout for Agents restore; permanent delete from Agents removes the rollout before deleting product metadata. Unbinding an already-started thread closes its existing row and creates a fresh unbound tab.

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

Prefer adapter code in aiopsterm over modifying `codex/`. If `codex/` must change, commit that change separately in the `aiopsterm-codex` repository with a `codex:` commit message, then update `codex-source.json` in the main repository to the new commit.

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
echo '<start marker>'; if "${SHELL:-sh}" -c '<command>'; then __aiopsterm_status=0; else __aiopsterm_status=$?; fi; echo '<end marker>':$__aiopsterm_status
```

and captures output from normal terminal data events until the end marker appears. The command runs inside a command-local child shell so `set -e`, `set -u`, `exit`, `exec`, `trap`, and working-directory changes in the command do not directly mutate or terminate the selected interactive shell. The outer wrapper uses `if ...; then ...; else ...; fi` so a non-zero child-shell exit still records the exit code and emits the end marker even when the parent interactive shell has `errexit` enabled. The wrapper uses `echo` instead of `printf` because some relay shells are restricted and do not provide `printf`.

In `mode: "return_immediately"`, `run_command` writes the command plus a trailing newline directly to the selected terminal and returns after the write is accepted. It does not inject markers, wait for process exit, capture output, or return an exit code. Models should use this mode for foreground long-running commands that should visibly occupy the terminal, and use ordinary shell forms such as `nohup ... &` or `cmd &` when they want the remote shell to background the task.

In `execution: "background"`, `run_command` does not write to the visible PTY. Local sessions start a hidden local shell subprocess. Direct SSH, proxy SSH, and TCP-forward jump-host sessions open an independent ssh2 `exec` channel on the target connection. Relay-shell fallback sessions use a hidden relay PTY with the same relay ControlPath and prompt inference path, then execute the same child-shell marker wrapper after the target prompt is inferred. This mode is intended only for parallel diagnostics or when the visible terminal is busy with a foreground program; the generated Codex instructions tell agents to keep using `execution: "terminal"` by default. Arbitrary user-typed nested SSH inside an unrelated terminal cannot be safely reconstructed as a background target.

Visible-terminal completion parsing strips terminal control sequences before interpreting the private start/end markers. The shared parser accepts OSC introduced by either `ESC ]` or C1 OSC and terminated by BEL, `ESC \\`, or C1 ST (`0x9c`). Supporting every standard OSC terminator prevents shell-integration metadata, including command lifecycle sequences, from consuming a valid completion marker when terminal data arrives in multiple chunks. The POSIX SSH/local, PowerShell, and CMD wrappers retain their platform-specific command construction and share only this control-sequence parsing boundary.

`read_terminal_output` reads from a main-process visible-output ring buffer populated after the bridge's display filtering has removed marker wrappers and hidden command echoes. The cache is keyed by terminal session, keeps up to 10000 visible lines, and returns absolute offset metadata (`availableStartOffset`, `startOffset`, `nextOffset`, `availableEndOffset`, `totalLines`, and `truncated`) so callers can page forward and detect when older output has been dropped. This cache is separate from renderer xterm scrollback, whose default is 1000 lines and is user-configurable.

Terminal output that uses carriage returns without newlines, such as `wget`, `npm`, or TUI progress streams, is stored as overwrite-style pending text: only the latest carriage-return segment is retained until a newline arrives. The pending progress buffer is capped at 64 KiB so a command that continually redraws one line cannot grow bridge memory without bound. The bridge only maintains this output history after the Codex terminal bridge server has started; ordinary terminal output before the first Codex session stays on the normal terminal path with no bridge-history overhead.

The selected target is explicit per Codex AI tab. A new Codex tab starts unbound and does not launch Codex until the user binds a real terminal target. The first trusted target cwd becomes the product `projectRoot`; moving within it updates `lastKnownCwd`, while changing the stable host or moving outside the root creates a new Codex product session. The user can bind the current terminal, drag a terminal tab into the AI panel, or choose a host from the target picker. Selecting a valid target closes the picker immediately; host picker binding then opens a new terminal session, binds it, and starts Codex without a second click. The initial renderer draft is not persisted independently, and the live-target watcher persists only conversations that already have a native runtime, so `bindCodexTarget()` is the sole Product Session create owner for first bind. The bridge uses strict selected-target mode for the active Codex tab: if the bound terminal is unavailable, MCP `run_command`/`target_context` return `NO_TERMINAL_SESSION` instead of falling back to an older SSH or local terminal. Runtime logs use `renderer.codex-target.*` and `codex.target.*` events to show which terminal session is bound and whether it is registered.

Target changes are not written into the Codex PTY as visible text. Instead, the renderer updates the active session's pending context file with one hidden `[aiopsterm target bound]`, `[aiopsterm target changed]`, or `[aiopsterm target unbound]` block. The embedded Codex TUI reads and clears that file immediately before the next real user submission, prefixes the block before Codex's existing `## My request for Codex:` delimiter, and leaves transcript rendering focused on the user's actual request. Repeated target changes before the next user message replace the same file; if the user switches A -> B -> A before any AI turn observes B, the renderer clears the pending file because the final target matches the last target already delivered to Codex.

The bridge is deliberately terminal-based for this slice. It lets Codex operate on hosts reached through aiopsterm's existing SSH, relay, and local terminal flows without giving Codex direct access to client-local shell tools.

The embedded Codex terminal host owns its own clipboard affordance because it does not share the main workspace terminal context menu. Selecting text and right-clicking copies the selected Codex terminal text; `Ctrl+Shift+C` / `Cmd+Shift+C` also copy the terminal selection without forwarding that key event to the Codex process.

Codex output is coalesced on both sides of the IPC boundary. The main process batches `codex:data` delivery and logs `codex.data.summary` / `codex.data.coalesced`. In product mode, the renderer writes active Codex PTY data directly into the same `ThreadedTerminalHost.write()` path used by workspace terminals, so parsing, dirty-row snapshots, and frame-cadence painting stay in the shared core/render workers. Inactive Codex conversations keep their output queued in runtime state; when a conversation becomes visible again, the renderer flushes the preserved output through that same terminal host path.

When the app background is active, the embedded Codex terminal uses a fully transparent terminal theme background. The AI pane owns the readable glass layer on the Codex host: idle tabs stay lighter so the selected background remains visible, while ready/running tabs keep a darker translucent terminal surface for transcript readability.

The Codex terminal host may mount before the real Codex PTY session id exists. The renderer creates the host with the local conversation id, then late-binds the real session id after `codex:create` returns or after early output claims a pending conversation. That late bind updates the threaded host/core metadata, visibility, and existing snapshot presentation, but it must not force repeated DOM refits from the Vue host ref path. Conversation rows are Vue reactive proxies from creation onward, including first bind, restore, and target rotation, so PTY callbacks that set `sessionId` or lifecycle status immediately remove the terminal stack's idle/empty presentation. Terminal, FitAddon, and ResizeObserver instances stored on those reactive conversation rows are wrapped with Vue `markRaw`; otherwise Vue can proxy a Worker-bearing host and make the first structured-clone operation fail. The Codex terminal stack owns the frame/background, the threaded host remains transparent, and the shared `codex-side` RenderGroup canvas paints behind the per-terminal DOM overlays. Because Codex tabs are mutually exclusive while workspace panes can be simultaneously visible, tab switches explicitly synchronize all Codex threaded surfaces so only the active Codex conversation is visible in the shared canvas. The shared canvas clears the Codex viewport before painting transparent-background rows and clears hidden tab rects on visibility changes, preventing stale TUI glyphs from overlapping new Codex output. Product Codex sessions require this threaded terminal path; if it is disabled or cannot initialize, the renderer reports `renderer.codex-threaded-terminal.required` and shows a diagnostic error instead of falling back to main-thread xterm.

The threaded-terminal-unavailable transition is idempotent per reactive conversation and failure reason. Repeated Vue function-ref callbacks may retry `ensureTerminal()`, but an unchanged failure does not rewrite AI attention state or emit another runtime log entry. The shared attention runtime also treats an identical upsert and a missing removal as no-ops, preserving the current array reference and preventing notification updates from feeding another component render. In crash safe mode, target selection still closes the picker and persists the target, but displays one diagnostic and does not call `codex:create`; a normal restart with threaded terminal support then starts the bound Codex session.

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
- `npx vitest run tests/ai-panel-codex-conversation-runtime.test.ts tests/ai-panel-codex-terminal-runtime.test.ts tests/codex-product-session-lifecycle.test.ts tests/codex-sessions-ipc.test.ts tests/product-session-registry.test.ts tests/product-sessions-ipc.test.ts`
- `npx vitest run tests/ai-panel-compact-header.test.ts tests/agents-sidebar-product-sessions.test.ts`
- `npx vitest run tests/package-config.test.ts`
- `npm run audit:package-config`
- `npm run build`

The full suite must run with `better-sqlite3` rebuilt for the active Node/Vitest ABI. Before launching Electron again, run `npm run rebuild:native` to restore the Electron ABI as documented in [Development](development.md#native-module-abi-during-tests).
