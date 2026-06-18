# Privacy Settings

This page controls telemetry, secret redaction, data sync status, and account deactivation.

## Telemetry

- Enabled: Allows telemetry used to improve the product experience.
- Disabled: Turns telemetry off.

## Secret Redaction

- Enabled: Redacts common secrets, tokens, and addresses in output and context.
- Disabled: Does not apply this redaction.
- Supported Patterns: Shows supported redaction rules, such as IPv4, AWS Access ID, GitHub Token, and Google API Key.

## Data Sync

- Enabled: Enables data sync runtime status.
- Disabled: Disables data sync.
- Runtime: Current sync runtime, such as local-file.
- Status: Sync state, such as synced or error.
- Last Sync: Most recent sync time.
- Scopes: Config scopes covered by sync.
- State file path: Local sync state file.
- Error message: Reason shown when sync fails.

## Account Management

- Deactivate Account: Opens the deactivation confirmation modal.
- DEACTIVATE confirmation input: The account can be deactivated only after entering `DEACTIVATE`.

Account deactivation closes sync and login state. It is a high-impact action.
