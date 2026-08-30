# Agent Session Parser Rules

This page documents the parser controls under `Settings -> AI Notifications -> Agent Hook Installer`. The question-mark button in the card header opens this document directly.

Parser rules are UTF-8 JSON files whose root is one parser configuration object. Rules describe an Agent's session-file structure. The generic aiopsterm parser reads JSONL, evaluates JSON Pointer conditions, extracts content and roles, and creates the conversation cards. Rules cannot execute JavaScript, shell commands, SQL, or dynamic modules.

Built-in Agents and imported user rules use the same format, validator, and parser framework. Built-in configuration files live under `src/shared/agentSessionParserConfigs/*.json`. TypeScript only loads and validates configuration, selects user overrides, and executes rules; it does not contain Agent-specific field paths.

## Settings Actions

- Import session parser rule: Override the built-in rule for that Agent. The imported `source` must match the settings row.
- Restore default rule: Remove the user override and use the built-in rule again.
- Add Agent: Import a custom Agent rule. Custom sources are stored as `custom:<name>` and currently support read-only JSONL sessions.
- Replace parser rule: Replace an existing custom Agent rule.
- Delete: Remove custom Agent support and its imported session index without deleting the original session files.

Imported rules are stored under `agent-sessions/parser-rules/` in the application data directory. A complete JSONL record that produces no configured content is displayed as read-only raw JSON.

## Complete Configuration

```json
{
  "schemaVersion": 1,
  "id": "aider",
  "source": "custom:aider",
  "displayName": "Aider",
  "storage": {
    "kind": "jsonl",
    "paths": ["${HOME}/.aider/sessions/**/*.jsonl"],
    "sessionIdPointer": "/session/id",
    "titlePointer": "/session/title",
    "summaryPointer": "/session/summary",
    "cwdPointer": "/session/cwd",
    "timestampPointer": "/timestamp"
  },
  "rules": [
    {
      "id": "chat-message",
      "match": { "/type": ["user", "assistant"] },
      "kind": "message",
      "rolePointer": "/role",
      "contentPointers": ["/content"],
      "editable": false
    }
  ],
  "fallback": "raw-json"
}
```

## Top-Level Fields

- `schemaVersion`: Must be `1`.
- `id`: Lowercase letters, numbers, and hyphens only; maximum 64 characters.
- `source`: Use a built-in source such as `codex`, or `custom:<name>` for a new Agent. A bare custom name is normalized to `custom:<name>`.
- `displayName`: Label shown in Settings and the AI session list.
- `storage`: Session location and metadata pointers.
- `rules`: Ordered extraction rules; maximum 200.
- `fallback`: Must be `raw-json`.

Top-level `script`, `command`, `sql`, and `module` fields are rejected.

## storage Fields

- `kind`: Custom Agents currently require `jsonl`. Built-in definitions can also use `opencode-sqlite` or `events`.
- `paths`: Up to 16 JSONL paths. `~`, `${HOME}`, `*`, `**`, and `?` are supported.
- `sessionIdPointer`: Session id in the first valid JSON object; the file name is used when absent.
- `titlePointer`: Session title in the first valid JSON object; `displayName` is used when absent.
- `summaryPointer`: Optional session summary.
- `cwdPointer`: Optional project directory.
- `timestampPointer`: Optional numeric timestamp or `Date.parse` compatible string; file modification time is used when absent.

JSON Pointer escaping applies: encode `~` as `~0` and `/` as `~1` inside field names.

## rules Fields

- `id`: Rule identifier.
- `match`: Optional conditions. Keys are JSON Pointers; values can be a string, number, boolean, or string array. An array matches any listed value.
- `scopePointer`: Optional scope such as `/payload/content/*`. `*` expands array or object entries.
- `kind`: Message type shown in the UI, such as `message`, `system prompt`, `reasoning`, `tool call`, or `tool result`.
- `role`: Fixed role: `system`, `developer`, `user`, `assistant`, `tool`, or `unknown`.
- `rolePointer`: Reads a role from data. With `scopePointer`, `/` is relative to the current scope and `$` starts at the full JSONL record root.
- `contentPointers`: One to 16 content fields. Strings are shown directly; objects and arrays are formatted as JSON.
- `label`: Fixed secondary label.
- `labelPointer`: Reads a secondary label, commonly a tool name.
- `editable`: Whether the extracted field can be edited. Custom Agents remain source-level read-only.

After a record produces configured content, only the extracted fields are shown. `raw-json` fallback applies only when the complete record produces no content, so rules should cover every message block users need to inspect.

