# Product Session Registry

aiopsterm separates a product session from the native conversation owned by Cline or Codex. The product row answers which Classic, DB AI, or Codex session is open in the current process, which trusted terminal or database scope belongs to it, and which native session must be resumed. The same SQLite database also owns a paged UI-message projection; that projection is not the canonical model transcript and is never replayed into Cline as context.

## Storage Ownership

| Storage | Owner | Contents |
| --- | --- | --- |
| `<userData>/product-sessions/registry.db` | aiopsterm product shell | Product metadata plus ordered Classic/DB UI projection messages with cursor paging |
| `<userData>/cline-agent/` | Embedded Cline runtime | Canonical Classic/DB messages, tool calls/results, compaction state, and native session index |
| `<userData>/codex-agent/` | Embedded Codex runtime | Codex configuration, native rollouts, and aiopsterm bridge files |
| `<userData>/chat-history.json` | Classic compatibility cache | Legacy catalog and message snapshot used for one-time projection backfill and rollback compatibility |
| `<userData>/database-workspace.json` | Database workspace/cache | Connections, encrypted secrets, workspace state, and bounded current/archived DB AI cache snapshots |

`<userData>` is Electron's `app.getPath('userData')`; a normal Linux development run usually uses `~/.config/aiopsterm`. `AIOPSTERM_USER_DATA_DIR` can override it for an isolated run.

The JSON files remain required as compatibility/workspace caches. `database-workspace.json` is not an AI-only session file; deleting it also removes Database workspace state and saved encrypted connection payloads. UI projection payloads in SQLite may contain the rendered user/assistant message and tool-card state, but never Cline's provider request history, compaction state, secrets, or transcript paths.

## Project And Engine Roots

`projectRoot` is a logical session boundary, not a request to create one physical directory per session. `lastKnownCwd` may move within that root. Project-bound surfaces normalize separators, repeated/trailing separators, lexical `.`/`..` segments, and Windows path casing before deciding whether a cwd remains inside the root.

Engine storage roots are shared across product sessions:

- Cline stores every native session below `<userData>/cline-agent/`; its local shell and filesystem tools are disabled.
- Codex uses `CODEX_HOME=<userData>/codex-agent` and starts its child process there.
- Classic host operations use the turn's validated `targetId -> terminalSessionId` allowlist; Codex uses its separately validated terminal target and real cwd.
- DB AI has no filesystem project root; its stable boundary is `connectionId + databaseName + schemaName`.

This keeps remote host paths out of client-local engine storage while still allowing product-session boundary checks.

## Record Contract

Each `ProductSessionRecord` has:

- a stable `id` and one `surface`: `classic`, `database`, or `codex`
- a conversation title and `isOpen` flag; resource labels remain binding metadata and are not titles
- optional `projectRoot`, `lastKnownCwd`, and local/SSH target for project-bound surfaces such as Codex
- an optional database connection/database/schema binding
- an optional native binding with `engine`, `nativeSessionId`, `profile`, and `scopeKey`
- optional Classic `@context` references; selected host references are its current execution-target set
- `createdAt` and `updatedAt` timestamps

`isOpen` belongs to the current Electron main-process lifetime, not durable restore intent. Constructing the registry in a new app process sets every stored row to `isOpen=false` without changing row timestamps, so a full app restart always has zero open Product Sessions. A renderer reload, renderer recovery, or component remount does not reconstruct the registry; each surface reconciles rows that remain open in that main-process lifetime. A surface marks a closed row open only after a New or Agents restore/focus action succeeds. Closing the final Classic, DB AI, or Codex session is valid and never synthesizes a replacement.

The native `(engine, nativeSessionId)` pair is unique. While bound, one product row has one current native session and a native session belongs to only one product row. Classic Chat, Command, and Agent intentionally share one deterministic Cline session for one Classic product id. A profile-only mode change or a Classic selected-host change reuses that native session; every Classic turn snapshots and validates its own target allowlist. Changing a Codex project/target, DB binding, or `scopeKey` while retaining the same native id fails with `PRODUCT_SESSION_CONTEXT_REBIND_REQUIRED`.

The current SQLite schema version is `4`:

- version 2 adds `is_open`; version-1 rows migrate closed
- version 3 adds `classic_context_json`; version-1/version-2 rows migrate with no saved Classic context
- version 4 adds `product_session_projection_messages`; earlier rows migrate with an empty UI projection and are backfilled from the bounded JSON caches
- unknown or future versions fail before current DDL is applied

## IPC And Catalog Pagination

