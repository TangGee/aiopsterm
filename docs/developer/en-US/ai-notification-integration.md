# Integrate AI Sessions, File Changes, And Notifications

This guide is for developers connecting a custom agent, build script, or automation tool to aiopsterm. A complete integration normally uses three independent but linkable channels:

1. Agent Hooks report lifecycle, tool activity, and requests that need input.
2. The file-change protocol reports project files actually changed by the agent.
3. The Control CLI sends generic user notifications.

Managed AI attention and generic notifications use different stores. To place a session in Pending, send the relevant hook event. `aio notify` alone does not create an AI session.

## Scenario 1: Show A Custom Agent In AI Sessions

Local terminals created by aiopsterm receive:

| Variable | Purpose |
| --- | --- |
| `AIOPSTERM_MANAGED_TERMINAL` | Equals `1` in a managed terminal |
| `AIOPSTERM_AGENT_SOCKET_PATH` | Agent event socket |
| `AIOPSTERM_AGENT_HOOK_PATH` | Bundled hook helper |
| `AIOPSTERM_JS_RUNTIME` | Bundled JavaScript runtime for the helper |
| `AIOPSTERM_TERMINAL_SESSION_ID` | Owning terminal session |
| `AIOPSTERM_PANEL_ID` | Owning panel |
| `AIOPSTERM_SURFACE_ID` | Owning surface |
| `AIOPSTERM_WORKSPACE_ID` | Owning workspace |

`source` is not an arbitrary string. Registered ids currently include `codex`, `claude-code`, `cursor`, `gemini`, `copilot`, `grok`, `opencode`, `codebuddy`, `factory`, `qoder`, `antigravity`, `kiro`, `hermes-agent`, `rovodev`, `amp`, `pi`, and `omp`. The `my-agent` examples below assume that the developer has registered that source; an unregistered name is rejected.

To add an agent source:

1. Add its canonical id to `src/shared/contracts/managedAiSessions.ts`.
2. Register the id, CLI aliases, and file-tracking capability in `src/main/backend/agent/agentIntegrationAdapters.ts`.
3. Add event-normalization and project-file capability tests.
4. Add a Hook installer only for one-click setup, and a local history importer only for offline library discovery. Live notifications do not require an importer.

Have the agent's hook system execute the bundled helper. It reads hook JSON from stdin, adds terminal routing, and posts to the socket:

```sh
ELECTRON_RUN_AS_NODE=1 "$AIOPSTERM_JS_RUNTIME" "$AIOPSTERM_AGENT_HOOK_PATH" \
  --source my-agent \
  --event SessionStart
```

The event must resolve at least these fields:

```json
{
  "source": "my-agent",
  "sessionId": "session-20260726-001",
  "event": "SessionStart",
  "cwd": "/work/service-api",
  "title": "Service API maintenance"
}
```

Compatibility rules:

