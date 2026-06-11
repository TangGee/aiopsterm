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

Command execution still follows the terminal security policy from Settings -> AI Preferences -> Security Configuration. Commands blocked by policy stay blocked, commands requiring confirmation show the approval bar, and successful writes are accepted only after the terminal bridge confirms the exact backend session and byte count. Terminal output is rendered only from backend `terminal:data` events.

Chat history and Markdown export preserve `commandExecution`, so restored or exported conversations keep the original command-tool metadata.
