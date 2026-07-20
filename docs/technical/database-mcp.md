# Database MCP

aiopsterm provides a first-party, read-only database MCP capability. Its tool layout follows common database MCP patterns, including ideas used by DBHub, but aiopsterm does not import or run DBHub and does not copy its database connection layer.

The implementation keeps database ownership inside aiopsterm:

```text
DB AI or external MCP stdio client
                 |
        Database MCP tool runtime
                 |
 internal saved connection id
                 |
 database drivers / SSL / SSH proxy / encrypted credentials
```

The MCP helper never receives a database password, DSN, host, username, URL, file path, proxy configuration, or saved connection id. It forwards a tool name and arguments through the existing token-authenticated local Export MCP socket. The Electron main process resolves a process-scoped random connection handle and calls the existing database backend.

## Read-Only Tools

The runtime exposes twelve read-only tools. The original generic tools remain available, while the narrower catalog, sampling, and count tools give Agents simpler contracts for common database work:

| Tool | Behavior |
| --- | --- |
| `list_database_connections` | Returns a redacted projection containing a process-scoped random handle, generated label, engine, environment, status, readonly flag, and catalog count. |
| `list_databases` | Lists bounded database/catalog summaries on one connection. |
| `list_schemas` | Lists bounded schema summaries in one exact database. |
| `list_tables` | Lists bounded table/view summaries in one exact database and optional schema. |
| `search_database_objects` | Searches current catalog metadata for table, view, function, and procedure objects. |
| `describe_database_table` | Returns current catalog column types, nullability, keys, and primary-key columns for one table or view. |
| `get_database_table_ddl` | Reads bounded DDL for one catalog-known table or view through an open saved connection. |
| `query_database_table` | Reads bounded scalar columns from a base table through structured parameterized filters and a catalog-validated sort. |
| `sample_rows` | Reads at most 20 rows through the same strict base-table query boundary. |
| `count_rows` | Returns an exact count through the structured table-query adapter and optional structured filters. |
| `inspect_indexes` | Returns bounded structured index metadata only when the engine supplies a safe index adapter. |
| `explain_plan` | Explains a structured table query only when the engine supplies a safe explain adapter; it never accepts SQL text. |

`execute_sql`, DDL mutation, and row mutation are deliberately absent. The existing general SQL executor is not a read-only security boundary and must not be exposed under a read-only MCP annotation.

## Limits And Validation

- `query_database_table` accepts at most 10 filters, 50 values in an `in` filter, 100 rows per page, and page 1000.
- Raw `WHERE`, raw `ORDER BY`, multiple statements, and arbitrary SQL are not accepted.
- Filter and sort column names must exist in the current table catalog before the database backend runs.
- View reads are rejected. A view can invoke volatile or security-definer functions, so a read-looking `SELECT` is not a sufficient cross-engine write-safety boundary.
- MCP data reads set an internal stable-base-table requirement. PostgreSQL/KingBase, MySQL-family engines, Oracle, and SQL Server check and lock the live object on the same driver connection before reading; SQLite checks the schema and reads rows in one worker transaction. This prevents a stale catalog entry from authorizing a view that replaced a table.
- ClickHouse and Presto HTTP connections cannot hold a portable object lock across metadata and data requests. Their strict MCP data query therefore fails closed with `DB_TABLE_QUERY_UNSUPPORTED`; catalog search, describe, and redacted DDL tools remain available. Normal Database workspace browsing keeps its existing non-MCP behavior.
- Application-side validation is not a substitute for database least privilege. Connections exported to an Agent should use a database account whose server-side grants are read-only.
- Callers may request up to 50 bounded scalar columns. Without an explicit projection, MCP selects only catalog types with a declared size or an intrinsically bounded scalar representation. LOB, `TEXT`, unbounded string, JSON, XML, binary-large-object, and collection columns are omitted; explicitly requesting one is rejected.
- The runtime projects returned row objects and reapplies the requested page-size limit a second time. An adapter cannot add an unrequested column or extra row to the MCP response even if a driver returns more data than requested.
- `sample_rows` is capped at 20 rows and always uses page 1. `count_rows` requests an exact `withTotal` count and may therefore perform a full-table or full-filter scan; it shares the 30-second deadline and concurrency limit. A missing or non-safe integer total fails with `DB_MCP_COUNT_UNSUPPORTED`.
- `inspect_indexes` and `explain_plan` are capability-gated. An engine without a structured adapter returns `DB_MCP_INDEX_INSPECTION_UNSUPPORTED` or `DB_MCP_EXPLAIN_UNSUPPORTED`; neither tool parses arbitrary SQL, calls the general SQL executor, or fabricates metadata from DDL text.
- The serialized row payload is capped at 512 KiB. Strings, arrays, and nested objects are bounded; bigint values become strings and binary values become byte-length descriptors.
- DDL output is capped at 256 KiB. Comments, string literals, dollar-quoted or Oracle q-quoted bodies, definers, credential-like settings, and known connection endpoint values are redacted before the DDL leaves the runtime.
- At most four caller-visible database read leases can be active. Each call has a 30-second response deadline, and all four data adapters (DDL, structured query, index inspection, and structured explain) receive the active `AbortSignal`. Cancellation or timeout releases the caller-visible lease immediately, and a late adapter result can never overwrite the cancelled result.
- Abortable SQLite MCP reads run in a dedicated Node-compatible child process instead of the shared SQLite worker. Cancellation sends an OS-level kill signal and the adapter Promise does not settle until that process exits, so native `better-sqlite3` work, including CPU-bound queries and lock waits, is physically stopped. The shared worker continues to serve ordinary Database workspace reads and writes and is not terminated by an MCP cancellation.
- The current relational and HTTP adapters do not claim portable physical cancellation. Their cancelled result is isolated while the underlying driver Promise finishes. A separate hard limit of eight physical reads prevents an adapter that ignores cancellation from creating unbounded orphan work; at that limit new reads fail closed with `DB_MCP_READ_CHANNEL_ISOLATED`, and capacity recovers only when an underlying operation actually settles.
- Non-SQLite DDL and data reads require the connection to be open in aiopsterm. This provides a visible user-consent step and ensures the current process has a verified connection. SQLite uses its local file connection directly.
- Catalog search and table description use aiopsterm's current catalog snapshot. Refresh the connection in the Database workspace when server metadata has changed.
- Presto pagination accepts `nextUri` only from the configured endpoint origin before reusing authorization headers. Statement and next-page HTTP requests use manual redirect handling, and every 3xx response is rejected instead of forwarding headers to a redirect target.

