# Resource, Data, and Platform Plan

This document audits aiopsterm resource, configuration, log, and software data ownership, then defines the platform-readiness plan for macOS and Windows.

It complements [Architecture Design Principles](architecture-principles.md). The goal is not to split code for its own sake. The goal is to keep each resource type owned by one clear runtime boundary, so future macOS and Windows work can be implemented and verified without scattering path, packaging, and persistence rules across the app.

## Scope

This plan covers:

- packaged application resources;
- user-editable configuration files;
- runtime state and software data;
- credentials and encryption keys;
- logs, audit files, and diagnostic data;
- transient IPC sockets and named pipes;
- macOS and Windows packaging/readiness gaps.

`external-reference/` remains reference-only and must not be imported, copied, built from, or packaged into aiopsterm.

## Current Ownership

The current direction is mostly sound. The main process is the authority for persistence, OS paths, credentials, subprocesses, sockets, and packaging resource resolution. The renderer generally receives concrete paths through IPC and clients instead of inventing filesystem paths itself.

The main process also supports `AIOPSTERM_USER_DATA_DIR`, which is useful for tests, smoke runs, and portable diagnostics. In production, runtime data should continue to resolve from `app.getPath('userData')`.

## Platform Support Status

Platform support is not considered complete just because an `electron-builder` target or package script exists. A platform is considered supported only after the platform-specific package is built on the correct runner, installed or launched from the packaged artifact, and passes the runtime and packaging checks listed below.

Current status:

| Platform | Status | Evidence today | Not yet proven |
| --- | --- | --- | --- |
| Linux | Baseline supported path | `build:linux`, `build:linux:appimage`, `build:deb`, `package:build -- linux-appimage`, `package:build -- linux-deb`, `package:verify`, `smoke:packaged`, `test:e2e:packaged`, `audit:linux-appimage`, `audit:linux-deb`, and `audit:linux-package` exist. Linux packaging has package artifact checks for Codex, `node-pty`, icons, deb desktop protocol registration, and artifact shape. | Continue running the full smoke/audit gates for release candidates. |
| macOS | Configured but not supported yet | `electron-builder.yml` has `mac` targets and `package.json` exposes `build:mac`, `build:mac:dir`, and `package:build -- macos`. Codex target path helpers know Darwin triples. `smoke:packaged`, `audit:packaged-app`, and `test:e2e:packaged` infer the macOS unpacked app layout. AI notifications route through Electron native notifications. | A macOS runner must prove build, app launch, packaged resource resolution, native module loading, local terminal, SQLite-backed catalogs, deep links, and signing/notarization policy. |
| Windows | Configured but not supported yet | `electron-builder.yml` has a `win` target, `package.json` exposes `build:win`, `build:win:dir`, and `package:build -- windows`, `build:codex` can invoke Codex's Windows MSVC package builder from the Node entrypoint, Codex package checks handle `codex.exe`, `rg.exe`, `codex-command-runner.exe`, and `codex-windows-sandbox-setup.exe`, renderer local file browsing uses native Windows paths, transient IPC paths use named pipes, and packaged E2E calls the control notification API through the Windows pipe path. AI notifications route through Electron native notifications. | A Windows runner must prove package build, app launch, packaged resource resolution, native module loading, local terminal, SQLite-backed catalogs, named pipes, protocol URL arguments, and installer behavior. |

Do not describe macOS or Windows as supported until the evidence above exists in the repository and has been run on the corresponding platform.

## Resource Taxonomy