Electron main owns the SQLite handle. Preload exposes metadata `list`, `get`, `create`, `update`, `close`, and permanent `delete` operations plus typed projection `replace`, `upsert`, atomic `revise`, and cursor-page reads. Projection pages default to 40 and are capped at 200. A page is read newest-first in SQLite but returned in ascending display order with `nextBeforeOrdinal` for the next older page.

`replace` is reserved for initial backfill. Normal streaming and message-state changes use idempotent `upsert`, preserving the original ordinal for an existing message and appending a new ordinal only for a new message id. Explicit Edit/Retry branching uses `revise`: it finds the durable edit-point message, retains every earlier row even when those rows are outside the renderer window, deletes the edit point and every later row, and appends one to ten replacement messages in one SQLite transaction. A missing edit point fails without mutation. The result includes the chronological retained-prefix seed, capped at its latest 200 messages and normally at 2 MiB of JSON payload; the newest prefix message is retained even when it alone exceeds the byte cap. The renderer combines that seed with the replacement messages it submitted. It must also drain or invalidate older queued projection writes before applying a revision so a stale `upsert` cannot recreate the truncated branch.

Projection paging is renderer-only: a normal later turn seeds from the latest restored page plus messages created after it, not from older pages loaded for browsing. An explicit Edit/Retry revision instead rebuilds the native transcript from the durable prefix seed returned by `revise`, never from only the currently mounted UI window. Cline remains the sole model-context owner.

`list` is newest-first, supports surface/open/project/target/database/native-engine filters, and accepts a bounded `limit` plus non-negative `offset`. Agents reads 500 rows per backend request until it receives a short page, deduplicates ids, and then reveals the locally searched result 20 rows at a time. Each row renders the conversation title, then surface plus bound resource summary and time, then cwd or database/schema. Classic summarizes and searches all host references in `classicContext.contexts`; Database labels `connectionId` as a connection rather than pretending that the database name is a host. This removes the former 1000-row catalog ceiling without exposing SQLite to the renderer.

`close` first writes `isOpen=false`, then stops the active native runtime while retaining the registry row, projection, and native history. This prevents a late response from reopening a closed row. A main-owned stop failure rolls the row open. Cline binding failure stops the unindexed runtime; Codex binding failure also clears the PTY's tool target. The Codex renderer waits for product close before stopping its PTY and attempts a compensating reopen if PTY stop fails.

`delete` is permanent and ordered: stop runtime, drain late native cleanup, delete the Cline session or Codex rollout, delete the Classic/DB projection, then delete the unchanged registry row. Concurrent delete calls coalesce. A timestamp/binding conflict or native/projection failure keeps metadata for retry. This is intentionally different from `close`, which preserves history for Agents restore.

## Surface Lifecycles

### Classic

Creating a Classic conversation immediately creates its `chat-history.json` projection and the matching open Product Session. Sending from an empty surface creates exactly one conversation first. The Cline binding is attached only after the first successful Cline-backed turn.

Classic Chat, Command, and Agent derive one `aiopsterm-classic-*` native id directly from the Product Session id. Locale, mode, selected hosts, and tool definitions change the active prompt/profile/policy, not identity. The sidecar signature includes the profile, system prompt, and complete tool definitions; a signature change stops the active instance, reads the same canonical messages, and restarts the same native session with the new default-deny tool policy. The client has no released-session migration protocol or versioned scope suffix.

Classic persists the current ordered `@context` references, including up to five selected hosts, without treating one host or cwd as the Product Session boundary. Changing the selected host set keeps the same Product Session and Cline transcript. At turn start the renderer freezes the selected host refs, reuses matching live terminals, reconnects missing terminals in order, and sends a bounded `hostTargets` allowlist. Every host tool call names exactly one `targetId`; Electron main rejects targets outside that turn's allowlist.

Schema v3 stores those `@context` references in `classic_context_json`. Agents restore loads the transcript, refreshes the context catalog, and resolves host, doc, image, skill, and chat references by stable identity. For a managed host, `assetId` is that stable restore identity; the saved display label and connection endpoint are not identity keys. After resolving the `assetId`, restore takes the host's current display name and endpoint detail from the refreshed catalog, so a Host Management rename appears immediately without rebinding the Product Session. Classic does not read former single-host fields or reinterpret `host + port + username` as a restore key. A row without current host references restores with no selected host; a saved host whose stable resource id no longer exists remains visible as unavailable and must be selected again explicitly. Missing references are excluded from requests. A turn with no selected host remains available for analysis and Q&A with `hostTargets=[]`; if any explicitly selected host cannot be resolved, tool-capable send fails closed and asks for valid hosts instead of silently dropping a target or falling back to the active terminal.

