# Troubleshooting

## Runtime Logs

aiopsterm writes runtime diagnostics to:

```text
<userData>/logs/aiopsterm-runtime.log
```

On a normal Linux development run, `<userData>` is usually:

```text
~/.config/aiopsterm
```

The terminal diagnostics include local/SSH terminal create, lifecycle, write, resize, kill, and backend data events. Terminal write logs intentionally record byte counts and session metadata only; command text and secrets are not written to the runtime log.

When reporting a terminal input problem, include the recent `terminal.*` and `renderer.terminal-*` entries from this file.

## SSH Jump Host Diagnostics

SSH and jump-host lifecycle logs include structured routing and authentication metadata. These fields are safe to share for debugging because they do not include passwords, private keys, passphrases, OTP values, command text, or terminal output:

- `authScope`: `jump` means the prompt or connection step belongs to the jump host; `target` means it belongs to the final SSH target.
- `authPurpose`: `password` for password prompts, `keyboard-interactive` for OTP / dynamic-code prompts.
- `sshTransport`: `direct`, `proxy`, `jump`, or `relay-shell`.
- `targetHost`, `targetPort`, `targetUsername`: the final SSH target.
- `jumpHost`, `jumpPort`, `jumpUsername`: the jump host used to reach the target.
- `sshAuthMethods`: enabled auth method names only, such as `password`, `privateKey`, `agent`, and `keyboard-interactive`.
- `connectionReuse`: `created` means aiopsterm opened a new authenticated SSH connection; `reused` means it reused an existing app-managed SSH connection or relay master for a new terminal channel.
- `remoteHop`: for relay-shell connections, `relay` means the nested shell is still on the jump host and `target` means the target prompt has been inferred.
- `expectedHost`, `actualHost`, `actualUsername`, `endpointConfidence`: non-secret endpoint metadata used to infer whether the terminal is currently on the jump host or the target.

For a jump-host failure, read entries in this order:

1. `terminal.keyboard-interactive.request` with `authScope: "jump"` shows a jump-host password or dynamic-code prompt.
2. `terminal.lifecycle` with `sshTransport: "jump"` and `stage: "proxy-opening"` shows the jump host and final target for the tunnel.
3. `terminal.lifecycle` with message `Opening SSH jump tunnel ...` means the jump host authenticated and aiopsterm is opening `forwardOut` to the target.
4. `terminal.lifecycle` with `authScope: "target"` and `sshTransport: "jump"` means the target SSH handshake is starting through that tunnel.

If the log reaches step 3 and direct TCP forwarding is rejected, aiopsterm now falls back to `relay-shell` mode when a PTY runtime is available. In this mode aiopsterm starts local OpenSSH to the jump host first, waits until the interactive relay shell appears, then writes the nested `ssh <target>` command into that PTY, matching manual relay workflows such as `/home/tlinux/bin/1ssh`. Authentication prompts, host-key confirmations, and dynamic-password prompts from local OpenSSH are left in the terminal stream; aiopsterm does not write the nested target command while the latest relay output still looks like an authentication prompt.

aiopsterm owns SSH connection reuse instead of relying on the user's `~/.ssh/config`. Direct ssh2 sessions reuse an authenticated target client for repeated sessions to the same endpoint and auth identity; each terminal opens a new shell channel on that client. Standard jump-host sessions reuse the authenticated jump client for new `forwardOut` channels and also reuse the authenticated target client when the same target is opened again. Relay-shell fallback uses a self-owned OpenSSH master for the first hop only, with `ControlMaster=auto`, `ControlPersist=yes`, and an aiopsterm control socket under the app user-data directory; the nested `ssh <target>` still runs inside the relay environment so enterprise relay login systems keep their own behavior. Lifecycle logs show `connectionReuse: "created"` or `"reused"` for these paths.

Relay-shell startup is compatible with restricted jump shells: aiopsterm does not run relay-side helper commands such as `printf`, `export`, `hostname`, `pwd`, or `stty`. After the relay prompt appears, aiopsterm writes only the nested `ssh <target>` command into the PTY and hides that echoed command from terminal output when the PTY echoes it back. The lifecycle message `SSH relay shell connected; starting nested SSH ...` means aiopsterm has seen the relay prompt and has written the nested target command. A later `remoteHop: "target"` / `stage: "shell-ready"` with `endpointConfidence: "inferred"` means the target prompt was inferred from terminal output. If a configured target is an IP address, `expectedHost` remains that IP and `actualHost` may be the remote hostname shown in the prompt; use `remoteHop: "target"` plus the visible terminal prompt to confirm the nested target shell started.

Because relay-shell mode uses local OpenSSH in a PTY, password, dynamic-password, and host-key prompts are shown in the terminal stream instead of the global aiopsterm authentication dialog. This allows existing jump-host SSH config and target-side passwordless login to work, but saved aiopsterm target passwords are not injected into the local OpenSSH command.

For direct or jump-tunnel ssh2 connections, aiopsterm no longer opens a password dialog before the first network authentication attempt when no password is saved. This avoids a fake prompt on hosts that may support SSH Agent, keychain, or target-side passwordless login. If the real SSH server rejects authentication and the asset can use password auth, aiopsterm then opens the password dialog and can remember the password after a successful retry.
