# Terminal recovery functional and performance validation

Updated: 2026-09-08. This document replaces the former tmux test matrix. No test requires tmux or a deployed remote daemon. [Design](ssh-session-persistence-plan.md) defines the implemented scope.

## Executable test matrix

| Area | Automated cases | Location |
| --- | --- | --- |
| Automatic SSH reconnect | Same logical session, no final exit during retry, retained output, alternate-screen reset, offline input rejection and no replay | `tests/ssh-terminal-recovery-backend.test.ts` |
| Retry lifecycle | Initial failure, manual/process/authentication-style errors, disabled auto-reconnect, backoff reset, duplicate exit suppression, retry factory exceptions, cancellation during backoff/connect, stale data/readiness/authentication callbacks, eight-attempt limit | Same supervisor suite |
| State carried across attempts | Verified cwd, latest dimensions, paused state, one final close/exit | Same supervisor suite |
| Shell integration | Fragmented UTF-8/OSC, Unicode and quoted path, control-byte/relative/oversized path rejection, unbounded OSC input, ignored nested-host OSC 7, real Bash startup, scalar/array PROMPT_COMMAND preservation, bashrc directory changes, missing/inaccessible-directory fallback and quoted-path injection sentinel | Same supervisor suite |
| Public SSH fault injection | Three TCP cuts and one silent bidirectional blackhole against an explicitly supplied SSH host; automatic recovery, actual cwd/PID, preserved output, rejected-input sentinel, background exec, normal exit and remote cleanup | `tests/live-ssh-recovery-backend.test.ts` |
| Real SSH and PTY | Ephemeral loopback SSH server authenticates a client; a real PTY runs Bash; `cd` is observed; the SSH connection drops; a new connection and PID restore cwd; no offline input replay; normal exit does not reconnect | `tests/ssh-terminal-recovery-integration-backend.test.ts` |
| Storage | Ordered atomic writes, private permissions, no credential/environment persistence, corrupt/missing file recovery, version/identity/SSH-target validation, size caps, stale split-reference repair, newest-tail retention, ST/C1/unterminated control removal, interrupted temporary writes, failed-save recovery, reused temporary-file permissions, clearing recovery | `tests/terminal-recovery-store-backend.test.ts` |
| Renderer restoration | History and split layout before shell launch, reuse of live Main session, single-editor and removed-tab races, disposal and disabled-setting races, unchanged-save suppression, coalesced saves, sequential capped history reads, closed-tab restoration, independent tab launch failures, failed-save retry | `tests/terminal-workspace-recovery-runtime.test.ts` |
| Shell launch integration | Local cwd, verified-only SSH cwd, manual reconnect cancels the existing session before opening another; late results from removed/replaced tabs are killed, obsolete launch errors are ignored | `tests/terminal-workspace-session-runtime.test.ts` |
| Existing backends and IPC | Existing SSH direct/proxy/jump/pool/auth flows, local PTY startup and restored missing/file/directory cwd, text/binary/resize/kill channels; recovery IPC checks window ownership and matching local/SSH target, reads actual live local cwd, honors configuration overrides | `tests/ssh-terminal-backend.test.ts`, `tests/local-terminal-backend.test.ts`, `tests/terminal-sessions-ipc.test.ts` |
| Worker display | Read normal-buffer history while the real xterm worker has an active alternate screen; exclude alternate content | `tests/threaded-terminal-core-worker.test.ts` |
| Panel and flow regressions | Clear recovery metadata when resetting the placeholder; preserve lifecycle transitions and adaptive flow control | `tests/terminal-panel-runtime.test.ts`, `tests/terminal-flow-control.test.ts` |
| Desktop integration | Real local shell writes history and changes cwd; checkpoint is read from Main; renderer reload retains session ID and PID; application restart creates a new PID and restores history/cwd; typing `pwd` confirms the actual directory; disabled recovery, corrupt snapshot and normal shell exit exercise restart failure paths | `tests/e2e/terminal-recovery.spec.ts` |

The tests distinguish an original process from a reconstructed shell using PID/session ID assertions. A visually similar prompt is not sufficient evidence of process continuity. The real SSH test creates an isolated server and temporary directories, cleans up its own processes, and never restarts a system sshd or changes firewall rules.

## Performance gates

| Scenario | Gate | Rationale |
| --- | --- | --- |
| Stream parsing | Process 64 MiB of ordinary terminal output and an oversized partial OSC in less than 2 seconds; accept the next valid cwd exactly once | Detects unbounded buffering and major parser regressions |
| Checkpoint normalization | Normalize 32 tabs with 128 Ki characters each and encode within the 16 MiB file cap in less than 1 second | Coarse CI guard for bounded checkpoint work |
| Automatic reconnect | Real loopback SSH test regains an interactive shell and verified cwd within 5 seconds of the drop | Includes the one-second first retry delay; not a WAN SLA |
| Resource scheduling | One checkpoint writer and sequential renderer worker reads; identical snapshots skipped; at most one retry timer per logical session | 100 reconnect/cancel cycles leave zero retry timers; concurrent save calls coalesce and read at most 32 tabs per pass |

These are functional and coarse performance regression gates. They do not claim measured WAN p95, hundreds of simultaneous sessions, memory continuity across application exit, or recovery of arbitrary full-screen applications. The persistence format stores bounded plain history, not every original byte or terminal color.

## Commands

Switch native modules to Node for backend tests:

