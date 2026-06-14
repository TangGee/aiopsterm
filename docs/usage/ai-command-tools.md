# AI Command Tools

Configured chat models can return a External reference-style command tool block:

```xml
<execute_command>
<ip>10.24.8.12</ip>
<command>uptime</command>
<requires_approval>false</requires_approval>
<interactive>false</interactive>
</execute_command>
```

The main process parses this block before the assistant response reaches the renderer. A valid block becomes an assistant message with `ask: "command"` and structured `commandExecution` metadata containing the target IP, command, approval flag, and interactive flag. In Command mode, the backend also accepts one clearly bounded shell command returned as a fenced `bash` / `sh` / `shell` code block, a `Command:` label, or a bare short command response. That fallback is limited to Command mode so normal Chat and Agent explanations stay ordinary transcript text.

The AI panel renders that backend-owned message only as a command card, not as duplicate free-form text. The card has a `Command` header, target host metadata when available, line count, copy action, executable command text, and Reject / Execute controls. Read-only diagnostic commands also show `查询类自动执行`; destructive, write, restart, install, delete, interactive, or uncertain commands stay approval-gated and do not show that read-only shortcut. Copy uses the structured command text instead of the whole assistant message. Execute and read-only auto-execute send the command through the existing terminal command path and require an active backend terminal session; without one, aiopsterm shows the normal terminal-unavailable notice, marks the card as failed, and does not report a fake command result. Successful writes are accepted only after the terminal bridge confirms the exact live session write. Reject persists `action: "rejected"` on the message and disables terminal actions for that card.

In Agent mode, approved backend-owned command cards now continue the External reference-style loop against the active terminal. The renderer snapshots the active terminal output before the write, waits for real backend `terminal:data` output after the write, appends that captured increment as a structured `say: "command_output"` message, and then calls the AI chat backend again with `mode: "agent"`. The next model response may return another `<execute_command>` card or a final answer. If no terminal output is captured within the wait window, the command card fails closed with a no-output status and the Agent loop does not continue; aiopsterm does not fabricate command output.

Assistant transcript text renders as sanitized Markdown. Fenced code blocks are shown as compact code cards with language, line count, horizontal scrolling, and copy controls instead of raw backticks. Structured `say: "command_output"` rows use a dedicated `OUTPUT` block with the original backend-owned terminal/MCP output and a separate copy action, so command results stay visually distinct from ordinary explanations.

The right AI sidebar starts as a real empty chat surface, not with client-fabricated assistant messages or sample workflow cards. New chat conversations persist and restore with an empty message list until the user sends a request. Legacy persisted welcome assistant prompts are stripped by the chat-history backend during non-seed startup, including old welcome rows embedded in otherwise real saved conversations.

The right AI sidebar now keeps a External reference-style open conversation tab strip above the transcript. The tab strip is the set of currently opened AI conversations, not the full history list: the active backend-selected conversation is opened automatically, New Chat keeps the previous tab visible while adding the backend-created empty conversation, and restoring a conversation from History opens it as another tab. Closing a tab only removes it from the visible tab strip and switches to the nearest open conversation; it does not delete the persisted history row. Deleting history remains a separate History menu action backed by `deleteChatConversation()`.

The AI input context row starts empty. The backend may expose suggested/default contexts in the catalog, but the renderer does not auto-select those hosts during startup or panel mount; users add contexts explicitly through `@ 添加上下文`, and every selected context chip has a remove control.

Sent user messages are read-only in the transcript. They can be copied, but clicking them no longer reopens an editable composer or mutates previous user turns.

The AI sidebar has no user-facing task or task-progress concept in Agent or Command mode. Agent responses appear in the chat transcript, and Command execution state is tracked on the generated Command card through rejected, pending, sent, or failed status. Internal request lifecycle rows are not rendered as a right-panel module. Model, context, history, export, and input controls remain functional from the initial empty state.

OpenAI-compatible provider endpoints are called from the main process. Base URLs that already include a version segment such as `/v1` or `/v3` are preserved, and aiopsterm appends only the operation path such as `chat/completions` or `responses`. Add `#` at the end of the Base URL only when the provider needs aiopsterm to skip the automatic `/v1` version prefix; aiopsterm strips the `#` and still appends the selected operation path.

Command execution still follows the terminal security policy from Settings -> AI Preferences -> Security Configuration. Commands blocked by policy stay blocked, commands requiring confirmation show the approval bar, and successful writes are accepted only after the terminal bridge confirms the exact backend session and byte count. Terminal output is rendered only from backend `terminal:data` events.

Chat history and Markdown export preserve `commandExecution` and command-card execution status, so restored or exported conversations keep the original command-tool metadata and the latest visible command-card result.
