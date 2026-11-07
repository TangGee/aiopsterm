# IM Gateway Settings

Use Feishu to select an aiopsterm terminal, open a new local or SSH terminal, and exchange input and output through chat. Open **Settings > IM Gateway**; the question-mark button opens this page. Keep the desktop app running.

## Setup and authorization

Create an enterprise custom app in Feishu, enable its bot capability, and grant `im:message.p2p_msg:readonly` and `im:message:send_as_bot`. Subscribe to `im.message.receive_v1` events and `card.action.trigger` callbacks using persistent connections. Group use also requires the applicable mention-message permission. Enter credentials in aiopsterm, connect, save both subscriptions in Feishu, and publish the app configuration.

| Setting | Purpose |
| --- | --- |
| App ID / App Secret | Credentials for the Feishu app; leave an already saved secret blank to retain it |
| Authorized user open_ids | Users allowed to control terminals; enter at least one ID belonging to this app |
| Authorized group chat_ids | Leave empty for direct messages only; groups also require an authorized user to mention this bot |
| all mode | Allows local terminals and all saved SSH hosts, including hosts added later; user and group allowlists still apply |
| Asset IDs / Allow local terminals | When all is off, authorize specific saved hosts and local terminals separately; hosts do not need to be connected first |

Use **Save and apply**, then check that the status is **Connected**. Saved settings apply immediately. Feishu permission or callback changes also need publication in its developer console. After upgrading aiopsterm, launch the new version. After restarting, send `/sessions` and select a terminal again; previous cards are no longer valid.

## Start a terminal conversation

1. Send `/sessions` in a direct message to the bot and choose a terminal by name. No sessionId copying is needed; the card supports pagination.
2. Choose **New terminal**, or send `/new`, to select a local terminal or an authorized saved SSH host. A new desktop tab is created and bound after it connects.
3. Send ordinary text such as `pwd`. It is entered in the bound terminal with Return, and output is forwarded automatically. If Codex is already running there, your text goes to Codex.
4. To switch terminals, choose another through `/sessions` or use `/bind <sessionId>`. A successful switch stops forwarding the previous terminal's output without requiring `/unbind`. A failed switch retains the previous binding; the old terminal keeps running.

`/interrupt` sends Ctrl+C; `/send <text>` types without Return; `/unbind` ends the binding without closing the terminal. Use `/run /model` to send slash commands to a program such as Codex.

Handle SSH passwords, MFA, and connection failures on the desktop; the new tab is retained. Output is batched, and TUI programs forward changes to recent screens. See the [detailed gateway reference (Chinese)](../../im-gateway.md) for limits, credential handling, and troubleshooting. If cards arrive but buttons do not work, check that the persistent `card.action.trigger` callback was saved and published, then request a fresh card.
