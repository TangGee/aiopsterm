# IM Gateway Settings

Use Feishu, Telegram or Baidu Infoflow to select an aiopsterm terminal, open a new local or SSH terminal, and exchange input and output through chat. Open **Settings > IM Gateway**; the question-mark button opens this page. Keep the desktop app running.

## Choose a platform

Only one platform and bot can be active. Changing platform clears unsaved bot credentials and user/group identities; saving stops the old channel. Existing Feishu configurations remain compatible. Full provider instructions are in the [platform guide (Chinese)](../../im-platforms.md).

For Telegram, create a bot with [BotFather](https://t.me/BotFather). Enter the numeric token prefix as Bot ID and the full token in Bot Token. Obtain your numeric `message.from.id` and group `message.chat.id` from your own Bot API event diagnostics before enabling the gateway. Fill the allowlists and terminal scope, then save. Only one long-poll consumer may use a bot; an existing webhook is reported as a conflict and is never deleted automatically. In groups, use `/sessions@bot_username` or `@bot_username pwd`. Topic messages, channels, anonymous senders and bot messages are excluded. Selection uses inline buttons; redraws edit one message; screenshots are sent as PNG documents. Network access to `api.telegram.org` is required.

For Baidu Infoflow, create a bot in the enterprise console. Enter its numeric Agent ID, App Key and App Secret; App Key is the SDK authentication `appId`, not Agent ID. Enable the message receiver and choose persistent-connection callbacks as described in the [Baidu guide](https://aca.bce.baidu.com/doc/Dumate/s/Jmr0c3qns). Follow tenant requirements for publication and user access. Allowlist event `FromUserId`/`message.header.fromuserid` and `groupid`. Use the client mention picker in groups. `/sessions` and `/new` return `/select <token>` commands: send the desired command to choose, mentioning the bot in groups. Tokens are scoped to the requesting user/chat and expire after ten minutes. Animated TUI output is sent after four quiet seconds; use `/read` or `/screenshot` during continuous animation. Images must be smaller than 1 MiB. Group images use raw Base64 as specified by the public bot API; actual permissions and delivery still require a real enterprise bot. Group sends currently retain a conservative 3.1-second interval for compatibility. OpenHub documents 10 QPS per new bot; the old 20-per-minute rule applies only to legacy custom bots. Infoflow supports button-triggered card refresh, but aiopsterm has not implemented it; an unsolicited card-update API is still unconfirmed. See the [protocol boundaries (Chinese)](../../../technical/im-gateway.md#如流-openhub-接口边界).

Secrets remain encrypted in the OS credential store. Automated protocol tests do not replace live bot permission and delivery checks. The following platform permissions and callbacks apply specifically to Feishu.

## Setup and authorization

For the complete creation, connection, publishing, and verification sequence, see the [setup guide (Chinese)](../../im-gateway.md#配置飞书). Use an enterprise custom app bot, not a group Webhook bot. Create an enterprise custom app in Feishu, enable its bot capability, and grant `im:message.p2p_msg:readonly` and `im:message:send_as_bot`. Screenshots also require the application permission `im:resource` (retrieve and upload image or file resources). If the console offers `im:resource:upload`, the upload-only permission is sufficient. Permissions marked as enabled and exempt from approval may take effect immediately; verify an actual upload and publish only when the console requires it. Subscribe to `im.message.receive_v1` events and `card.action.trigger` callbacks using persistent connections. Group use also requires the applicable mention-message permission. Enter credentials in aiopsterm, connect, save both subscriptions in Feishu, and publish the app configuration.

| Setting | Purpose |
| --- | --- |
| App ID / App Secret | Credentials for the Feishu app; leave an already saved secret blank to retain it |
| Authorized user open_ids | Users allowed to control terminals; enter at least one ID belonging to this app |
| Authorized group chat_ids | Leave empty for direct messages only; groups also require an authorized user to mention this bot |
| all mode | Allows local terminals and all saved SSH hosts, including hosts added later; user and group allowlists still apply |
| Asset IDs / Allow local terminals | When all is off, authorize specific saved hosts and local terminals separately; hosts do not need to be connected first |

Use **Save and apply**, then check that the status is **Connected**. Saved settings apply immediately. For Feishu permission or callback changes, follow the console requirements for activation or publication. After upgrading aiopsterm, launch the new version. After restarting, send `/sessions` and select a terminal again; previous cards are no longer valid.

## Start a terminal conversation

1. Send `/sessions` in a direct message to the bot and choose a terminal by name. No sessionId copying is needed; the card supports pagination.
2. Choose **New terminal**, or send `/new`, to select a local terminal or an authorized saved SSH host. A new desktop tab is created and bound after it connects.
3. Send ordinary text such as `pwd`. It is entered in the bound terminal with Return, and output is forwarded automatically. If Codex is already running there, your text goes to Codex.
4. To switch terminals, choose another through `/sessions` or use `/bind <sessionId>`. A successful switch stops forwarding the previous terminal's output without requiring `/unbind`. A failed switch retains the previous binding; the old terminal keeps running.

`/binding` (or `/status`) shows the bound terminal, host, and connection state. Three-key combinations include `/key ctrl shift c`, `/key ctrl alt c`, and `/key ctrl shift up`; plus separators such as `ctrl+shift+c` also work. Keys go to the terminal program, not desktop shortcuts such as Copy. Extended combinations require support from the receiving program.

`/key ctrl c` or `/interrupt` sends Ctrl+C; `/key esc` sends Escape; `/key enter`, `/key tab`, and `/key up` send the named key without appending another Return; `/send <text>` types without Return; `/unbind` ends the binding without closing the terminal. Non-gateway slash commands such as `/model` are forwarded intact to the bound terminal and submitted automatically. Use `/run /help` when the terminal command has the same name as a gateway command.

A disconnected, closed, or replaced terminal produces one notification. Subsequent messages receive an explicit unavailable-binding reply; choose a terminal again. Previous input is never automatically retried.

Handle SSH passwords, MFA, and connection failures on the desktop; the new tab is retained. Ordinary output is batched. TUI programs such as Codex update one output card at most once every three seconds, so animation does not create repeated messages. After a new interaction such as input, help, a key command or a binding change, any acknowledgement is delivered first, followed by the latest screen in a new card at the bottom of the chat, even if the screen is unchanged. Cards retain the latest screen, not a complete transcript. See the [detailed gateway reference (Chinese)](../../im-gateway.md) for limits, credential handling, and troubleshooting. If cards arrive but buttons do not work, check that the persistent `card.action.trigger` callback was saved and published, then request a fresh card.

## Key reference and screenshots

`/help` lists commands and key mappings; `/keymap` or `/help key` shows the complete key reference in plain-text groups with one command per line, even before binding. Arguments such as `/keymap ctrl c` still return the full reference and never send terminal input. Supported names include `esc`/`escape`, `enter`/`return`/`cr`, `tab`, `space`, `backspace`/`bs`, `delete`/`del`, `insert`/`ins`, `up`/`arrowup` (also down/left/right), `home`, `end`, `pageup`/`pgup`, `pagedown`/`pgdn`, and `f1` through `f12`. A single character such as `/key y` is also supported.

Combine `ctrl` (aliases `control`, `c`), `alt`, and `shift` using spaces, plus signs or hyphens, in any order or case. Examples: `/key ctrl c`, `/key shift tab`, `/key ctrl shift c`, `/key ctrl alt c`, `/key ctrl shift up`. Send one key per message; repeated modifiers, unknown names and key sequences are rejected. Extended combinations depend on the terminal program's keyboard protocol and do not trigger desktop shortcuts.

`/screenshot` sends a PNG of the bound terminal's current output screen, including text colors and menu selections. Background tabs work without changing desktop focus. This renders terminal cells rather than recording the desktop, so no OS screen-recording permission is needed. User, chat and terminal authorization still apply; the image is uploaded to Feishu and sent to this conversation. The bot needs access to the image upload API. Upload failures produce a text reply suggesting `/read`. Images exclude the mouse, blinking cursor and app chrome; font rendering may differ slightly. Images are limited to 4096 pixels per dimension and are not saved locally.

If these commands are unknown, launch the updated aiopsterm build and rebind with `/sessions`. Republishing the Feishu app alone does not update local code. Finish active terminal tasks before exiting the old app.
