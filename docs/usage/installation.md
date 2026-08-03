# Installation

aiopsterm desktop packages are intended to run without a user-installed Node.js or npm runtime. The Electron runtime, compiled application files, production dependencies, native terminal module, and bundled Codex runtime are packaged with the application.

## Runtime Dependencies

| Scenario | Requires user-installed Node.js |
| --- | --- |
| Launching the installed aiopsterm desktop application | No |
| Local terminal, SSH terminal, embedded Codex panel, and normal UI workflows | No |
| Developing, testing, or building packages from this repository | Yes |
| Exporting MCP to external agents through the packaged JavaScript helper | No |
| Installing Agent Hook integrations through the packaged JavaScript helper | No |
| Running `aio` from an aiopsterm local shell | No |

The external MCP export helper and Agent Hook helper are invoked through aiopsterm's packaged Electron/Node runtime:

```bash
ELECTRON_RUN_AS_NODE=1 <aiopsterm-executable> <helper.js>
```

Local terminals created by aiopsterm expose `aio`, `aictl`, `aiopsterm-control`, `aiopen`, `aiossh`, `aioic`, and `aiobc` on PATH. `aio` is the preferred short command for the control helper. `aiopen <path>...` opens existing local text files in the main workspace editor, resolving relative paths from the command's current directory. `aiossh <managed-host>` is the short SSH entry for hosts already saved in aiopsterm. `aioic` runs configured idle-panel cleanup, while `aiobc` immediately closes background panels and preserves the current panel. These shims internally use aiopsterm's packaged runtime instead of relying on a system `node` binary.

Development and package-build dependencies are documented separately in [Development Commands](development-commands.md) and [Package Verification](package-verification.md).
