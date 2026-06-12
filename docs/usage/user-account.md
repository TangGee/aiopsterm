# User Account

aiopsterm mirrors External reference's user entry, login tabs, account center, user info card, password reset, contact binding, avatar upload, trusted devices, and account deactivation through self-owned Electron preload/main boundaries.

The renderer never treats typed account credentials as a successful login by itself. Account-password login calls `window.aiops.loginUserAccount()` and succeeds only when the main-process user account backend has a matching credential record. Unknown usernames and wrong passwords return `USER_LOGIN_INVALID`.

## Account Credentials

- Non-seed runtime starts without development account-password credentials. Users can still use backend-owned email/mobile code login, skip-login, or a future real account provisioning flow.
- Development seed mode is explicit: `AIOPSTERM_USER_ACCOUNT_ENABLE_SEED=1` or test runtime configuration may provide deterministic seed credentials for regression tests.
- Password reset updates the backend-owned credential hash for the currently logged-in local account when one exists.
- Username edits keep the current account credential aligned with the backend profile username.
- Credential records are private main-process state. Public user snapshots expose only profile and trusted-device data, never password, salt, or hash fields.

## Verification Code Login

Email and mobile login codes are issued and verified by the backend. The renderer starts visible countdowns only from complete backend challenge snapshots whose `challengeId`, `kind`, `target`, and `expiresAt` match the current request.

## User Data File

The user account backend persists profile, trusted devices, and private credential metadata under the configured account state file. The default Electron runtime stores it below app user data; tests can override it with `AIOPSTERM_USER_ACCOUNT_STATE_FILE` or direct runtime configuration.