| Class | Examples | Current owner | Target policy |
| --- | --- | --- | --- |
| Packaged resources | `resources/icons`, `codex-aiopsterm-mcp.js`, `aiopsterm-agent-hook.js`, `aiopsterm-control.js`, Codex package | `electron-builder.yml`, `scripts/prune-packaged-native-modules.mjs`, Codex runtime path helpers | Read-only after packaging. Access through `process.resourcesPath` or injected app/resource path helpers. |
| User-editable config | `security-config.json`, `keyword-highlight.json`, `setting/mcp_settings.json`, user Skills | `settingsConfigRuntime`, `skillsRuntime` | Store under userData. Renderer displays paths returned from main. File watchers live in main. |
| Runtime state | `database-workspace.json`, `database-comments.json`, `chat-history.json`, `ai-todos.json`, `user-account.json`, Kubernetes catalog, managed AI sessions | Domain backend runtimes configured from `runtimeConfiguration.ts` | Store under userData with domain-owned load/normalize/persist logic. |
| Shared local database | `aiopsterm-state.db` for assets, files catalog, aliases, quick commands | Assets, Files, Alias, Quick Commands runtimes | Keep shared SQLite only for small structured local catalogs. Avoid mixing large blobs or unrelated audit streams into it. |
| Secrets and keys | asset secrets, database credentials, credential key files | `assetsCredentialRuntime`, `databaseCredentialStorage` | Use Electron `safeStorage` when available. Local AES key fallback is device-local and must be documented as non-portable unless exported with explicit tooling. |
| Logs and audit | `logs/aiopsterm-runtime.log`, managed AI audit JSONL, control event JSONL | `runtimeLog`, `agentSessionAuditRuntime`, `controlSocketStateRuntime` | Keep under userData. Add rotation, size caps, and diagnostic export before broad desktop distribution. |
| Transient IPC | control socket, AI agent socket, Codex bridge socket, external Codex MCP socket | socket runtimes in main | Unix socket under userData on Linux/macOS. Windows named pipe under `\\.\pipe\...`. Do not persist these paths as stable config. |
| User content | Knowledge Base files, chat attachments, custom backgrounds | Knowledge/runtime IPC and main path helpers | Store under userData subdirectories. Apply path traversal checks and import limits at main boundary. |

## Current Data Layout

The intended production layout is:

```text
userData/
  aiopsterm-state.db
  aiopsterm-assets-credential.key
  database-credential.key
  aiopsterm-config.json          # electron-store managed
  security-config.json
  keyword-highlight.json
  setting/mcp_settings.json
  database-workspace.json
  database-comments.json
  chat-history.json
  ai-todos.json
  data-sync-runtime.json
  user-account.json
  avatars/
  backgrounds/
  chat-attachments/
  codex-agent/
  control/
  external-codex-mcp/
  agent-sessions/
  extensions/
  knowledgebase/
  kubernetes/
  logs/
  skills/
  ssh-control/
```

The exact `electron-store` filename can vary by Electron Store behavior, but the store name is `aiopsterm-config`.

## What Is Reasonable Today

- Most software data is already rooted at `app.getPath('userData')`.
- `runtimeConfiguration.ts` is a useful composition point for injecting domain paths.
- Settings, Skills, Knowledge Base, Kubernetes, Database, Chat History, AI Todos, Assets, Files, Aliases, and Quick Commands have domain-owned persistence runtimes instead of renderer-side filesystem writes.
- Control socket, Codex bridge, external Codex MCP bridge, and AI agent socket already distinguish Windows named pipes from Unix socket files.
- Local terminal shell defaults, executable lookup, socket path construction, and renderer file-browser path rules are routed through small platform helpers instead of broad compatibility branches.
- File browser paths use native local Windows paths only for local sessions; remote and SFTP paths keep POSIX semantics even when the app runs on Windows.
- Packaged helper scripts are explicit `extraResources`, and `electron-builder.yml` excludes `external-reference/**`.
- The Codex runtime has target triples for Linux, macOS, and Windows. The npm `build:codex` entrypoint is a Node dispatcher: Linux/macOS continue through the existing shell build path, while Windows invokes Codex's Python package builder from Node against the MSVC target and keeps `AIOPSTERM_CODEX_PACKAGE_DIR` / `AIOPSTERM_CODEX_BIN` as cache/custom-package overrides.
- Linux package auditing checks Codex binary presence, node-pty pruning, desktop protocol registration, and artifact shape.
- `audit:packaged-app` provides a cross-platform unpacked-app resource audit for Linux, macOS, and Windows; `audit:linux-package` remains the deeper Linux installer/artifact audit.
- `package:build`, `package:build:matrix`, and `package:verify` split the installable package targets into `linux-appimage`, `linux-deb`, `macos`, and `windows`, and reject attempts to build or verify a target on the wrong host platform.
- `test:e2e:packaged` launches the unpacked packaged app, checks the main window/local terminal/Files module entry points, and verifies packaged control notifications through the platform control socket or Windows named pipe.
- Managed AI and control notifications use Electron's native `Notification` API through a small main-process adapter instead of renderer-side platform branches.