## Scoped Message Example

```json
{
  "id": "response-message",
  "scopePointer": "/payload/content/*",
  "match": { "/type": ["input_text", "output_text"] },
  "kind": "message",
  "rolePointer": "$/payload/role",
  "contentPointers": ["/text"]
}
```

## Codex System Prompt Example

The first Codex system prompt is stored at `session_meta.payload.base_instructions.text`:

```json
{
  "id": "system-prompt",
  "match": { "/type": "session_meta" },
  "kind": "system prompt",
  "role": "system",
  "contentPointers": ["/payload/base_instructions/text"]
}
```

Codex `response_item/message` records use `rolePointer: "$/payload/role"` for `developer`, `user`, and `assistant`. Tool rules use the fixed `tool` role and can read the tool name with `labelPointer: "/payload/name"`.

Importing a rule for a built-in Agent replaces the complete default definition. It does not append one rule. Start a Codex override from `src/shared/agentSessionParserConfigs/codex.json` or this complete default configuration:

```json
{
  "schemaVersion": 1,
  "id": "codex",
  "source": "codex",
  "displayName": "Codex",
  "storage": {
    "kind": "jsonl",
    "paths": ["${HOME}/.codex/sessions/**/*.jsonl"]
  },
  "rules": [
    {
      "id": "system-prompt",
      "match": { "/type": "session_meta" },
      "kind": "system prompt",
      "role": "system",
      "contentPointers": ["/payload/base_instructions/text"]
    },
    {
      "id": "user-event-message",
      "match": { "/type": "event_msg", "/payload/type": "user_message" },
      "kind": "message",
      "role": "user",
      "contentPointers": ["/payload/message"]
    },
    {
      "id": "assistant-event-message",
      "match": { "/type": "event_msg", "/payload/type": ["agent_message", "assistant_message"] },
      "kind": "message",
      "role": "assistant",
      "contentPointers": ["/payload/message"]
    },
    {
      "id": "assistant-event-reasoning",
      "match": { "/type": "event_msg", "/payload/type": "agent_reasoning" },
      "kind": "reasoning",
      "role": "assistant",
      "contentPointers": ["/payload/text"]
    },
    {
      "id": "response-message",
      "scopePointer": "/payload/content/*",
      "match": { "/type": ["input_text", "output_text"] },
      "kind": "message",
      "rolePointer": "$/payload/role",
      "contentPointers": ["/text"]
    },
    {
      "id": "function-call",
      "match": { "/type": "response_item", "/payload/type": "function_call" },
      "kind": "tool call",
      "role": "tool",
      "contentPointers": ["/payload/arguments"],
      "labelPointer": "/payload/name"
    },
    {
      "id": "custom-tool-call",
      "match": { "/type": "response_item", "/payload/type": "custom_tool_call" },
      "kind": "tool call",
      "role": "tool",
      "contentPointers": ["/payload/input"],
      "labelPointer": "/payload/name"
    },
    {
      "id": "function-result",
      "match": { "/type": "response_item", "/payload/type": ["function_call_output", "custom_tool_call_output"] },
      "kind": "tool result",
      "role": "tool",
      "contentPointers": ["/payload/output"]
    },
    {
      "id": "reasoning-summary",
      "scopePointer": "/payload/summary/*",
      "match": { "$/type": "response_item", "$/payload/type": "reasoning" },
      "kind": "reasoning",
      "role": "assistant",
      "contentPointers": ["/text"]
    },
    {
      "id": "reasoning-content",
      "scopePointer": "/payload/content/*",
      "match": { "$/type": "response_item", "$/payload/type": "reasoning" },
      "kind": "reasoning",
      "role": "assistant",
      "contentPointers": ["/text"]
    },
    {
      "id": "web-search",
      "match": { "/type": "response_item", "/payload/type": "web_search_call" },
      "kind": "tool call",
      "role": "tool",
      "contentPointers": ["/payload/query"]
    }
  ],
  "fallback": "raw-json"
}
```

## Authoring And Validation

1. Copy a small real JSONL sample into a test directory instead of editing the only original transcript.
2. Configure `storage.paths` and metadata pointers, then confirm the session appears.
3. Add rules for system, developer, user, assistant, tool, and reasoning records.
4. Import through the matching Agent row to prevent source mismatches.
5. Open session content and verify the role, message type, line number, and JSON Pointer.
6. Re-import after edits and use manual refresh in the content page.

If an expected message is absent, check whether it shares a JSONL line with another matched field. Add the required `scopePointer` and content rule for that message block.
