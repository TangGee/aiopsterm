# Database Workspace

The Database workspace manages saved connections, schema browsing, table data, and SQL consoles through backend-owned runtimes.

- Connection test, save, connect, disconnect, refresh, group, and delete actions use structured backend result envelopes. Renderer state should not mark a connection as ready unless the backend result is successful.
- The SQL editor loads Monaco on demand when the SQL workspace is opened, instead of adding the editor runtime to app startup.
- SQLite user SQL runs in a worker thread so long synchronous SQLite statements do not block the Electron main process event loop.
- SQLite reader results are capped at 5000 rows. When more rows exist, the execute result sets `truncated: true`, the execution message reads `Execution OK (first N rows, result truncated)`, and the renderer result payload carries the `truncated` flag; treat the returned rows as a bounded preview and narrow the query or use an export/offload path for full result sets.
- SQLite write statements return the changed row count and still record execution metadata in the shared SQL execution history shape.

Large Database result sets should stay bounded at the backend contract. Do not raise renderer payload limits to browse full tables; use paged table views, filters, or explicit export flows.