## DB AI Context

DB AI and MCP share the same live connection catalog. DB AI no longer reads seed-table metadata for real saved connection ids. Its Cline profile can call eleven database/catalog tools during the Agent loop; only `list_database_connections` is omitted because Main already owns the session connection binding.

The DB AI tool schemas omit `connectionId`, `databaseName`, and `schemaName`. Electron Main injects the authoritative connection/database and, when present, schema from the Product Session binding, rejects conflicting values before dispatch, and overwrites tool arguments with that scope. The model can select a table and structured filters within the scope, but it cannot switch connection, database, or schema. Every DB AI read-only tool is auto-approved; calls still execute sequentially through the Cline loop and receive the active turn's `AbortSignal`. Expected MCP capability failures remain structured `{ ok: false, errorCode, errorMessage }` tool results so the Agent can adapt; cancellation and unknown-tool protocol errors still abort the callback.

Before a turn, DB AI may preload the same internal read-only tool runtime using the backend-owned current `connectionId`, database, schema, and table:

- Database-level conversations receive bounded table/view search context.
- A selected table receives `describe_database_table` context.
- When a New SQL tab has no selected table, DB AI extracts ordinary `FROM` and `JOIN` references from the active/source SQL and accepts a candidate only after it matches the current catalog.
- Explain, Optimize, and Diagnose actions also attempt `get_database_table_ddl` so the model can see available DDL and indexes represented there.

Preloading is best effort. During the Cline turn, every tool call is independently validated against the same bound connection/database/schema and the catalog-aware structured query rules. A DDL permission or connection failure is returned as a tool error rather than widening scope or falling back to arbitrary SQL. Catalog names, identifiers, column metadata, redacted DDL, and rows are untrusted database-controlled data. They are carried as delimited context or tool results, never appended to the system authority, and the system prompt tells the model not to follow instructions found inside that data.

SQL diagnosis keeps the original driver error available to the local Database UI, but the provider-bound copy is independently capped and redacted. Saved connection ids, names, hosts, ports, users, URLs, file paths, matching SSH proxy details, credential-shaped key/value pairs, and IP literals are removed before the error becomes a model-provider user message.

## External Export

The `aiopsterm_databases` stdio server publishes only database tools. It uses the same packaged helper, Export MCP socket, and token as `aiopsterm_hosts` and `aiopsterm_ai_sessions`, but starts with `AIOPSTERM_EXTERNAL_CODEX_MCP_SCOPE=databases`; the helper does not publish host or managed-AI tools in that process.

External database reads require both:

1. The Export MCP bridge enabled at startup.
2. `Settings -> Export MCP -> Allow external Agents to read databases` enabled.

`UserConfig.exportMcp.allowDatabaseRead` defaults to `false`. Database tools remain visible within `aiopsterm_databases` during MCP discovery so clients can keep a stable cached list, but calls fail closed with `DB_MCP_DATABASE_READ_DISABLED` until the setting is enabled. Agents that do not install this server receive no database tool schemas. A missing or unreadable config also fails closed.

The Export MCP token authorizes the local Agent process, while the database-read switch authorizes this capability. Only provide the token and enable database reads for a trusted local Agent, because table data returned by an approved query is intentionally visible to that Agent.

Connection handles remain stable only for the current aiopsterm main-process runtime and are regenerated after restart. External callers should discover a handle with `list_database_connections` instead of persisting it. User-defined connection names and raw saved ids are not exported; the returned label is generated from controlled engine and environment values.

## Future Write Support

Write support requires a separate design. It must use distinct plan/apply tools, per-operation approval rather than tool-name-wide auto approval, connection-level permissions, database-native least-privilege roles, transactions, timeouts, audit records, and a short-lived approval token. It must not be added by widening `query_database_table` or exposing the current general SQL executor.
