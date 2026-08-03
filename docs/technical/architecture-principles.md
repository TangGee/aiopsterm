# Architecture Design Principles

This document defines the architecture rules used when changing aiopsterm. It is the decision guide for keeping the codebase cohesive, loosely coupled, and maintainable.

For migration history and current progress, see [Architecture Modernization Plan](architecture-modernization.md).

## Layer Model

aiopsterm follows a process and domain layered architecture:

```text
src/shared/contracts
        ↓
src/main/backend + src/main/ipc
        ↓
src/preload
        ↓
src/renderer/src/services/*Client
        ↓
renderer stores / controllers / runtimes
        ↓
Vue presentation components
```

Each layer has one primary reason to change:

- `src/shared/contracts`: cross-process DTOs, result envelopes, and event payload types.
- `src/main/backend`: authoritative backend behavior, persistence, OS access, subprocesses, network clients, and credentials.
- `src/main/ipc`: IPC channel registration and dependency adapter wiring.
- `src/preload`: secure `window.aiops` bridge exposure with stable method names.
- `src/renderer/src/services/*Client.ts`: renderer bridge lookup and method binding.
- `src/renderer/src/services/*BackendGuards.ts`: validation of backend payloads crossing into the renderer.
- renderer controllers: domain workflow orchestration and store-facing facades.
- renderer runtimes: focused state machines, pure projection rules, or side-effect workflows.
- Vue components: presentation, local DOM refs, user events, and rendering composition.

## Dependency Rules

- `main` may import from `main` and process-neutral shared contracts/rules.
- `preload` may import from shared contracts and Electron preload APIs only.
- `renderer` may import from `renderer` and shared contracts, but not from `main`, `preload`, Electron, or `external-reference/`.
- `shared/contracts` must stay process-neutral and must not import Electron, Vue, Node-only modules, renderer code, or main-process code.
- Node-only shared runtimes are allowed only when they are consumed by main-process code or tests, not by renderer code.
- Renderer components should use stores, controllers, or domain clients instead of calling `window.aiops` directly.
- `external-reference/` is reference-only. Do not import, copy, build from, or package files from `external-reference/` into aiopsterm.

## Domain Ownership

Code should be organized around product domains such as Terminal, AI, Assets, Files, Knowledge, Database, Kubernetes, Settings, User, Extensions, and Quick Commands.

Each mature domain should own:

- shared contract types in `src/shared/contracts/<domain>.ts`;
- main-process IPC registration in `src/main/ipc/<domain>.ts`;
- main-process backend behavior in a cohesive `src/main/backend/*` runtime or facade;
- renderer bridge access in `src/renderer/src/services/<domain>Client.ts`;
- renderer backend-result validation in a `*BackendGuards.ts` module when payload shape matters;
- renderer workflow state in a controller, store slice, or composable;
- focused component folders once a screen grows beyond simple presentation.

The public facade for a domain may remain stable even if internals are split. Preserving import surfaces is useful when it prevents churn in many callers.

Main-process backend code is physically grouped by domain under `src/main/backend/`:

- `agent/`: Agent Hook installation, Managed AI session state, audit, auto naming, notifications, and event streams.
- `ai/`: AI chat, AI action handling, AI context/catalogs, model provider text/model listing, todos, provider proxy fetch, and voice transcription.
- `app/`: app update, config boundary, privacy runtime, runtime composition, and runtime logging.
- `assets/`: asset store, credentials, import/export, and asset connection behavior.
- `chat/`: chat history, export, local attachments, and image attachment handling.
- `codex/`: Codex CLI config/launching, terminal bridge, and external Codex MCP gateway.
- `control/`: control socket server, renderer mutation routing, terminal tools, notifications, sidebar metadata, system summaries, and agent-facing control operations.
- `database/`: database connections, SQL execution/export, and page comments.
- `extensions/`: extension catalog, package, runtime core, and extension facade behavior.
- `files/`: file browser facade, SFTP connection/operations, path helpers, transfer tasks, session catalog, and local file writes.
- `knowledge/`: Knowledge Base runtime, pasted image handling, and knowledge search settings.
- `kubernetes/`: Kubernetes backend facade and terminal event integration.
- `mcp/`: MCP discovery/calls, normalization, transport, and runtime types.
- `quick-commands/`: quick commands, snippets/macros, and aliases.
- `settings/`: settings config files, preferences, external settings actions, and Skills runtime.
- `ssh/`: SSH agent/auth, proxy, tunnels, terminal sessions, connection pools, runtime config, backend double, relay shell, and SSH types.
- `terminal/`: local terminal sessions, terminal lifecycle helpers, command generation, suggestion runtimes, command history, and ZMODEM.
- `user/`: user account, avatar, and login-code runtimes.

New backend behavior should be added to the owning domain directory. A root-level `src/main/backend/*.ts` file should be introduced only when it is a deliberate cross-domain compatibility facade or composition point.

Renderer service code is physically grouped by domain under `src/renderer/src/services/`:

- `ai/`: AI Panel, AI chat, Codex session, model provider, voice, and Managed AI service runtimes.
- `app/`: app-shell, runtime-log, local-file, clipboard, window-control, theme/background, and control clients.
- `assets/`: Assets workspace, Assets panel, asset guards, and asset clients.
- `common/`: editor, markdown, Monaco, shortcut, and preload bridge helpers shared by multiple domains.
- `database/`: Database workspace, SQL editor/data, grid, catalog, backend guards, and database clients.
- `extensions/`: Extensions, alias, and extension-display controllers/clients.
- `files/`: Files workspace, Files panel, file browser, transfer, and files clients.
- `knowledge/`: Knowledge Base workspace, editor, panel, markdown preview, guards, and clients.
- `kubernetes/`: Kubernetes workspace, cluster, terminal, resource/Agent, proxy, guards, and clients.
- `quick-commands/`: Quick Commands, snippets, macro/snippet panels, guards, and clients.
- `settings/`: Settings workspace, config, MCP, Skills, preferences, SSH, appearance/layout/model settings, and Agent Hook settings.
- `terminal/`: Terminal workspace, terminal panels, terminal execution, command generation, macro, control surface, and ZMODEM.
- `user/`: User account, user panel, guards, and clients.
- `workspace/`: generic workspace panel/tree/tunnel runtimes that are not owned by one product domain.

New renderer services should be added to the owning domain directory. A root-level `src/renderer/src/services/*.ts` file should be introduced only when it is a deliberate cross-domain compatibility facade.

## Single Responsibility

A module has a good single responsibility when it has one main reason to change.

Good examples:

- a client owns bridge method lookup and unavailable-bridge behavior;
- a guard owns validation of one backend result family;
- a runtime owns one state machine or projection rule set;
- a controller composes same-domain workflows and exposes a stable facade;
- a component renders one surface and emits user intent.

Poor examples:

- a Vue component directly calls preload methods, validates backend payloads, mutates domain state, and renders a large template;
- a controller mixes unrelated domains such as Database connection flows and AI session notification mutation;
- a shared contract imports runtime behavior or platform APIs;
- two UI entry points implement separate copies of the same mutation flow.

## State Ownership And Mutation Boundaries

Application state has one owning runtime or controller. Callers express intent through domain actions instead of assigning store fields or exported collections directly.

- `activePanelId` is written only by `workspacePanelNavigationRuntime.ts`. Panel focus, lifecycle restoration, and pointer adoption use its explicit actions.
- Panel collection creation, closing, splitting, ordering, swapping, and restoration are owned by `workspaceTerminalPanelsController.ts`.
- Background control-surface operations use explicit `activation: 'preserve'` options. They must not select a panel temporarily and then restore the old selection.
- Vue components emit user intent through workspace actions. Direct `v-model` bindings to protected workspace fields are not allowed.
- Main-process registries keep mutable `Map` and `Set` instances private. Export owner methods or readonly catalog types instead of writable containers.
- Owner-local variables and collections may be mutated inside their cohesive runtime when they are not exported and do not have multiple independent writers.

The repository audit enforces the protected renderer fields, the single `activePanelId` writer, and exported mutable-container rule. A new protected state field must be added to the audit when it becomes part of a cross-module workflow.

## When To Split

Split a module only when there is a concrete responsibility boundary:

- UI presentation is mixed with backend bridge calls or payload validation.
- Pure projection rules are embedded in side-effect-heavy workflows.
- A controller owns several unrelated state machines.
- The same rule is duplicated across multiple entry points.
- A file imports from too many domains and changes for unrelated reasons.
- Tests for one behavior require constructing unrelated UI or runtime state.
- A renderer component needs direct knowledge of `window.aiops`, IPC envelopes, or backend error formats.

Prefer same-domain splits first. Extract a cohesive runtime, client, guard, or presenter that can be tested directly.

## When Not To Split

Do not split only because a file is long.

Avoid splitting when the current file is:

- a stable facade that protects many callers from import churn;
- a domain composition root that wires focused child runtimes;
- a cohesive state machine for one workflow;
- a compatibility re-export kept intentionally during migration;
- a presentation shell whose size comes from straightforward markup for one surface;
- a type contract that is long because the domain API is large.

Small files are not automatically better. A 5-line facade can be valid if it preserves a stable public boundary; a 30-line runtime can be over-split if it only forwards calls without owning a rule.

## Over-Splitting Signals

Review a split before keeping it if:

- most files only forward arguments to another module;
- understanding one feature requires opening many files with no clear ownership boundary;
- the same change must edit several tiny modules every time;
- types are exported only to compensate for an artificial split;
- tests assert implementation wiring rather than behavior;
- a facade exists only because a previous refactor moved code but no caller needs compatibility.

If these signals appear and compatibility is no longer needed, consolidate the modules.

## Bridge And Trust Boundaries

The preload bridge is a security and compatibility boundary.

- Renderer bridge access should be concentrated in `*Client.ts` modules.
- Backend result envelopes should be validated before renderer state is mutated.
- Missing bridge methods and malformed success payloads should fail closed with explicit notices or error states.
- Main-process code remains the authority for persistence, credentials, subprocesses, filesystem access, SSH, database connections, Kubernetes execution, and package installation.

## Testing Expectations

Architecture changes should have tests at the boundary they modify:

- pure runtimes: focused Vitest coverage;
- clients and guards: malformed, missing-bridge, and success-envelope coverage;
- controllers: workflow coverage without mounting full UI when possible;
- user-visible flow changes: Playwright e2e coverage;
- dependency boundaries: `npm run audit:client-mocks`, typecheck, and import scans.

Full e2e is a release-level regression gate. Focused e2e should be added when a refactor touches a visible user path.

## Decision Checklist

Before changing architecture, answer:

- What responsibility is mixed today?
- What module will own that responsibility after the change?
- Which public facade or user path must stay stable?
- What test proves the behavior did not move incorrectly?
- Does the split reduce coupling, or only reduce line count?
- Does the change avoid importing, copying, building, or packaging from `external-reference/`?

If the answers are weak, stop and leave the current structure intact.
