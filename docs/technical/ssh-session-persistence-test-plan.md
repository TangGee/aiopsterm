# Terminal recovery functional and performance validation

Updated: 2026-09-08. This document replaces the former tmux test matrix. No test requires tmux or a deployed remote daemon. [Design](ssh-session-persistence-plan.md) defines the implemented scope.

## Executable test matrix

| Area | Automated cases | Location |
| --- | --- | --- |
| Automatic SSH reconnect | Same logical session, no final exit during retry, retained output, alternate-screen reset, offline input rejection and no replay | `tests/ssh-terminal-recovery-backend.test.ts` |
| Retry lifecycle | Initial failure, manual/process/authentication-style errors, retry timer cancellation, close during connect, old-generation data and readiness, eight-attempt backoff limit | Same supervisor suite |
| State carried across attempts | Verified cwd, latest dimensions, paused state, one final close/exit | Same supervisor suite |
| Shell integration | Fragmented UTF-8/OSC, Unicode and quoted path, control-byte/relative/oversized path rejection, unbounded OSC input, ignored nested-host OSC 7, real Bash startup and missing-directory fallback | Same supervisor suite |
| Real SSH and PTY | Ephemeral loopback SSH server authenticates a client; a real PTY runs Bash; `cd` is observed; the SSH connection drops; a new connection and PID restore cwd; no offline input replay; normal exit does not reconnect | `tests/ssh-terminal-recovery-integration-backend.test.ts` |
| Storage | Ordered atomic writes, private permissions, no credential/environment persistence, corrupt/missing file recovery, version/identity/SSH-target validation, size caps, stale split-reference repair, control-sequence removal, clearing recovery | `tests/terminal-recovery-store-backend.test.ts` |
| Renderer restoration | History and split layout before shell launch, reuse of live Main session, user-opened-tab race, disabled recovery, unchanged-save suppression, closed-tab restoration, metadata-only export, storage failure notice | `tests/terminal-workspace-recovery-runtime.test.ts` |
| Shell launch integration | Local cwd, verified-only SSH cwd, manual reconnect cancels the existing session before opening another | `tests/terminal-workspace-session-runtime.test.ts` |
| Existing backends and IPC | Existing SSH direct/proxy/jump/pool/auth flows, local PTY startup, text/binary/resize/kill channels | `tests/ssh-terminal-backend.test.ts`, `tests/local-terminal-backend.test.ts`, `tests/terminal-sessions-ipc.test.ts` |
| Panel and flow regressions | Clear recovery metadata when resetting the placeholder; preserve lifecycle transitions and adaptive flow control | `tests/terminal-panel-runtime.test.ts`, `tests/terminal-flow-control.test.ts` |
| Desktop integration | Real local shell writes history and changes cwd; checkpoint is read from Main; renderer reload retains session ID and PID; application restart creates a new PID and restores history/cwd; typing `pwd` confirms the actual directory | `tests/e2e/terminal-recovery.spec.ts` |

The tests distinguish an original process from a reconstructed shell using PID/session ID assertions. A visually similar prompt is not sufficient evidence of process continuity. The real SSH test creates an isolated server and temporary directories, cleans up its own processes, and never restarts a system sshd or changes firewall rules.

## Performance gates

| Scenario | Gate | Rationale |
| --- | --- | --- |
| Stream parsing | Process 64 MiB of ordinary terminal output and an oversized partial OSC in less than 2 seconds; accept the next valid cwd exactly once | Detects unbounded buffering and major parser regressions |
| Checkpoint normalization | Normalize 32 tabs with 128 Ki characters each and encode within the 16 MiB file cap in less than 1 second | Coarse CI guard for bounded checkpoint work |
| Automatic reconnect | Real loopback SSH test regains an interactive shell and verified cwd within 5 seconds of the drop | Includes the one-second first retry delay; not a WAN SLA |
| Resource scheduling | One checkpoint writer and sequential renderer worker reads; identical snapshots skipped; at most one retry timer per logical session | Verified through state-machine tests and implementation review |

These are functional and coarse performance regression gates. They do not claim measured WAN p95, hundreds of simultaneous sessions, memory continuity across application exit, or recovery of arbitrary full-screen applications. The persistence format stores bounded plain history, not every original byte or terminal color.

## Commands

Switch native modules to Node for backend tests:

```bash
npm run native:ensure:node
npx vitest run tests/ssh-terminal-recovery-backend.test.ts tests/ssh-terminal-recovery-integration-backend.test.ts tests/terminal-recovery-store-backend.test.ts tests/terminal-workspace-recovery-runtime.test.ts tests/ssh-terminal-backend.test.ts tests/local-terminal-backend.test.ts tests/terminal-sessions-ipc.test.ts tests/terminal-workspace-session-runtime.test.ts tests/terminal-panel-runtime.test.ts tests/terminal-flow-control.test.ts
npm run build
```

Switch to Electron before the desktop test; do not run competing native ABI rebuilds concurrently:

```bash
npm run native:ensure:electron
xvfb-run -a npx playwright test tests/e2e/terminal-recovery.spec.ts
```

On a desktop with a working display, omit `xvfb-run -a`. The real Bash/PTY and `/proc` assertions target Linux and are explicitly skipped on other platforms. Backend mock and renderer state-machine tests remain useful on other platforms; the Linux integration run is the validated environment for this delivery.

Build includes i18n, state-ownership and documentation audits plus renderer/Main/sidecar/regression type checks. Only the changed feature and adjacent behavior require rerunning after a focused correction; unrelated suites are not represented as executed.

## Environment and audit record

The user authorized ali for testing. In this workspace, the `ali` SSH alias did not resolve, so no ali test, remote installation, or external-server fault injection is claimed. The real loopback SSH+PTY test provides actual transport and shell evidence without needing ali credentials.

The final focused run passed 93 tests in 10 files, including real SSH+PTY and the performance gates. The separate Electron test passed renderer reload and full application restart (1 test, 8.1 seconds including launch). `npm run build` passed. A pre-existing millisecond-sensitive placeholder timestamp assertion was corrected to check the allowed time interval and the reset of the newly introduced recovery flags. The Electron test exposed a restored-tab ID colliding with the initial welcome view; restoration now disposes that placeholder view before rebuilding the saved display.

No tmux process-preservation tests from the superseded plan are acceptance criteria for this feature. No independent daemon, remote original-process resurrection, multiwindow controller lease, or WAN benchmark is deferred as unfinished work in this implementation.
