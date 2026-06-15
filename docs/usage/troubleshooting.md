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
- `sshTransport`: `direct`, `proxy`, or `jump`.
- `targetHost`, `targetPort`, `targetUsername`: the final SSH target.
- `jumpHost`, `jumpPort`, `jumpUsername`: the jump host used to reach the target.
- `sshAuthMethods`: enabled auth method names only, such as `password`, `privateKey`, `agent`, and `keyboard-interactive`.

For a jump-host failure, read entries in this order:

1. `terminal.keyboard-interactive.request` with `authScope: "jump"` shows a jump-host password or dynamic-code prompt.
2. `terminal.lifecycle` with `sshTransport: "jump"` and `stage: "proxy-opening"` shows the jump host and final target for the tunnel.
3. `terminal.lifecycle` with message `Opening SSH jump tunnel ...` means the jump host authenticated and aiopsterm is opening `forwardOut` to the target.
4. `terminal.lifecycle` with `authScope: "target"` and `sshTransport: "jump"` means the target SSH handshake is starting through that tunnel.

If the log reaches step 3 and then fails with `SSH jump host forward failed`, the jump host authenticated but could not open TCP forwarding to the target host and port. Check jump-host `AllowTcpForwarding`, `PermitOpen`, target host resolution from the jump network, and whether the target port is reachable from the jump host.

If the target is passwordless only when manually running `ssh <target>` inside the jump host shell, a direct-tcpip jump tunnel still cannot automatically use private keys or SSH config files stored only on the jump host. In that case aiopsterm either needs target credentials available to the client side, agent/key forwarding that the target accepts, or a future nested-shell SSH mode that runs the second `ssh` command inside the jump host session.