```bash
npm run native:ensure:node
npx vitest run tests/ssh-terminal-recovery-backend.test.ts tests/ssh-terminal-recovery-integration-backend.test.ts tests/terminal-recovery-store-backend.test.ts tests/terminal-workspace-recovery-runtime.test.ts tests/ssh-terminal-backend.test.ts tests/local-terminal-backend.test.ts tests/terminal-sessions-ipc.test.ts tests/terminal-workspace-session-runtime.test.ts tests/terminal-panel-runtime.test.ts tests/terminal-flow-control.test.ts tests/threaded-terminal-core-worker.test.ts tests/live-ssh-recovery-backend.test.ts
npm run build
```

Switch to Electron before the desktop test; do not run competing native ABI rebuilds concurrently:

```bash
npm run native:ensure:electron
xvfb-run -a npx playwright test tests/e2e/terminal-recovery.spec.ts
```

On a desktop with a working display, omit `xvfb-run -a`. The real Bash/PTY and `/proc` assertions target Linux and are explicitly skipped on other platforms. Backend mock and renderer state-machine tests remain useful on other platforms; the Linux integration run is the validated environment for this delivery.

Build includes i18n, state-ownership and documentation audits plus renderer/Main/sidecar/regression type checks. Only the changed feature and adjacent behavior require rerunning after a focused correction; unrelated suites are not represented as executed.

## Opt-in public SSH test

The public test is skipped unless `AIOPSTERM_LIVE_SSH_RECOVERY_ENABLE=1`. Provide `AIOPSTERM_LIVE_SSH_HOST`, `AIOPSTERM_LIVE_SSH_USERNAME`, and `AIOPSTERM_LIVE_SSH_PASSWORD` in the test process environment; `AIOPSTERM_LIVE_SSH_PORT` defaults to 22. Supply the password through a hidden prompt or secret injection, never a committed file or literal shell command. Run:

```bash
npx vitest run tests/live-ssh-recovery-backend.test.ts
```

This suite uses real SSH and the remote PTY without loading local native PTY/SQLite modules. It does not require changing the local Electron native ABI. It has a 180-second deadline, and uses a separate administrative connection only for preflight, creating/removing its own temporary directory, and checking the rejected-input sentinel.

## Environment and audit record

After the initial alias-resolution failure, the user supplied direct access to ali. The public SSH recovery test passed on 2026-09-08 using the application's production SSH backend and the remote account's actual Bash/PTY. The endpoint and credentials are not stored in this document or in test source.

A local TCP fault proxy forwarded only this test's connection to the public server. Three cuts destroyed those sockets. The blackhole case kept TCP connected while dropping traffic in both directions, exercising the production 10-second SSH keepalive interval and count limit of five. No sshd, firewall, user profile, or remote service was changed. Interactive test shells used `HISTFILE=/dev/null`. The unique remote temporary directory was removed and its absence verified in teardown.

| Public test fault | Detection | Recovery after detection |
| --- | --- | --- |
| TCP cut 1 | 26 ms | 3060 ms |
| TCP cut 2 | 25 ms | 2475 ms |
| TCP cut 3 | 26 ms | 2225 ms |
| Silent bidirectional blackhole | 59821 ms | 4095 ms |

Recovery timing includes a new interactive identity/cwd response and the independent rejected-input sentinel check. These four samples are observations, not percentiles or a WAN SLA. All four cycles restored the same cwd with a new PID, kept prior output, rejected offline input, and left no replay side effect. Background exec and normal `exit` also passed; normal exit did not start another connection. The complete opt-in test took 79.04 seconds. Public GUI automation, random packet-loss rates and operating-system sleep/wake are not claimed by this run.

The blackhole result is a user-visible limit: silent network loss can take about 60 seconds to detect with current defaults, even though reconnecting requires no Enter key. The shorter 2.2-3.1-second cut results must not be advertised as silent-outage detection latency.

The coverage audit run passed 152 tests in 11 files, including real loopback SSH+PTY and the performance gates; the public suite correctly skipped without explicit enablement. The separate public run above passed its one opt-in test. The final Electron run passed all four scenarios in 27.8 seconds: live reload/full restart, recovery disabled, corrupt checkpoint, and normal exit remaining closed. `npm run build` passed all required audits and type checks. The added IPC target cases also verify host, username and port mismatches and that a matching live SSH session supplies its newest verified cwd.

The audit added failure, concurrency and boundary cases beyond the initial positive-path tests. Those cases exposed and fixed:

- A singleton editor opened during disk loading could be replaced by terminal restoration.
- Disabling recovery, disposing the runtime, or removing an already-captured tab during an asynchronous history read could leave stale recovery work.
- A failed shell launch could prevent other saved tabs from restoring.
- Delayed terminal creation could attach to a removed/replaced panel or leave an unattached process; obsolete launch failures could overwrite current status.
- A stale saved session ID could attach to a different local/SSH target.
- Oversized history could retain an older prefix instead of the newest tail; ST-terminated OSC removal could swallow ordinary text; invalid cwd verification could survive normalization.
- Reusing an interrupted temporary file could retain permissive file permissions.
- Manually cancelling reconnect could retain the prior network-failure flag.

Each fix is tied to the executable suites in the matrix. The desktop cases validate the resulting behavior through real Electron, IPC and local shells. Earlier positive-path testing also fixed a restored-tab ID collision with the welcome view; placeholder views are disposed before restoring saved display.

No tmux process-preservation tests from the superseded plan are acceptance criteria for this feature. No independent daemon, remote original-process resurrection, multiwindow controller lease, or WAN benchmark is deferred as unfinished work in this implementation.
