# Databases, SQL, And DB AI

Use this guide to save database connections, browse objects, execute SQL, and ask AI for help within a fixed database scope.

![Database workspace](../images/database-workspace.png)

**①** is the connection and object tree, **②** manages SQL, data, and result tabs, and **③** is the current database workspace.

## Scenario 1: Connect And Browse

Create a connection in the Database workspace, test it, save it, and connect. Expand database, schema, and table nodes. A normal single-catalog SQLite connection hides the internal `main` level and shows tables directly.

Double-click a table for paged data. Pin result tabs that must remain available for comparison; completed unpinned slots are reused to prevent unbounded tab growth.

## Scenario 2: Execute SQL

Create a New SQL tab:

```sql
select status, count(*) as total
from orders
group by status
order by total desc;
```

Run all recognizes common statement boundaries. Semicolons inside strings, comments, quoted identifiers, and PostgreSQL dollar-quoted bodies do not split a statement. One failed statement does not prevent later statements from producing their own result tabs.

Generated SQL can run directly only when it is read-only and the active tab still matches the captured connection, database, and schema.

## Scenario 3: Explain With DB AI

Select SQL and use Explain or Optimize, or ask DB AI:

```text
Why is this query not using an index? Inspect the table and indexes before proposing a rewrite.
```

The DB AI session is bound to the current connection, database, and schema. It can discover catalog objects, read table descriptions and DDL, sample bounded rows, count, inspect indexes, and request supported explain data. It cannot switch connections through tool arguments or run arbitrary SQL and writes.

A context change rotates to a new DB AI session. Restore fails read-only when the original connection or schema is unavailable instead of substituting another database.

## Scenario 4: Read Through An External Agent

Install `aiopsterm_databases` and enable `Allow external Agents to read databases` under Export MCP. The Agent discovers process-scoped handles and uses catalog, describe, and structured query tools.

The permission is off by default. Credentials and endpoints are never returned, arbitrary SQL is unavailable, and `query_database_table` is restricted to validated base-table projections and filters with at most 100 rows per page. ClickHouse and Presto data queries fail closed while metadata and redacted DDL remain available.

## Common Problems

- Empty catalog after connection: check metadata permissions.
- DB AI cannot send: restore the exact bound connection and schema.
- Generated SQL cannot run: scope changed or SQL is not read-only.
- External reads are disabled: explicitly enable the Export MCP permission.
- Results are truncated: narrow, page, or export the data.
