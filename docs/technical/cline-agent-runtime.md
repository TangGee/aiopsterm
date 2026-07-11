# Cline Agent Runtime

aiopsterm uses the official Cline SDK as the shared Agent engine for Classic host management and DB AI. aiopsterm remains the owner of product UI, trusted target selection, security policy, terminal and database execution, and user-facing history.

The integration is pinned to `@cline/sdk@0.0.59`, release commit `0b65506a2b2225d55e5cc827e8296c9b65ff81ef`. The dependency is consumed from npm. Cline source is not copied into aiopsterm, and `external-reference/` remains reference-only.

## Runtime Boundary

```text
renderer
  -> typed Electron IPC commands
  <- typed Agent task events
Electron main
  -> authenticated JSON-lines child-process bridge
  <- tool and approval requests
Cline Agent sidecar (Node 22 runtime + CommonJS bundle)
  -> @cline/sdk ClineCore
  -> provider-native tool calling and Agent loop
Electron main
  -> aiopsterm terminal runtime
  -> aiopsterm database MCP runtime
```

Cline SDK requires Node 22 or newer while Electron 31 embeds Node 20. The production sidecar therefore ships an exact-pinned Node `22.20.0` runtime beside a CommonJS bundle. Bun `1.3.13` is used only as the build-time bundler and is not included in the packaged application. This avoids both the unsupported Electron Node runtime and the JavaScriptCore/WebKit static-link license obligations of a Bun-compiled executable. Development runs the TypeScript source through Bun by default so a stale build artifact cannot shadow source changes; set `AIOPSTERM_CLINE_USE_BUILT_SIDECAR=1` only when intentionally testing the built Node-plus-bundle layout.

The sidecar communicates only through inherited standard IO. Provider secrets are sent in request bodies after process creation and are never placed in command-line arguments, logs, events, or renderer state. Every protocol envelope has a version, request id, and explicit message kind. Unknown messages fail closed.

## Profiles

### Classic Host

Classic Chat uses a Cline session without tools. Classic Command uses a command-proposal tool and never executes it automatically. Classic Agent exposes only aiopsterm-owned remote host tools bound to a trusted terminal session.

The model cannot select a terminal by IP address, hostname, label, or arbitrary session id. Electron main binds the Agent task to a live `terminalSessionId`; tool input contains the command and execution options only. Cline's local shell, filesystem, browser, MCP settings, spawn-agent, and team tools are disabled.

Host execution reuses the bounded command capture in the aiopsterm terminal bridge. Main validates the exact profile allowlist both when a session starts and when each callback arrives. A `run_host_command` callback cannot execute until main has recorded a matching approval proof for the same tool name, `toolCallId`, normalized input, and terminal binding. Repeated callbacks with the same id and input share one Promise/result; reusing an id with different input fails closed. Terminal output returned to Cline is capped at 256 KiB and includes `outputTruncated` plus `originalOutputBytes` when shortened.

Main-process security policy decides whether approval is required; model-provided risk fields are display hints only. The Auto Approval preference is additionally constrained by a fail-closed read-only classifier. Redirection, command substitution, subshells, multiline commands, interpreters, interactive/follow modes, and commands outside the explicit diagnostic allowlist always require operator review. Aborting a running Agent turn cancels its bound command capture and sends an interrupt to the selected terminal before the Cline session is aborted.

### DB AI

Each DB AI conversation has a separate Cline session namespace and a backend-bound database context. The model cannot switch `connectionId`, database, or schema by supplying tool arguments.

The initial read-only tool set is:

- `search_database_objects`
- `describe_database_table`
- `get_database_table_ddl`
- `query_database_table`

Connection enumeration, arbitrary SQL execution, DDL, DML, and table mutation are not exposed. Metadata and query results are untrusted tool data and never become instructions. Chinese locale requires Simplified Chinese explanatory prose; every other locale requires English. SQL, identifiers, code, and original database errors stay unchanged.

## Task Contract

An Agent task is identified by a stable tuple:

```text
profile + taskId + turnId
```

