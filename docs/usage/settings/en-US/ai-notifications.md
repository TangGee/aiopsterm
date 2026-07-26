# AI Notifications

This page controls AI session discovery, notifications, hibernation, external notification protocol alerts, and notification automation entries for local-connection terminals.

For operator workflows, see [AI Assistant And Sessions](../../best-practices/en-US/03-ai-assistant.md). Custom agent and script authors should use the [AI Session, File Change, And Notification Integration Guide](../../../developer/en-US/ai-notification-integration.md).

## Notification Preferences

- Desktop Notifications: Controls system desktop notifications from the external notification protocol and AI session events. In-app notification history, AI Sessions, and event records remain available when this is off.
- Top Bell for Control Notifications: Controls whether unread notifications from the external notification protocol enter the top bell queue. AI session approval, question, and pending-input reminders are always kept.
- Notification Focus: AI session notifications open the left `AI Sessions` panel and select the matching conversation. Generic control notifications still focus the owning terminal panel.
- Notification Sound: New AI pending-input, approval, question, or control notifications can play a sound when they enter the top reminder queue. Built-in choices include a bright chime, a soft ding, and a playful “royal approval voice” preset.
- Custom Sound: The settings page accepts MP3, WAV, OGG, M4A, AAC, FLAC, and WebM files. aiopsterm copies the selected file into `notification-sounds/` under app data and stores the copied path and URL in settings.
- Preview: Use the preview button to confirm the selected preset or custom audio can play.

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
- CLI Helper: `resources/aiopsterm-control.js` is the control protocol helper. aiopsterm local-connection terminals add `aio`, `aictl`, and `aiopsterm-control` to PATH; prefer the short form `aio list-notifications`. These commands use aiopsterm's packaged JavaScript runtime internally and do not require system `node`.
- Control protocol documentation: See [Control Socket](../../../technical/control-socket.md).