## Gaps Before macOS and Windows

The first platform-governance task is to keep support status explicit. Implementation changes should improve the evidence in the table above rather than merely adding more entry points. Build scripts are useful guardrails, but they do not by themselves prove support.

### Support Completion Definition

Each desktop platform needs the same completion gates:

- Package build command exists and is documented.
- Packaged artifact audit exists and checks the platform's expected unpacked resources, installer/archive artifact names, bundled Codex package, helper resources, and native module shape.
- Packaged smoke launch runs with an isolated `AIOPSTERM_USER_DATA_DIR`.
- Core runtime smoke proves local terminal startup, SQLite catalog open, settings load/save, runtime logging, custom protocol handling, and packaged resource resolution.
- Platform-specific IPC is verified: Unix socket paths on Linux/macOS and named pipes on Windows.
- Native-sensitive dependencies are verified on the platform: `node-pty`, `better-sqlite3`, and `ssh2`.
- Release hardening status is documented: macOS signing/notarization or Windows signing/installer policy.

### Packaging Scripts

`electron-builder.yml` has Linux, macOS, and Windows sections. `package.json` exposes `build:linux:appimage`, `build:linux`, `build:deb`, `build:mac`, `build:mac:dir`, `build:win`, and `build:win:dir`. Target wrappers expose the four installable package outputs through `package:build -- linux-appimage`, `package:build -- linux-deb`, `package:build -- macos`, and `package:build -- windows`. `scripts/audit-package-config.mjs` requires those entries and verifies that each platform package command builds the bundled Codex package before invoking electron-builder.

Remaining direction:

- run `package:build -- linux-appimage`, `package:build -- linux-deb`, and matching `package:verify` gates on Linux for release candidates;
- run `build:win` / `build:win:dir` on Windows and record the result;
- run `build:mac` / `build:mac:dir` on macOS and record the result;
- extend platform-specific audits if installer metadata needs checks beyond the cross-platform unpacked-app audit.

### Native Modules

`node-pty`, `better-sqlite3`, and `ssh2` are native-sensitive dependencies. The current rebuild script pins Electron `31.7.7`, which is good for consistency, but each platform must prove:

- `node-pty` loads and creates a local terminal;
- `better-sqlite3` opens `aiopsterm-state.db`;
- SSH terminal and SFTP flows load `ssh2`;
- packaging does not leave source/test/native build artifacts that are not needed at runtime.

The existing `afterPack` pruning only prunes native module contents for Linux. macOS and Windows should get artifact-specific audits before any pruning rule is generalized.

### macOS Signing and Notarization

The current macOS config has `dmg` and `zip` targets but no explicit signing, hardened runtime, entitlements, or notarization plan.

Required direction:

- define signing identity strategy for development and release;
- define hardened runtime and entitlements needed by terminal PTY, helper scripts, network access, and local file access;
- verify custom protocol registration for `aiopsterm://`;
- verify the packaged Codex binary and helper JS resources resolve from the `.app/Contents/Resources` layout.

### Windows Installer and Protocol Handling

The current Windows config targets NSIS and has script-level build/config coverage, but the Windows installer has not been proven on a Windows runner.

Required direction:

- run package audit for unpacked resources and add NSIS metadata checks after the first Windows package is built;
- verify `aiopsterm://` protocol registration passes URL arguments correctly;
- verify named pipe paths for control, agent session, Codex bridge, and external MCP are discoverable by helper scripts;
- verify default shell selection and terminal PTY behavior with `COMSPEC` and PowerShell;
- verify path display and user-facing defaults do not show Linux-style paths after hydration.

### Log Rotation and Diagnostics

