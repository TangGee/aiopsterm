# AI Notifications

This page controls AI session discovery, notifications, hibernation, external notification protocol alerts, and notification automation entries for local-connection terminals.

## Notification Preferences

- Desktop Notifications: Controls system desktop notifications from the external notification protocol and AI session events. In-app notification history, AI Sessions, and event records remain available when this is off.
- Top Bell for Control Notifications: Controls whether unread notifications from the external notification protocol enter the top bell queue. AI session approval, question, and pending-input reminders are always kept.

## Agent Hook Installer

- Session Management Hook: Writes the aiopsterm Hook Helper into supported agent user-level hook configuration so the `AI Sessions` panel can discover AI sessions launched from aiopsterm local-connection terminals.
- CLI: Shows whether the matching command is visible in the current `PATH`, such as `codex`, `claude`, `cursor-agent`, `gemini`, `copilot`, `grok`, `opencode`, `codebuddy`, `droid`, `qodercli`, `amp`, `pi`, `omp`, `kiro-cli`, or `acli`.
- Hook Config: The installer only inserts aiopsterm-marked commands and preserves other user hooks.
- Scope: The helper reports events only inside aiopsterm local-connection terminals with `AIOPSTERM_MANAGED_TERMINAL=1` and `AIOPSTERM_AGENT_SOCKET_PATH`. External system terminals return empty output and native agent approval remains untouched.

## AI Session Hibernation

- Enable Agent Hibernation: Allows aiopsterm to hibernate eligible background local-connection terminals when too many AI sessions are live. It skips the visible terminal, sessions waiting for input, and sessions without a resume command.
- Idle Time (seconds): A terminal must be inactive for this many seconds before it can become a hibernation candidate. Range: `5` to `604800`.
- Max Live Terminals: Hibernation starts only when the number of live restorable AI terminals exceeds this value. Range: `1` to `256`.
- Confirmation Countdown (seconds): How long the UI keeps the hibernation confirmation window. `0` means eligible background candidates are hibernated immediately. Range: `0` to `3600`.

## Automation Entries

- Control Socket: aiopsterm local-connection terminals receive `AIOPSTERM_CONTROL_SOCKET`. Scripts and CLI helpers use it to call the control protocol for notifications, notification focus, automation requests, and managed AI sessions.
- CLI Helper: `resources/aiopsterm-control.js` is the control protocol helper. aiopsterm local-connection terminals receive `AIOPSTERM_JS_RUNTIME`, `AIOPSTERM_CONTROL_HELPER_PATH`, and `AIOPSTERM_CONTROL_SOCKET`, so scripts can call it with `ELECTRON_RUN_AS_NODE=1 "$AIOPSTERM_JS_RUNTIME" "$AIOPSTERM_CONTROL_HELPER_PATH"` without system `node`.
- Control protocol documentation: See [Control Socket](../../../technical/control-socket.md).
