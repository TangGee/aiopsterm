# SSH Terminal Runtime

The SSH terminal backend owns direct ssh2 sessions, proxy socket sessions, TCP-forward jump-host sessions, and relay-shell fallback sessions.

## Keepalive

Direct, proxy, and TCP-forward jump-host sessions set ssh2 keepalive on every created client with the shared SSH default interval of 10 seconds and a count max of 3 missed replies.

The same ssh2 keepalive defaults are also applied to asset connection diagnostics, remote SFTP connection pooling, and SSH tunnel clients so non-terminal SSH transports do not diverge from terminal behavior.

Relay-shell fallback uses local `ssh` processes. The reusable relay process and the nested target `ssh` command both receive matching OpenSSH options:

- `ServerAliveInterval=10`
- `ServerAliveCountMax=3`

This keeps both hops active when a host only works through an interactive relay shell instead of SSH TCP forwarding. If the target shell is entered manually by the user inside an unrelated terminal, aiopsterm cannot rewrite that user-typed command after the fact; the user should reconnect through an aiopsterm SSH asset or include their own OpenSSH keepalive options.
