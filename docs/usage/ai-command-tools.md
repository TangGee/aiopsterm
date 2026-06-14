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

The main process parses this block before the assistant response reaches the renderer. A valid block becomes an assistant message with `ask: "command"` and structured `commandExecution` metadata containing the target IP, command, approval flag, and interactive flag.

The AI panel renders that backend-owned message as a command card. Copy uses the structured command text. Run sends the command through the existing terminal command path and requires an active backend terminal session; without one, aiopsterm shows the normal terminal-unavailable notice and does not report a fake command result.

The right AI sidebar starts as a real empty chat surface, not with client-fabricated assistant messages or sample workflow cards. New chat conversations persist and restore with an empty message list until the user sends a request. Legacy persisted welcome assistant prompts are stripped by the chat-history backend during non-seed startup, including old welcome rows embedded in otherwise real saved conversations.

The Todo/progress strip is hidden until a backend-owned task snapshot or focused task exists. If an AI request cannot reach a configured provider, or the prompt is rejected before generation starts, the backend clears the request Todo snapshot instead of leaving a failed sample Focus Chain in the panel. Model, context, history, export, and input controls remain functional from the initial empty state.

OpenAI-compatible provider endpoints are called from the main process. Base URLs that already include a version segment such as `/v1` or `/v3` are preserved, and aiopsterm appends only the operation path such as `chat/completions` or `responses`.

Command execution still follows the terminal security policy from Settings -> AI Preferences -> Security Configuration. Commands blocked by policy stay blocked, commands requiring confirmation show the approval bar, and successful writes are accepted only after the terminal bridge confirms the exact backend session and byte count. Terminal output is rendered only from backend `terminal:data` events.

Chat history and Markdown export preserve `commandExecution`, so restored or exported conversations keep the original command-tool metadata.