When chat-history IPC is registered, `chat-history.json` is scanned and any projection missing from the registry is indexed as a closed Classic Product Session. Its complete normalized message snapshot is copied into an empty SQLite projection once. `chat-history:list` repeats the same idempotent repair. Backfill may refresh the title of an existing row, but it never changes that row's open state, restores selection/messages, creates a native binding, or starts Cline.

A full app restart opens no Classic tabs. Renderer reloads and AI panel remounts reconcile Classic rows that are still open in the current main-process lifetime; closed sessions are reopened only from Agents. The AI header lists those current-process tabs only. Closing the last tab stops Cline, retains its transcript, and compare-and-set clears `selectedConversationId`. Close/deselect failure validates a compensating reopen. Permanent Agents deletion removes the native session, projection, and product row.

### DB AI

Opening DB AI makes its current conversation id product-backed. Closing the pane closes that Product Session, archives a non-empty projection, and switches to a new closed blank id. Reset and a connection/database/schema change after the session is product-backed or has messages perform the same rotation. An untouched closed blank pane may adopt a context without creating duplicate history.

`database-workspace.json` retains at most 40 archived cache snapshots and 24 messages per snapshot. Every save upserts those messages into the Product Session SQLite projection, so cache rotation no longer permanently removes older UI messages. Cold startup detaches the former current cache into the archive and leaves the pane and every product row closed. Agents is the only restore entry point.

The Product Session database binding is authoritative over both the current and archived JSON cache snapshots. Once a row is bound, a state sync may update its open flag or projection only when `connectionId + databaseName + schemaName` matches exactly; an empty or different cache binding is rejected and cannot clear, replace, or write messages into that session. An unbound row may acquire a binding only while its durable projection is empty.

Restore attempts to reconnect the saved connection and validates database/schema before committing the selected context. A missing or failed connection, missing database, or missing schema opens the session in a disabled read-only state with a visible issue and Retry action; it never silently substitutes a different database. If the bounded projection has been evicted, restore reconstructs the binding from registry metadata, shows an empty transcript plus a projection-missing notice, and can still resume canonical Cline context on the next valid turn. Current close/reopen failure leaves the UI/archive transition retryable. Pane cancellation has a renderer-side time bound: if the cancellation bridge does not answer, close, restore, and deletion cleanup continue with the captured assistant projected as cancelled while the already-issued backend cancellation remains best effort.

Each DB AI product id derives one deterministic `database` Cline id. Response language changes per-turn prompt policy rather than forking native history. Database boundary changes rotate the product id before another turn, and Electron main binds connection/database/schema independently of model input.

Pane messages and structured SQL actions mirrored into that pane use the same explicit product conversation id for both request creation and response generation. Electron main binds provider-backed pane and mirrored-action results to the same deterministic native Cline id, preserving the one-product-to-one-native invariant. A drawer-style request without an explicit conversation id is standalone, uses an isolated `drawer:<requestId>` Cline scope, and cannot acquire a Product Session binding; inline SQL-error diagnosis uses this isolated path.

### Embedded Codex

A new Codex tab begins as an unbound renderer conversation. It is persisted when bound or explicitly restored; it can exist before a native thread. Binding a terminal does not overwrite its title. Empty sessions use `Codex CLI`; after Codex's canonical thread metadata exposes a title or first user message, main updates the row and renderer tab with that bounded conversation title. Renderer target/cwd updates omit title for existing rows. Legacy rows whose old title equals their target label render with the `Codex CLI` fallback plus the target on the binding line. Main publishes a `codex:thread` binding only after the TUI's thread-info points to a non-empty rollout below managed `sessions/` or `archived_sessions/`. Each event carries the expected previous native thread, so stale runtimes cannot move a row back after another resume or switch won. A later valid TUI thread switch updates the row's one current binding and title while retaining current target/cwd metadata.

A stable host change or cwd outside `projectRoot` closes the old runtime and creates a new Product Session. Agents restore first reuses a matching live terminal or attempts to reopen the stored local/SSH target at `lastKnownCwd`. In follow-workspace mode it activates that terminal in the central TerminalWorkspace, then starts `codex resume <threadId>` only after target and project validation. Target recovery failure still opens an error tab with stored metadata, but does not start the TUI or enable host tools.

