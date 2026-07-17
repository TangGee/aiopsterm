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
  -> Classic controlled-tool runtime (knowledge, session todo, MCP resources)
  -> aiopsterm database MCP runtime
```

Cline SDK requires Node 22 or newer while Electron 31 embeds Node 20. The production sidecar therefore ships an exact-pinned Node `22.20.0` runtime beside a CommonJS bundle. Bun `1.3.13` is used only as the build-time bundler and is not included in the packaged application. This avoids both the unsupported Electron Node runtime and the JavaScriptCore/WebKit static-link license obligations of a Bun-compiled executable. Development runs the TypeScript source through Bun by default so a stale build artifact cannot shadow source changes; set `AIOPSTERM_CLINE_USE_BUILT_SIDECAR=1` only when intentionally testing the built Node-plus-bundle layout.

The sidecar communicates only through inherited standard IO. Provider secrets are sent in request bodies after process creation and are never placed in command-line arguments, logs, events, or renderer state. Every protocol envelope has a version, request id, and explicit message kind. Unknown messages fail closed.

## Profiles

### Classic Host

Classic Chat uses a Cline session without tools. Classic Command uses a command-proposal tool and never executes it automatically. Classic Agent always has `search_knowledge_base`, `todo_read`, `todo_write`, `access_mcp_resource`, and `read_host_command_output`; only knowledge, todo, and session-bound output reads are auto-approved. A Classic turn may select up to five hosts. When at least one selected host resolves to a trusted live terminal, Agent additionally receives `read_host_file`, `search_host_files`, and `run_host_command`. The two host-inspection tools, MCP resource access, and host commands are approval-gated. No other Cline or aiopsterm tool name is accepted for the profile.

The model selects one host only by the exact opaque `targetId` from the current turn's allowlist. It cannot supply an IP address, hostname, username, credential, or arbitrary terminal session id. Electron main canonicalizes each renderer-selected host against Main-owned terminal metadata and freezes the turn's `targetId -> terminalSessionId` map. `run_host_command` input contains `targetId`, the complete command, the required boolean `requiresApproval`, and bounded execution options. Host file tools accept the same `targetId` plus bounded path/search fields; Main inserts the trusted terminal id only after validation and verifies that the bridge result came from that same session. Cline's local shell, filesystem, browser, MCP settings, spawn-agent, and team tools are disabled.

Main validates the exact profile allowlist both when a session starts and when each callback arrives. `run_host_command`, `read_host_file`, and `search_host_files` cannot execute until Main records a matching approval proof for the same task, turn, tool name, `toolCallId`, raw-input fingerprint, opaque `targetId`, target label, terminal session, and renderer owner. `access_mcp_resource` uses the same proof but binds an exact `(serverName, uri)` from the current turn's frozen safe catalog instead of a terminal. Main rechecks that the resource is still enabled when the operator responds and the controlled resource runtime rechecks it again before reading. Repeated callbacks with the same id and input share one Promise/result; reusing an id with different input fails closed. Inline terminal output is bounded; larger retained output is addressed only through a random opaque `fileRef` scoped by a hash of the deterministic Cline session. `read_host_command_output` accepts that reference plus bounded byte offsets, never a path, and returns at most 128 KiB per call.

`classicAgentTools.ts` owns the remaining auxiliary policy. Knowledge queries are 2-512 characters, request at most ten index results, and return at most 64 KiB of untrusted snippets. Todo writes replace only the current internal Cline session partition, allow at most 32 validated rows, and persist atomically in `<userData>/classic-agent-todos.json`; no model field can name another session. `read_host_file` is limited to 500 lines and `search_host_files` to 200 filename/content results, with strict control-character, option-like path, glob, integer, and boolean validation plus a 64 KiB returned-data cap. Both use the terminal bridge's fixed `sed`, `find`, or `grep` templates, require explicit approval even when read-only auto-execution is enabled, and are tracked as cancellable commands.

MCP access is intentionally asymmetric. Main places at most 50 resources and 12,000 serialized characters from at most 20 configured servers into an explicitly untrusted Agent catalog. Each row contains only `serverName`, `uri`, resource name, and description; transport commands, environment variables, headers, and credentials never enter the prompt, approval event, renderer card, or log metadata. `access_mcp_resource` requires explicit operator approval for the exact `(serverName, uri)` present in that enabled discovered-resource catalog, rechecks the returned identity, limits output to eight parts and 64 KiB, and reports binary size without returning binary payload. `use_mcp_tool` is not registered because generic MCP calls may mutate external state and need a separate tool-effect policy; the new resource approval proof does not grant generic MCP tool execution.

The model declares approval intent for the complete command through `requiresApproval`: `false` for non-destructive diagnostics and `true` for state changes, interactive or long-running work, and uncertainty. Missing or malformed values fail closed to manual approval. Main then applies the user-configured command security policy independently; a block remains blocked and a security approval requirement overrides a model `false`. Automatic execution deliberately has no executable-name allowlist. A model-declared non-destructive command that passes Main security can continue when Auto Approval or `自动执行只读命令` is enabled, or after the operator enables `查询类自动执行` for that deterministic Cline session. Stopping and later restoring the Product Session in the same main-process lifetime retains the session opt-in, while permanent deletion or runtime shutdown clears it. Aborting a running Agent turn cancels its bound command capture and sends an interrupt to the selected terminal before the Cline session is aborted.

### DB AI

Each DB AI conversation has a separate Cline session namespace and a backend-bound database context. The model cannot switch `connectionId`, database, or schema by supplying tool arguments.

The initial read-only tool set is:

- `search_database_objects`
- `describe_database_table`
- `get_database_table_ddl`
- `query_database_table`

Connection enumeration, arbitrary SQL execution, DDL, DML, and table mutation are not exposed. Metadata and query results are untrusted tool data and never become instructions. Chinese locale requires Simplified Chinese explanatory prose; every other locale requires English. SQL, identifiers, code, and original database errors stay unchanged.

Every DB callback remains correlated by `taskId`, `turnId`, and `toolCallId`. Distinct tool-call ids in one model response are scheduled in model order against the same immutable database binding, and the next DB proxy tool does not start until the previous result has completed. Main remains defensive if duplicate or overlapping callbacks arrive: an exact retry of one id shares its original Promise/result, while reusing that id with another tool name or input fails closed and cannot overwrite another result.

## Task Contract

An Agent task is identified by a stable tuple:

```text
profile + taskId + turnId
```

Tool approvals additionally require:

```text
toolName + toolCallId + input fingerprint + exact host target or MCP resource binding
```

Main starts, sends, aborts, approves, rejects, and closes tasks. Sidecar events are monotonically sequenced per task and include status, text/reasoning deltas, tool calls, tool results, approval requests, usage, completion, cancellation, and errors. Stale task, turn, or tool ids are rejected. A decision is single-use and a restored pending call is never executed automatically. Chat-history restore reconciles active task snapshots only in the returned display clone: `starting`, `running`, and `waiting-approval` become terminal restored records, and unfinished Command cards become failed with an explicit re-request notice. The durable snapshot is not mutated by restore, and a defensive `CLINE_AGENT_APPROVAL_NOT_FOUND` response applies the same terminal projection instead of returning the card to a clickable pending state.

The model may return several tool calls in one assistant response, but aiopsterm always schedules those calls in response order with `maxParallelToolCalls: 1`. Cline 0.0.59 normally prepares approval for the complete batch before it starts sequential execution. To preserve a complete per-tool lifecycle, the sidecar marks only its internal proxy-tool policy as auto-approved and invokes the real aiopsterm approval immediately inside each proxy `execute`. The resulting order is `approval(A) -> execute(A) -> result(A) -> approval(B)`, so a later confirmation cannot block an already approved command. A rejection skips the trusted backend execution but still becomes an error tool result with the original `toolCallId`; every model-emitted tool call therefore has a protocol-matching result before the next provider request. The main turn coordinator decides whether to race the send against an approval pause from the tool policy, not from the surface name; current DB tools never enter that pause because their allowlist is explicitly read-only and automatic.

Operator approval has no sidecar callback or `session.send` wall-clock timeout. Each approval remains pending until the operator responds, the task is aborted, the Product Session is closed/deleted, the sidecar exits, or the runtime shuts down. Provider requests, tool execution, iteration count, and process startup retain their own bounded deadlines, so removing the human-wait timer does not make model or execution work unbounded.

Cancellation is turn-scoped and fail-fast at the product boundary. Main freezes the active turn before accepting any later callback, rejects its pending approval, aborts provider proxy fetches, interrupts the exact bound terminal command or host-file inspection, and aborts the active DB MCP callback through a per-call `AbortSignal`. It then publishes one `cancelled` terminal immediately; the UI does not wait for a provider, tool, or sidecar acknowledgement. The sidecar releases every callback owned by that session with `AbortError` and asks the official SDK to abort the run. Its abort response is emitted only after the old send coroutine has released the native session, so a new turn for the same Product Session waits at that lifecycle boundary instead of receiving an `active turn` error. Different Product Sessions remain independently usable while the old turn settles.

Visible-terminal commands use a per-terminal FIFO lease. Cancelling a queued command removes only that queue entry. Cancelling the active command resolves the tool call as aborted and sends `Ctrl-C`, but the next command is not written until the interrupted wrapper emits its end marker or the terminal reaches a trusted shell prompt. If neither boundary appears within two seconds, the command channel is isolated and queued or later commands fail closed until the terminal session is reconnected; output from an interrupted command can therefore never be attributed to its successor.

Product-session close gives `session.stop` a 1.5-second grace period. A failed or expired stop is not detached and reported as success: Main force-terminates the old Cline sidecar, waits for the process exit, rejects all requests owned by that process, and only then releases the Product Session lifecycle gate. The next start for the same deterministic native id waits behind that gate, so a late stop cannot terminate a newly restored session. If even `SIGKILL` does not produce an exit, close fails and the Product Session open state is rolled back. Forced process isolation also terminates other turns in that sidecar with explicit runtime errors; it is a last-resort consistency boundary, not the normal cancellation path.

Each turn publishes exactly one terminal event: `done`, `cancelled`, or `error`. A recoverable Cline SDK error is projected as a non-terminal running status with its diagnostic message so the later completion remains authoritative. The sidecar normally emits the terminal before replying to `session.send`; Electron main records the first terminal event, drops all later status/delta/tool events for that turn, and synthesizes the matching terminal from the request result or failure if the sidecar response path omitted it. A sidecar exit becomes a non-recoverable `error` terminal, and a request failure without a prior terminal also triggers a best-effort sidecar abort before the task binding is released.

The Classic and DB renderers share one task-event lifecycle over the same preload event channel: exact `(taskId, turnId)` correlation, readiness-aware buffering, protocol-sequence replay, and terminal cleanup. Each surface runtime owns a disposable subscription and supplies its own projection adapter. Classic registers the full Agent task identity before invoking the response bridge, so the first status or tool event binds the existing assistant placeholder and projects immediately; a coincident `turnId` from another task cannot enter that route. Chat and Command retain bridge completion because Command proposals are returned as structured cards, and a missing or rejected bridge explicitly releases its route and buffered events. The fallback buffer has a soft size limit: text in one transcript segment is merged across non-rendered progress events; ephemeral reasoning, usage, ordinary status, and tool progress may be evicted; assistant text, tool calls/results, approvals, interruption, and terminal events are never discarded. A genuine transcript/protocol burst may temporarily exceed the soft limit rather than break the tool protocol. The Classic adapter projects the Cline event stream as an append-only message timeline. Real assistant text stays above a later tool card; text emitted after a tool result becomes a new assistant result message at the end, so a turn is naturally `assistant text -> Tool A -> Tool B -> final assistant text` (or `Tool A -> Tool B -> final assistant text` when the model starts with tools). The initial `正在请求...` exchange row is only a correlation placeholder, not assistant content: the first real text or tool card replaces it, and each later content block is appended. Each command or sensitive-read card is keyed by `(taskId, turnId, toolCallId)`, and approval/result events update only that exact card. Host inspections reuse the existing tool card with a target label and bounded arguments; MCP resources reuse the resource card. Their buttons route to the Cline approval IPC, never the legacy chat-history MCP approval endpoints, and the auto-approve action is hidden. A `tool-call` creates and persists a running command card even when main approved a read-only command without publishing `approval-requested`; its matching result updates the same persisted card. Turn-level status events never replace a tool card's identity. Tool result, rejection, `done`, `cancelled`, non-recoverable `error`, and `interrupted` settle every residual card so the UI cannot retain clickable approval controls indefinitely. DB AI and other Cline events are not retained by the Classic adapter. An early approval response is only a delivery fallback and metadata source; it does not create a separate answer row or reorder the event projection.

DB AI intentionally uses a different UI projection adapter. Its Cline-native transcript still contains every database tool call and matching result, and the tools execute sequentially inside the backend Agent loop. The pane consumes the same lifecycle events to keep one assistant record in `streaming` state and settle early terminal/error events, then replaces the same record with the final text and `done` state after the backend response. Individual database tool calls are therefore available to Cline context but are not rendered as separate pane messages. The current database profile allowlist requires every tool to be `autoApprove: true`; a manually gated database/write tool is rejected by policy rather than silently executed. A future write-tool adapter can use the existing `approval-requested` lifecycle and add database-bound approval metadata without creating a second Agent loop.

Approval actions re-resolve the current card by message id and the complete task/turn/tool tuple after the IPC Promise settles. A `tool-result`, cancellation, or error that arrives while approval IPC is pending therefore remains authoritative; the late approval response cannot overwrite a terminal card with `running`. If Cline publishes the required error result for a rejected command, the card remains rejected and is never relabeled as approved or executed.

The runtime uses a maximum of eight model iterations per turn, sequential tool execution, loop detection, and default-deny tool policies. Read-only DB metadata tools may be auto-approved. Host command execution requires an approval decision from Main even when the model declaration, security policy, and user preference make that decision automatic. Any future state-changing database tool requires explicit backend policy and operator approval.

## Context And Persistence

ClineCore owns canonical model messages, tool-call/result pairs, token accounting, abort state, and context compaction. Compaction is explicitly enabled with the `basic` strategy. The SDK's current `agentic` summarizer is coding-oriented, so it is not used for host or database sessions.

Classic rich context crosses the renderer boundary as references, not as renderer-authoritative file content. Electron main resolves knowledge documents and images inside the configured knowledgebase root, resolves staged chat attachments only below the current conversation's attachment directory, and reads referenced Classic conversations from the Main-owned chat store without changing the selected conversation. Knowledge-search matches carry their exact line range; selected documents, search excerpts, past-chat transcripts, entry counts, and aggregate bytes all have independent limits. Text is serialized into a JSON block explicitly labeled as untrusted provider data. Missing, binary, oversized, escaped, or stale text references degrade to a bounded availability notice and never grant filesystem access to Cline.

Classic images use ClineCore's native `userImages` turn input. The accepted media types are JPEG, PNG, GIF, and WebP; each image may contain at most 5 MiB of decoded bytes, and one user message may contain at most five images across inline uploads and selected image contexts. The composer and edit composer reject an unsupported, oversized, malformed, or sixth image before insertion and show a user-facing notice. Electron main independently revalidates the trusted path boundary or inline base64, media signature, actual decoded size, and combined count before creating the exchange request. Any image-policy error rejects the exchange instead of silently dropping an image or replacing it with a filename notice. The Classic adapter validates the accepted data URLs once more immediately before the official Cline turn. Image pixels and text inside an image remain untrusted data; they cannot change the selected host, tool policy, or approval decision.

Enabled User Rules are loaded from Main's authoritative settings store for each turn, with the current config snapshot as a failure fallback. Legacy `customInstructions` are included once when present. Rules are bounded and placed in the Cline system prompt as operator-authorized preferences, followed by an explicit non-override clause: they cannot weaken credential secrecy, opaque target binding, tool schemas, command security, approval requirements, or evidence requirements. Selected Skill bodies remain fully resolved in Main and injected for the turn, but Skill/document/chat/image content is still classified as untrusted data rather than system authority.

Product conversation ids map one-to-one to deterministic Cline `sessionId` values while bound. Classic Chat, Command, and Agent normalize to one `classic` namespace and use the Product Session id directly as their scope; locale, mode, selected hosts, and tool definitions alter the current turn policy rather than creating parallel native transcripts. The active-session signature serializes the profile, system prompt, and each complete tool definition, including its description, input schema, approval policy, completion behavior, and timeout. A signature change stops the active instance and restarts the same native id. There is no released-session migration protocol or version suffix. A profile-only registry update remains valid when native id, `scopeKey`, and trusted scope are unchanged. DB AI uses one `database` namespace keyed by its product id; response language is a per-turn policy, not another session key.

Codex project/target changes and DB connection/database/schema changes rotate their Product Session before another tool-capable turn. Classic instead keeps one Product Session while its selected host set changes: each turn supplies a fresh validated host-target allowlist, and every tool call must name one allowed `targetId`. The registry's unique `(engine, nativeSessionId)` index prevents one canonical Cline transcript from being attached to two Product Sessions. See [Product Session Registry](product-session-registry.md).

Classic history and DB AI state remain aiopsterm-owned UI projections. They are not truncated and resent as a fixed 12-message context on every turn. Existing visible history can seed a new native Cline session once; after that, Cline loads its own messages and compaction state. Historical tool calls in a seed are completed records and are never replayed. Classic restores at most the newest 200 messages under a 2 MiB budget, retaining the newest record even if it alone exceeds that byte budget; its live DOM initially renders 80 loaded messages and keeps a 120-message sliding window that moves 40 messages at a time. While the viewport follows the latest message, streaming text and newly appended tool cards keep it at the bottom after DOM layout. Browser scroll anchoring or projection growth does not cancel that intent, while an explicit upward wheel, touch, scrollbar, or keyboard action does. Initial Classic mount and every return from the hidden Codex surface force the current transcript to its latest edge, and observed root/message size growth follows only while the operator has not cancelled that intent. Each current or archived DB AI projection keeps at most 24 messages. These are UI windows, not Cline context limits. Classic tabs can be created, switched, or closed while another turn is active. The renderer keeps a per-conversation message projection and routes Cline events by turn, while background snapshots use a preserve-selection history update so a late result cannot replace the visible tab. Closing or deleting a Classic product session requests native cancellation; ordinary tab switching leaves the native turn running until it reaches a terminal state. The composer distinguishes active processing from an operator approval wait without disabling the stop action.

Native restore is checked before the UI projection is used. The sidecar first calls `manager.get(sessionId)` and, when a persisted session exists, `manager.readMessages(sessionId)`. A thrown index or message-read error fails the start and does not call `manager.start`, so permissions or damaged storage cannot be mistaken for a new session and overwritten with a UI seed. When the deterministic session is absent, or exists but has no canonical messages, the bounded Classic/DB projection may still seed it once. Subsequent active turns update the provider connection and continue from Cline-owned state. A full app/main-process restart does not resume any of these sessions: registry construction marks every Product Session closed, and an explicit Agents restore reopens only the selected row. A renderer reload or component remount within the same main-process lifetime may reconstruct UI tabs for rows already open, but Cline still resumes lazily on the next turn.

Cline data is stored below the aiopsterm user-data directory, never in the user's default `~/.cline`. User-machine Cline rules, skills, workflows, plugins, MCP configuration, and telemetry are not loaded.

Persistence has separate ownership layers:

- `<userData>/product-sessions/registry.db` uses schema v3 to index product identity, current-main-process `isOpen`, project/cwd, trusted target/database context, Classic `@context` references, and one current native binding. It contains no transcript and marks every row closed when a new app process constructs the registry.
- `<userData>/chat-history.json` stores the Classic conversation catalog, selected conversation, displayed messages, favorites, and feedback.
- `<userData>/database-workspace.json` stores Database workspace state, including the current `aiPaneState` session and at most 40 entries in `aiPaneState.archivedSessions`; each snapshot keeps at most 24 messages. This file also contains database connection records and encrypted secret payloads, so it should not be edited casually or shared as a transcript export.
- `<userData>/classic-agent-todos.json` stores bounded Classic Agent plan rows partitioned by deterministic native session id. It never stores a terminal id, host credential, or remote execution approval.
- `<userData>/cline-agent/` stores the canonical native Cline sessions described below.

Main chat-history IPC registration and later catalog reads idempotently index legacy Classic projections that are missing from the registry as closed rows. This backfill does not restore a selected id, seed/start Cline, or change an existing row's open state. Open rows may be reconciled after a renderer reload; Agents is the only cross-surface entry point for reopening a closed Classic or DB AI Product Session. Classic restores its UI projection and schema-v3 `@context` references before the next Cline turn. Host restoration accepts only an exact current stable resource id; former single-host fields and endpoint-only matches are ignored. References that no longer resolve remain visible as unavailable chips and are omitted from provider input. Selected hosts are resolved into a per-turn `targetId -> terminalSessionId` map; unresolved selections fail closed, while no host selection remains valid for Q&A and exposes no host tools. DB AI attempts to reconnect and validates the saved connection/database/schema. A failed or missing binding opens the projection read-only with a Retry action, while an evicted projection opens with no UI messages but retains its registry binding and canonical Cline context. These are product-adapter decisions; Cline never chooses a replacement terminal or database.

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

`<userData>` is Electron's `app.getPath('userData')`; on a normal Linux development run it is usually `~/.config/aiopsterm`. `AIOPSTERM_USER_DATA_DIR` can override it for an isolated run. Cline receives both `cwd` and `workspaceRoot` as `<userData>`, but this is a shared containment root rather than the product session's `projectRoot`: Cline's local filesystem and local-shell tools are disabled, and no per-session project directory is created. Each Classic Agent command runs in the one terminal selected by that call's validated `targetId` and inherits that terminal's actual current directory. DB AI does not use a filesystem working directory; it operates only through its bound database context and allowlisted database tools.

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

When the SSH-aware AI proxy is enabled, only the `useHostProxy` decision enters the sidecar contract; proxy endpoints and proxy credentials remain in Electron main. Main owns every proxied provider request controller for the active turn and aborts outstanding requests on explicit task abort, turn completion, sidecar exit, and runtime shutdown. A proxied provider request body is limited to 40 MiB so five accepted images can survive base64 expansion; the provider response body remains limited to 2 MiB, and the main-side request deadline is 180 seconds. Each authenticated JSON-lines sidecar protocol frame is limited to 64 MiB, and each Product Session projection message is limited to 40 MiB. These are defense-in-depth transport ceilings, not additional user-facing image allowances: the four-format, 5 MiB-per-image, five-image policy remains authoritative.

## Packaging And License

The SDK, Node runtime, and Bun bundler dependencies are exact-pinned. Six native Node packages cover Linux, macOS, and Windows on x64/arm64 as root optional dependencies; each `22.20.0` tarball integrity is recorded in the root lockfile. The build resolves the current package directly and never uses the script-installing `node` wrapper package. The sidecar build is target-OS specific and runs before Electron packaging. `electron-builder` excludes all raw native Node npm packages from `app.asar` and ships only `node`/`node.exe`, `cline-agent-sidecar.cjs`, the manifest, Bun metafile, CycloneDX SBOM, third-party notices, Node license, Cline license, and Cline attribution as one `extraResource` directory. Application startup invokes the shipped Node runtime with the bundle as its only argument and verifies the expected protocol and SDK versions.

Cline is Apache-2.0, Copyright 2026 Cline Bot Inc. The packaged application includes the upstream license and an attribution file because the npm tarballs do not consistently include the repository root license. Cline names and assets are not used as aiopsterm product branding.

The official SDK exposes `ClineCore` only through the root `@cline/sdk`/`@cline/core` entry, whose prebuilt provider registry imports providers aiopsterm does not expose. The sidecar bundler replaces the unused Claude Code and SAP AI Core provider modules at resolution time. This excludes `ai-sdk-provider-claude-code`, `@anthropic-ai/claude-agent-sdk`, `@jerome-benoit/sap-ai-provider`, `@sap-ai-sdk/*`, and `@sap/*` implementation code without copying or modifying Cline source. The normal Anthropic API provider remains enabled; only the separate Claude Code provider is excluded.

Every build derives its dependency inventory from Bun's metafile. It fails if a restricted package, restricted implementation marker, `external-reference/` path, unknown license, non-allowlisted license, or missing license evidence appears. The generated SBOM enumerates every bundled JavaScript package and the shipped Node runtime; `THIRD-PARTY-NOTICES.txt` includes component-to-license evidence, and `NODE-LICENSE` carries Node's complete upstream third-party notices. The runtime audit independently recomputes this boundary, checks Linux dynamic links for unresolved or OpenSSL 1.1 dependencies, and initializes OpenAI Compatible, OpenAI Native, Anthropic API, DeepSeek, Ollama, LM Studio, LiteLLM, and Bedrock sessions without making provider requests. A deterministic proxied OpenAI-compatible SSE exchange additionally returns three tool calls in one model response and proves `approval(A) -> tool(A) -> rejected-result(B) -> approval(C) -> tool(C) -> model -> final`, including protocol-complete results for the rejected call.

Every SDK upgrade must re-run Agent loop, native tool calling, approval, rejection, abort, restore, compaction, provider, cross-platform packaging, package-size, dependency-license, and telemetry/network audits.

## Deployment Status

Classic host mode and DB AI use ClineCore directly when a configured provider is available. There is no runtime feature switch or legacy-loop rollback path in the current implementation, and a started turn never falls through to the old XML/text parser. Renderer-owned Agent continuation has been removed. Release readiness is established by the sidecar loop smoke, package/SBOM/license audits, Electron build, and native platform package verification; `external-reference/` remains reference-only and is excluded from imports and packages.