Tool approvals additionally require:

```text
toolCallId + trusted terminalSessionId/database binding
```

Main starts, sends, aborts, approves, rejects, and closes tasks. Sidecar events are monotonically sequenced per task and include status, text/reasoning deltas, tool calls, tool results, approval requests, usage, completion, cancellation, and errors. Stale task, turn, or tool ids are rejected. A decision is single-use and a restored pending call is never executed automatically.

The runtime uses a maximum of eight model iterations per turn, sequential tool execution, loop detection, and default-deny tool policies. Read-only DB metadata tools may be auto-approved. Host command execution requires an approval decision from main even when the strict read-only policy makes that decision automatic. Any future state-changing database tool requires explicit backend policy and operator approval.

## Context And Persistence

ClineCore owns canonical model messages, tool-call/result pairs, token accounting, abort state, and context compaction. Compaction is explicitly enabled with the `basic` strategy. The SDK's current `agentic` summarizer is coding-oriented, so it is not used for host or database sessions.

aiopsterm conversation ids map to explicit Cline `sessionId` values with profile prefixes. The session identity also includes the response locale; Classic Agent adds the trusted terminal binding, and DB AI adds connection, database, and schema. Changing any of those boundaries starts or resumes a separate canonical transcript instead of carrying old host/database instructions into the new context. Classic history and DB AI UI state remain aiopsterm-owned projections for favorites, feedback, tabs, drawer state, and compatibility with existing records. They are not truncated and resent as a fixed 12-message context after migration. Existing history can seed a new Cline session once; historical tool calls are treated as completed records and are never replayed. The Classic UI blocks creating, restoring, closing the active tab, or deleting a conversation while a response/approval is active, so an asynchronous result cannot be written into the wrong visible conversation.

Cline data is stored below the aiopsterm user-data directory, never in the user's default `~/.cline`. User-machine Cline rules, skills, workflows, plugins, MCP configuration, and telemetry are not loaded.

Persistence has two layers. The renderer-facing projections remain in the existing aiopsterm files:

- `<userData>/chat-history.json` stores Classic Chat, Command, and Agent conversation metadata, selected conversation state, and displayed messages.
- `<userData>/database-workspace.json` stores Database workspace state, including `aiPaneState`. This file also contains database connection records and encrypted secret payloads, so it should not be edited casually or shared as a transcript export.

Cline's canonical Agent state is created when the first Cline-backed task starts and uses this layout:

```text
<userData>/cline-agent/
  db/
    sessions.db
  sessions/
    <sessionId>/
      <sessionId>.json
      <sessionId>.messages.json
      <sessionId>.compaction.json   # present only after compaction state is written
```

`sessions.db` is the session index and status store. The session manifest records the provider, model, status, metadata, and workspace values. The messages file is the canonical model transcript, including system prompt and tool-call/result records. The optional compaction file lets Cline resume a compacted context without reconstructing it from a fixed recent-message window. SQLite may also create `sessions.db-wal` and `sessions.db-shm` while the sidecar is running.

`<userData>` is Electron's `app.getPath('userData')`; on a normal Linux development run it is usually `~/.config/aiopsterm`. `AIOPSTERM_USER_DATA_DIR` can override it for an isolated run. Cline receives both `cwd` and `workspaceRoot` as `<userData>`, but this is a containment root rather than the command target directory: Cline's local filesystem and local-shell tools are disabled. Classic Agent commands run in the currently bound terminal or SSH session and inherit that terminal's actual current directory. DB AI does not use a filesystem working directory; it operates only through its bound database context and allowlisted database tools.

## Provider Mapping

aiopsterm model settings are mapped at task start:

| aiopsterm provider | Cline provider id |
| --- | --- |
| OpenAI Compatible | `openai-compatible` |
| LiteLLM | `litellm` |
| Anthropic | `anthropic` |
| DeepSeek | `deepseek` |
| Ollama | `ollama` |
| LM Studio | `lmstudio` |
| Amazon Bedrock | `bedrock` |