A full app restart opens no Codex tab. Renderer reloads and AI panel remounts reconstruct tabs for Codex rows that remain open in the current main-process lifetime. Closed rows are restored only from Agents, with a by-id lookup when the row is outside the renderer's newest-40 metadata cache. A definitely missing rollout clears only the still-matching binding and creates a replacement thread in the same product row; registry, binding-race, permission, and ambiguous I/O failures fail closed. Closing the last Codex tab leaves zero tabs, closes the product row, and stops the PTY without deleting the rollout. Failed PTY stop attempts a compensating reopen.

## Restore Flow

Surface mount/reload first reconciles only rows already marked `isOpen=true`; this is current-process UI recovery, not restoration of closed history. Agents is the single cross-surface catalog and restore entry point for `isOpen=false` rows:

1. A row already open in this process receives `focus`; a closed row receives `restore` with its surface and product id.
2. Classic and Codex remain in Agents mode and route to the fixed right AiPanel; Database leaves Agents mode and routes to DatabaseWorkspace/DB AI.
3. The owning surface loads its UI projection or bounded fallback and marks that row open.
4. Classic restores `@context`, reuses or reconnects every valid selected host, and rebuilds the runtime `targetId` map; DB AI reconnects and validates its database binding; Codex resolves/reopens and activates its terminal and project cwd when workspace following is enabled.
5. Missing Classic contexts degrade to unavailable chips and never grant execution access, DB binding failures degrade to read-only with Retry, and Codex terminal failures degrade to an error tab without TUI startup.
6. Cline resumes lazily on the next turn; Codex resumes immediately only when its target and rollout are valid.

The registry does not prove that a transcript exists. Cline reads the deterministic SDK session and canonical messages before using a projection as a one-time seed; storage errors fail closed. Codex preflights the stored rollout and distinguishes definitely absent history from registry/I/O failure.

## Rendering Windows

| Surface | UI restore/render window | Model context owner |
| --- | --- | --- |
| Classic | Load newest 80 projection rows; fetch older rows by cursor on upward scroll; at most 120 live message nodes, sliding by 40 | Cline canonical messages and `basic` compaction |
| DB AI | Load newest 80 projection rows; fetch older rows by cursor on upward scroll; at most 120 live message nodes, sliding by 40; JSON cache remains 24 messages | Cline canonical messages and `basic` compaction |
| Codex | TUI/xterm owns rendering and scrollback | Codex native rollout |

Both surfaces preserve the message that was at the top of the viewport before an older page is prepended and restore its pixel offset after Vue renders. Opening or restoring a session resets the bounded window to the newest page and scrolls to the bottom. Neither UI window is the Cline model-context limit.

## Current Limits

- Existing JSON data can backfill only the messages still present in that cache; rows discarded by an older release cannot be reconstructed retroactively.
- In-memory page accumulation can grow while an operator deliberately scrolls through a very long session, although the mounted DOM remains capped at 120 messages.
- Classic, DB AI, and Codex retain surface-specific projection renderers and restore adapters.

## Verification

```sh
npx vitest run tests/product-session-registry.test.ts tests/product-sessions-ipc.test.ts tests/product-session-binding-lifecycle.test.ts tests/product-session-deletion-lifecycle.test.ts tests/product-session-path-runtime.test.ts tests/classic-product-session-lifecycle.test.ts tests/classic-session-context-runtime.test.ts tests/classic-session-context-integration.test.ts tests/codex-product-session-lifecycle.test.ts
npx vitest run tests/agents-sidebar-product-sessions.test.ts tests/product-session-ui-routing.test.ts tests/ai-panel-product-session-request.test.ts tests/chat-history-ipc.test.ts tests/ai-panel-history-runtime.test.ts tests/workspace-ai-chat-projection-pagination.test.ts tests/database-ai-state-runtime.test.ts tests/database-ai-pane-scroll-runtime.test.ts tests/database-ai-pane-workspace-runtime.test.ts tests/ai-panel-codex-conversation-runtime.test.ts tests/codex-sessions-ipc.test.ts tests/cline-agent-sidecar-runtime.test.ts
npm run typecheck
```

Coverage includes schema-v1/v2/v3 migration to v4, cold-start close normalization, catalog and projection cursor pagination, bounded Classic/DB DOM windows with scroll-anchor preservation, unique native binding, profile-only Classic updates, context rebind rejection, permanent-delete ordering/conflicts, final-tab close, Classic `@context` degradation, DB restore degradation, Codex first-bind ownership, native thread titles, target/rollout recovery, and Agents title/host rendering.
