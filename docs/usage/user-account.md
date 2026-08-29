# User Account

aiopsterm provides user entry, login tabs, an account center, a user info card, password reset, contact binding, avatar upload, trusted devices, and account deactivation through self-owned Electron preload/main boundaries.

The renderer never treats typed account credentials as a successful login by itself. Account-password login calls `window.aiops.loginUserAccount()` and succeeds only when the main-process user account backend has a matching credential record. Unknown usernames and wrong passwords return `USER_LOGIN_INVALID`.

External login and account-center entry points are also backend-owned. Configure `AIOPSTERM_USER_LOGIN_URL` and `AIOPSTERM_USER_ACCOUNT_CENTER_URL` with HTTP(S) URLs when the runtime should open those pages. The main process validates the URL and calls the OS external opener; the renderer accepts success only from the structured `openUserLogin()` / `openUserAccountCenter()` result and does not change account or billing state just because a button was clicked.

Playwright can set `AIOPSTERM_USER_EXTERNAL_OPEN_BACKEND_DOUBLE=1` so the main-process backend accepts those configured URLs without launching a real browser. That switch is for deterministic E2E runs only.

## Account Credentials

- Non-seed runtime starts without development account-password credentials. Users can still use backend-owned email/mobile code login, skip-login, or a future real account provisioning flow.
- Development seed mode is explicit: `AIOPSTERM_USER_ACCOUNT_ENABLE_SEED=1` or test runtime configuration may provide deterministic seed credentials for regression tests.
- Password reset updates the backend-owned credential hash for the currently logged-in local account when one exists.
- Username edits keep the current account credential aligned with the backend profile username.
- Credential records are private main-process state. Public user snapshots expose only profile and trusted-device data, never password, salt, or hash fields.
- Credential hashing uses asynchronous `scrypt` in the main process. Account APIs that read or mutate credentials are asynchronous so login, password reset, and seed credential loading do not block the Electron event loop.

## Verification Code Login

Email and mobile login codes are issued and verified by the backend. The renderer starts visible countdowns only from complete backend challenge snapshots whose `challengeId`, `kind`, `target`, and `expiresAt` match the current request.

## User Data File

The user account backend persists profile, trusted devices, and private credential metadata under the configured account state file. The default Electron runtime stores it below app user data; tests can override it with `AIOPSTERM_USER_ACCOUNT_STATE_FILE` or direct runtime configuration.
