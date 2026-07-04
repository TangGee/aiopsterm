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
| Running `aiopsterm-control.js` manually from an aiopsterm local shell | No |

The external MCP export helper, Agent Hook helper, and manual control CLI are invoked through aiopsterm's packaged Electron/Node runtime:

```bash
ELECTRON_RUN_AS_NODE=1 <aiopsterm-executable> <helper.js>
```

Local terminals created by aiopsterm expose `AIOPSTERM_JS_RUNTIME` and `AIOPSTERM_CONTROL_HELPER_PATH`, so shell scripts can run the control helper without relying on a system `node` binary.

Development and package-build dependencies are documented separately in [Development Commands](development-commands.md) and [Package Verification](package-verification.md).