`runtimeLog` writes JSON lines to `logs/aiopsterm-runtime.log` with redaction and field truncation. Managed AI audit and control events also append JSONL files. These are good debugging surfaces, but they currently need operational limits.

Required direction:

- add size-based rotation for runtime logs and JSONL audit streams;
- cap retained files and total retained bytes;
- add a diagnostic bundle command that includes logs, package/runtime metadata, platform, app version, selected config summaries, and excludes secrets by default;
- document which files are safe to share.

### Data Export, Backup, and Migration

Data is split across JSON files, SQLite, directories, and encryption key files. That is acceptable, but platform rollout needs an explicit migration and backup policy.

Required direction:

- introduce a data manifest documenting each file, owner, version, and portability;
- add versioned migration points for JSON state and SQLite schema updates;
- define export/import behavior separately for portable content and device-bound secrets;
- keep generated socket paths, temporary files, and audit logs out of normal backup/export unless the user explicitly requests diagnostics.

### Renderer Default Paths

`workspaceState.ts` initializes some path display refs with Linux-style placeholders such as `~/.config/aiopsterm/...`. Runtime controllers later replace them using paths returned from main when the editor or settings section loads.

This is not a critical data bug, but for macOS/Windows polish the target should be:

- placeholders use neutral text until main returns the real path;
- all user-facing paths are hydrated from main;
- tests verify Windows-style and macOS-style path display does not regress.

## Platform Roadmap

### Phase 0: Governance

- Keep the support status table current.
- Do not claim platform support from target configuration alone.
- Define the acceptance evidence before adding new package scripts or release claims.

### Phase 1: Guardrails

- Run `audit:packaged-app` on macOS before claiming macOS support.
- Run Windows build scripts and package-config audit checks on Windows.
- Run `audit:packaged-app` on Windows and add installer-specific checks if the NSIS artifact needs metadata validation.
- Run packaged smoke tests with `AIOPSTERM_USER_DATA_DIR` in a temp directory on each platform.
- Run `test:e2e:packaged` on each native runner after the package build.
- Keep Linux audit as the baseline reference, but do not make Linux assumptions global.

### Phase 2: Runtime Verification

- Verify native modules on each target platform.
- Verify local terminal, SSH terminal, SQLite-backed catalogs, Codex startup, control socket, and agent socket.
- Verify helper resource resolution from packaged resources.
- Verify custom protocol deep links.

### Phase 3: Data Operations

- Add log rotation.
- Add diagnostic bundle export.
- Add data manifest and migration checklist.
- Define backup/export/import boundaries for Knowledge Base, Skills, settings, catalogs, attachments, backgrounds, and credentials.

### Phase 4: Release Hardening

- Add macOS signing/notarization config.
- Add Windows installer signing plan.
- Add release checklist per platform.
- Document platform-specific troubleshooting under usage docs after implementation.

## Architecture Rules For Future Changes

- Main owns filesystem paths. Renderer may display or request operations on paths, but must not decide production data locations.
- Keep resource access injected through composition points such as `runtimeConfiguration.ts`.
- Keep each domain's data normalization and migration in that domain runtime.
- Do not split a module only because it is large. Split only when ownership, persistence policy, or platform behavior is mixed.
- Do not place user data under packaged resources, app source paths, or current working directory in production code.
- Do not persist PID-specific socket or named pipe paths as user configuration.
- Treat `safeStorage` ciphertext as device/user-bound unless a dedicated export flow says otherwise.
- Keep `external-reference/` excluded from imports, packaging, and build inputs.

## Recommended Next Implementation Order

1. Run macOS and Windows package builds on native runners and record the exact verification evidence.
2. Extend platform-specific package audits for installer metadata that `audit:packaged-app` cannot inspect.
3. Add log rotation for runtime log, managed AI audit, and control event JSONL.
4. Add a data manifest and diagnostic bundle export.
5. Replace renderer Linux-style path placeholders with neutral placeholders hydrated from main.
6. Add macOS signing/notarization and Windows signing/release docs once certificates and release channel decisions are known.

This order improves platform confidence without forcing architectural churn in domains that already have clear ownership.
