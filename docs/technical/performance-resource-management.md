# Performance And Resource Management

This document captures the current performance guardrails that cut across renderer startup, terminal output, persistence, and large-result handling.

## Renderer Startup

The renderer keeps heavy optional libraries out of the first-screen bundle.

- `electron.vite.config.ts` manually separates large dependency families into chunks for Monaco, Mermaid, Highlight.js, and xterm.
- Monaco-based editors call `loadMonaco()` from `src/renderer/src/services/common/monacoRuntime.ts`. File, Knowledge, SQL, and Settings JSON editors mount a lightweight fallback first and load Monaco plus folding/find/basic-language contributions only when the editor component is opened.
- Knowledge Markdown preview lazy-loads `mermaid` only when the rendered preview contains an unprocessed Mermaid block.
- Markdown code highlighting uses `src/renderer/src/services/common/highlightRuntime.ts`, which registers only the operational language subset used by aiopsterm. Unlabeled code blocks over 500 lines skip automatic language detection and remain plain text instead of blocking the UI thread.
- Classic Chat markdown rendering keeps an LRU cache of rendered markdown parts, currently capped at 512 entries. Long conversations initially mount the newest 80 messages and keep at most 120 live message nodes, shifting the bounded DOM window by 40 with scroll-anchor compensation instead of retaining every off-screen row.

When adding another large renderer-only dependency, prefer a narrow runtime helper with a cached dynamic import. Do not import the dependency from a top-level workspace shell or shared component unless it is needed on first paint.

## Terminal Output Flow

Terminal output has three pressure boundaries:

- Main process data is coalesced before `terminal:data` IPC delivery.
- Threaded terminals write live output directly into the core worker instead of appending every byte through Vue state.
- The core worker reports `consumed` byte counts after parsing a batch; the renderer forwards those counts through `terminal:ack-data`.

The main process tracks unacknowledged UTF-8 bytes per terminal session. When a session reaches the high watermark of 2 MiB, aiopsterm pauses the source PTY or SSH channel. When acknowledgements reduce the backlog to 512 KiB or below, the source resumes. Pausing arms a real 15-second safety timer that force-resumes the source and resets the byte accounting, so acknowledgements lost to a renderer reload or crash cannot freeze the backend session permanently. Bytes are only counted against the backlog when the `terminal:data` IPC delivery actually succeeded; output sent while the target window is destroyed does not accumulate and cannot trigger a pause that no acknowledgement could ever release.

Both sides use allocation-light UTF-8 length calculation on the terminal data string. `TerminalDataEvent.raw` is no longer attached for normal string chunks; it is only attached as a detached `Uint8Array` when the main process forwards binary `Buffer` output for ZMODEM detection. The threaded fast path still checks active ZMODEM state and the `**\x18B` magic before writing bytes to the terminal worker.

Core-worker optimizations are intentionally data-structure level rather than cosmetic:

- pending chunks keep byte lengths alongside strings so batches do not re-encode entire chunks;
- visible row signatures are numeric FNV-derived hashes instead of per-cell string joins;
- search matches are tied to a content epoch, so scroll/cursor-only snapshots do not rescan the full scrollback;
- ASCII single-width cell runs omit per-cell `chars` and `widths` arrays and let render consumers use their width-1 fallback;
- terminal geometry objects are reused when measured values are unchanged, avoiding no-op resize/full-repaint cycles.

Workspace incremental search is debounced at 120 ms because the scan runs in the terminal worker and should not be triggered for every keystroke during fast typing.

## Persistence And Catalogs

Main-process persistence avoids synchronous write storms while keeping explicit flush points.

- Chat history writes are debounced for 400 ms and written asynchronously through an atomic temp-file rename. `flushChatHistoryWrites()` drains the queue for tests and shutdown-sensitive paths. The synchronous fallback flush (process exit, runtime reconfiguration) bumps a persist generation that supersedes queued async snapshots, so a stale snapshot can never overwrite a newer synchronous write, and it also covers async writes that were still in flight when the process exits.
- Managed AI session snapshots are debounced for 400 ms and synchronously flushed during runtime reconfiguration or server close.
- Control-socket durable events append through an asynchronous queue. `flushControlSocketDurableEventLog()` waits for the queue before tests or teardown read the JSONL log.
- Control event replay uses a 4096-frame in-memory ring with batch trimming. The durable `events.jsonl` file rotates at 8 MiB by rewriting the retained replay tail under a half-size budget.
- File transfer status moved from renderer polling to main-process push events. Progress events coalesce per task in 100 ms windows; registered and finished events are sent immediately.
- Extension catalog reads cache local `registry.json` by file signature and store packages by directory file signatures. Cache invalidates on runtime configuration changes or registry writes.

SQLite-backed stores for assets, file sessions, quick commands, aliases, and settings preferences enable `WAL`, `synchronous=NORMAL`, and `busy_timeout=5000`. Quick commands, aliases, and settings preferences also reuse prepared statements; whole-store replacement paths use transactions where the local store API supports them.
These stores are app-state stores, not the user-data SQL workspace path. Keep their records bounded and do not add bulk scan/import behavior on the synchronous store API; move that work behind an async cache or worker boundary before exposing large datasets. Assets are the high-growth exception: the backend keeps a sanitized asset-list snapshot cache, invalidates it on asset/folder/keychain mutations, confirms imports from one duplicate-indexed snapshot instead of rescanning for every row, and uses the store's bulk save path for import batches that can be committed safely in one transaction.

User account password hashing uses asynchronous `crypto.scrypt`. Seed credential hashes are created on first state load instead of during module import, so configuring the backend does not block the main process event loop.

## Large Result Limits

Large outputs should be bounded at the boundary that produces them.

- SQLite work that can touch user data files runs through the SQLite worker boundary: connection probes, saved-connection schema catalogs, table-page queries, table DDL lookup, mutation planning, mutation transactions, and raw SQL execution. Reader results are capped at 5000 rows and return `truncated: true` when more rows exist; the execution message then reads `Execution OK (first N rows, result truncated)` so the SQL editor shows the cap instead of presenting the preview as a complete result. The worker's `busyTimeoutMs` maps to the better-sqlite3 `timeout` option, which is SQLite's lock-wait busy timeout, not a query execution timeout; a long CPU-bound query still occupies the single worker until it finishes.
- Local `kubectl` work runs as an asynchronous subprocess with 15-second connection probes and 30-second command/resource refresh defaults. Command output is capped at 10 MiB and appends a truncation notice when exceeded; parsing still happens after the subprocess returns, so large Kubernetes resource tables should remain bounded at the backend output limit instead of being expanded in renderer state.
- Kubernetes terminal-session output keeps only the newest 1 MiB tail per session.
- External Codex MCP terminal connections no longer keep a full connection-level output string; each pending command owns only its bounded command output.
- The embedded Codex terminal bridge keeps up to 10000 visible lines per session and caps carriage-return-only pending progress text at 64 KiB.

Prefer returning `truncated`, cursor, offset, or tail metadata over silently returning partial data. When a feature needs full export, implement a separate file/offload path instead of raising UI payload limits.

## Verification

Use focused tests for the boundary being changed, then run the relevant broader checks:

```bash
npm run typecheck
npm test
```

Terminal throughput changes still need the stress harness described in [Threaded Terminal Renderer](terminal-renderer-architecture.md). Bundle/startup changes should inspect the generated renderer chunks and verify that Monaco, Mermaid, Highlight.js, or xterm have not moved back into the first-screen index chunk.
