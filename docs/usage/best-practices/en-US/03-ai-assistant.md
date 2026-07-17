# AI Assistant And Sessions

aiopsterm's AI features come in three layers: the right-side **AI panel** (Codex CLI / Classic chat), **Agents mode** (the Product Session catalog), and the **AI Sessions** module (a managed coding-agent inbox). This guide explains what each is for and the recommended workflow.

## The AI Panel

![AI panel](../images/ai-panel.png)

| # | Element | Description |
| --- | --- | --- |
| ① | Mode switch | Toggle between Codex CLI and Classic conversations |
| ② | Message area | Assistant replies render as sanitized Markdown; code blocks have copy buttons |
| ③ | `@` context | Explicitly add hosts, knowledge documents, or past conversations as context |
| ④ | Composer | `/` mentions quick commands, `@` mentions hosts and documents |
| ⑤ | Model select | Switch the model for this conversation |
| ⑥ | Send | Becomes Stop while a task is starting, awaiting approval, or running |

Classic conversations have three profiles with increasing capability:

| Mode | Capability | Use for |
| --- | --- | --- |
| Chat | Q&A only; never claims to operate a terminal | Questions, explanations |
| Command | Produces **one** command proposal for review; never executes | "Write me a command" |
| Agent | Controlled analysis tools + `run_host_command` with approvals | Multi-step diagnosis, inspections |

Context rules that matter:

- Context starts empty. Hosts must be added explicitly via `@` (up to five `@host` references per turn); the model can only pick a target from that allowlist — it cannot invent an IP or credentials.
- Every command card carries its target host. Execute requires the card's bound backend terminal session; there is no silent fallback to "the active terminal".
- Command-mode proposals are editable before execution. Agent-mode commands awaiting approval are immutable — main executes exactly what it approved.
- Image input: JPEG/PNG/GIF/WebP only, ≤5 MiB each, ≤5 per message; violations are rejected immediately, never silently dropped.

> Security boundary: read-only auto-run (`查询类自动执行` on the card, or `自动执行只读命令` in Settings -> Host Agent) applies only to commands the model declares non-destructive — and the main-process security policy can always override the model. Policy-blocked commands stay blocked.

## Agents Mode: All Product Sessions In One Place

![Agents mode](../images/agents-mode.png)

Enter via the **① Agents icon** at the top of the SideRail (or `Ctrl+E`). The **② search box** filters by title, surface, binding, and project; clicking a **③ session row** restores it into the **④ AI panel**.

![New session menu](../images/agents-new-menu.png)

The **① `+` button** opens the new-session menu **②** with three surfaces:

- **Classic** — host-management AI chat (Chat/Command/Agent).
- **Codex** — a Codex CLI session bound to a terminal and project cwd; restore reuses or reconnects the saved terminal.
- **DB AI** — leaves Agents mode, opens DatabaseWorkspace, and restores the saved connection, database, and schema.

![Restore a session](../images/agents-restore.png)

Click a **① session row** and the full transcript is restored on the right (**②**); continue chatting in the **③ composer**. Restore always lands at the newest message; scrolling up pages in older UI messages without adding them to the model context.

> Best practice: keep one clearly-named session per recurring workflow ("production inspection", "K8s release failures"). Close only removes the UI tab and stops the runtime — the Product Session remains restorable. Delete is permanent. Startup restores nothing automatically; everything comes back through the Agents catalog.

## AI Sessions Module: The Coding-Agent Inbox

![AI Sessions module](../images/ai-sessions-inbox.png)

The **① AI 会话 (AI Sessions)** module is the inbox for managed coding agents (Codex, Claude Code, OpenCode, …) — distinct from the Agents catalog. With Agent Hooks installed (one-click installers per agent in Settings -> AI Notifications), agents running in aiopsterm-created local shells report here live; restorable local history is imported automatically.

Three views:

- **待处理 (Pending)** — sessions waiting for your decision, answer, review, or confirmation. The top-bar bell is the global pending entry: its badge counts sessions needing input, and repeated clicks cycle through them.
- **运行中 (Running)** — active work, grouped by project by default.
- **会话库 (Library)** — all history, groupable by project, by agent type, or flat by last activity.

Everyday actions: double-click a row to locate its terminal (or restore an idle session — aiopsterm opens a local terminal at the saved cwd and writes the resume command through the normal security path). Right-click → `打开会话内容` (Open session content) to browse and even edit local transcripts in the main workspace; saves check the on-disk revision first and create a backup under `agent-sessions/content-backups/`.

> Tip: after editing a transcript, restart that AI conversation — a running agent keeps its old context in memory.

## Rules And Models

- User Rules enabled under Settings -> Host Agent -> Rules are injected into every Classic conversation. They shape style and workflow but cannot override the host allowlist, terminal security policy, or approval requirements.
- Settings -> Models manages built-in and custom models. For OpenAI-compatible endpoints, a Base URL that already contains `/v1` is preserved; append `#` to prevent the automatic `/v1` suffix.