- Session id may be `sessionId` or `session_id`.
- Event name may be `event`, `hookEventName`, or `hook_event_name`.
- Supported events are `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `AskUserQuestion`, `Notification`, `Stop`, and `SessionEnd`, plus their snake_case forms.
- `panelId`, `terminalSessionId`, `cwd`, `title`, `summary`, `message`, `transcriptPath`, `launchCommand`, `resumeCommand`, and process ids improve focus, display, and restoration.

Recommended lifecycle:

```text
SessionStart
UserPromptSubmit
PreToolUse
PermissionRequest or AskUserQuestion
Stop
SessionEnd
```

`Stop` means that one turn finished and is ready for review; it creates attention. `SessionEnd` means the runtime ended. Do not report every tool completion as `Stop`.

Blocking decisions depend on the agent:

- An agent that supports hook responses can run the helper with `--wait-decision` and accept allow, deny, or reply from AI Sessions.
- Native Codex permission prompts remain owned by the Codex TUI. aiopsterm can record, notify, and focus them, but cannot submit the decision.
- Outside a managed terminal, when the app is unavailable, or after a wait timeout, the helper fails open with empty JSON so the agent's native flow continues.

## Scenario 2: Report Files Changed By The Agent

Only explicit reports enter Recent Changes in the Project Files drawer. aiopsterm does not infer arbitrary filesystem side effects from shell commands.

Protocol version 1:

```json
{
  "protocolVersion": 1,
  "eventId": "tool-call-42-result",
  "source": "my-agent",
  "sessionId": "session-20260726-001",
  "cwd": "/work/service-api",
  "changes": [
    {
      "path": "src/server.ts",
      "kind": "modified"
    },
    {
      "path": "src/old-name.ts",
      "previousPath": "src/legacy-name.ts",
      "kind": "renamed"
    }
  ]
}
```

`kind` must be `created`, `modified`, `deleted`, or `renamed`. A rename requires `previousPath`.

Report from an aiopsterm-managed terminal:

```sh
aio agent file-change record --event-json '{
  "protocolVersion": 1,
  "eventId": "tool-call-42-result",
  "source": "my-agent",
  "sessionId": "session-20260726-001",
  "cwd": "/work/service-api",
  "changes": [
    {
      "path": "src/server.ts",
      "kind": "modified"
    }
  ]
}'
```

Implementation constraints:

- `source` and `sessionId` must identify a managed session bound to an eligible local project.
- Relative paths resolve from `cwd` and must remain under the session's canonical project root.
- The server bounds each batch. Split large results into multiple bounded events.
- The source, session, eventId, kind, and path tuple is deduplicated, so retries should reuse the original `eventId`.
- Escaping paths, renamed entries without `previousPath`, and unsupported protocol versions are rejected.
- `aio agent file-change record` is available only in an aiopsterm-managed terminal.

For an agent with structured file tools, report after the tool succeeds. Do not report a failed call or a proposed edit. Recent Changes should represent facts, not model intent.

## Scenario 3: Send Generic Notifications From Scripts

Build, deployment, and inspection scripts can send:

```sh
aio notify \
  --source ci \
  --level warning \
  --title "Build needs review" \
  --body "npm test failed" \
  --group release \
  --key service-api-main
```

Supported fields:

| Field | CLI | Meaning |
| --- | --- | --- |
| title | `--title` | Display title; a default is used when omitted |
| subtitle | `--subtitle` | Supporting title |
| body | `--body` | Detail |
| source | `--source` | Producer such as ci, deploy, or monitor |
| level | `--level` | `info`, `success`, `warning`, `error`, `approval`, or `done` |
| group | `--group` | Business grouping |
| key | `--key` | Idempotency key |
| action | `--action` | Action semantics |
| url | `--url` | Openable link |
| panel/session | `--panel`, `--session` | Associated terminal surface |

The same `source + group + key` updates one notification and marks it unread again:

```sh
aio notify --source deploy --group api --key release-42 \
  --level info --title "Deploying release 42"

aio notify --source deploy --group api --key release-42 \
  --level done --title "Release 42 completed"
```

Without a key, every call creates a new notification. Generic notifications live in a bounded in-process queue, not a persistent business audit log. Do not rely on them to restore state after app restart.

## Complete Tool Callback Example

This script assumes the agent already created a managed session and calls it after a file tool succeeds:

```sh
#!/usr/bin/env sh
set -eu

event_id="${1:?event id required}"
session_id="${2:?session id required}"
changed_path="${3:?changed path required}"

aio agent file-change record --event-json "{
  \"protocolVersion\": 1,
  \"eventId\": \"$event_id\",
  \"source\": \"my-agent\",
  \"sessionId\": \"$session_id\",
  \"cwd\": \"$PWD\",
  \"changes\": [
    {
      \"path\": \"$changed_path\",
      \"kind\": \"modified\"
    }
  ]
}"

aio notify \
  --source my-agent \
  --level success \
  --title "File update completed" \
  --body "$changed_path" \
  --group "$session_id" \
  --key "$event_id"
```

Production code should use a real JSON serializer for arbitrary paths instead of interpolating untrusted strings.

## Verification Checklist

1. Open a new local terminal in aiopsterm and verify the managed environment variables.
2. Send `SessionStart`; confirm the project and terminal binding under Running.
3. Report one test change and verify its kind and relative path in Recent Changes.
4. Retry the same `eventId` and confirm that it is not duplicated.
5. Try a path outside the project and confirm rejection.
6. Send two states with the same notification key and confirm that one item is updated.
7. Stop aiopsterm and run the hook; confirm the agent itself does not fail.

See [Managed AI Sessions](../../technical/managed-ai-sessions.md), [Control Socket](../../technical/control-socket.md), and the [Control CLI Tutorial](../../usage/control-cli-tutorial.md) for implementation details.