Base URL, API key, model id, Bedrock credentials, reasoning effort, thinking budget, and proxy-aware fetch behavior are mapped without persisting a second provider configuration. Unsupported provider shapes return a typed unavailable error rather than falling back to the old text-only loop.

Every turn submits the current provider connection. When a Cline session is already active, the sidecar applies the current provider, model, credentials, endpoint, and reasoning settings through `updateSessionConnection` before sending the prompt. The update runs in the same task/turn context as initial session startup, so any provider catalog request remains bound to the authenticated callback tuple instead of using stale connection settings.

When the SSH-aware AI proxy is enabled, only the `useHostProxy` decision enters the sidecar contract; proxy endpoints and proxy credentials remain in Electron main. Main owns every proxied provider request controller for the active turn and aborts outstanding requests on explicit task abort, turn completion, sidecar exit, and runtime shutdown. Request and response bodies remain limited to 2 MiB and the main-side request deadline is 180 seconds.

## Packaging And License

The SDK, Node runtime, and Bun bundler dependencies are exact-pinned. Six native Node packages cover Linux, macOS, and Windows on x64/arm64 as root optional dependencies; each `22.20.0` tarball integrity is recorded in the root lockfile. The build resolves the current package directly and never uses the script-installing `node` wrapper package. The sidecar build is target-OS specific and runs before Electron packaging. `electron-builder` excludes all raw native Node npm packages from `app.asar` and ships only `node`/`node.exe`, `cline-agent-sidecar.cjs`, the manifest, Bun metafile, CycloneDX SBOM, third-party notices, Node license, Cline license, and Cline attribution as one `extraResource` directory. Application startup invokes the shipped Node runtime with the bundle as its only argument and verifies the expected protocol and SDK versions.

Cline is Apache-2.0, Copyright 2026 Cline Bot Inc. The packaged application includes the upstream license and an attribution file because the npm tarballs do not consistently include the repository root license. Cline names and assets are not used as aiopsterm product branding.

The official SDK exposes `ClineCore` only through the root `@cline/sdk`/`@cline/core` entry, whose prebuilt provider registry imports providers aiopsterm does not expose. The sidecar bundler replaces the unused Claude Code and SAP AI Core provider modules at resolution time. This excludes `ai-sdk-provider-claude-code`, `@anthropic-ai/claude-agent-sdk`, `@jerome-benoit/sap-ai-provider`, `@sap-ai-sdk/*`, and `@sap/*` implementation code without copying or modifying Cline source. The normal Anthropic API provider remains enabled; only the separate Claude Code provider is excluded.

Every build derives its dependency inventory from Bun's metafile. It fails if a restricted package, restricted implementation marker, `external-reference/` path, unknown license, non-allowlisted license, or missing license evidence appears. The generated SBOM enumerates every bundled JavaScript package and the shipped Node runtime; `THIRD-PARTY-NOTICES.txt` includes component-to-license evidence, and `NODE-LICENSE` carries Node's complete upstream third-party notices. The runtime audit independently recomputes this boundary, checks Linux dynamic links for unresolved or OpenSSL 1.1 dependencies, and initializes OpenAI Compatible, OpenAI Native, Anthropic API, DeepSeek, Ollama, LM Studio, LiteLLM, and Bedrock sessions without making provider requests. A deterministic proxied OpenAI-compatible SSE exchange additionally proves the real `model -> approval -> tool -> result -> model -> final` Agent loop.

Every SDK upgrade must re-run Agent loop, native tool calling, approval, rejection, abort, restore, compaction, provider, cross-platform packaging, package-size, dependency-license, and telemetry/network audits.

## Deployment Status

Classic host mode and DB AI use ClineCore directly when a configured provider is available. There is no runtime feature switch or legacy-loop rollback path in the current implementation, and a started turn never falls through to the old XML/text parser. Renderer-owned Agent continuation has been removed. Release readiness is established by the sidecar loop smoke, package/SBOM/license audits, Electron build, and native platform package verification; `external-reference/` remains reference-only and is excluded from imports and packages.
