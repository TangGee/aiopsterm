# Hosts, Jump Hosts, And JumpServer

This guide starts with a common goal: save a production entry once, reconnect by name, route through proxies or jump hosts when required, and synchronize JumpServer organization assets into one resource tree.

![Assets workspace](../images/assets-workspace.png)

Use **① Host Management**, **② Bastion Management**, **③ Key Management**, and **④ Proxy Management** for separate resource types; **⑤** is a connectable host asset.

## Scenario 1: Save Credentials And Reconnect

Create a host in Assets with its name, address, port, username, and authentication method. Password hosts may store a password. Key authentication references a KeyChain record.

The saved asset can then be opened from the Workspace tree, Assets, `aiossh <host-name>`, or the exported `aiopsterm_hosts` MCP server.

When no password is stored, a global authentication dialog appears. `Remember password and update this host` writes the password only after SSH reaches ready state.

## Scenario 2: Route SSH Through A Proxy

Host forms support saved HTTP/HTTPS CONNECT, SOCKS4/SOCKS5, and raw TCP proxy configurations. Raw TCP is intended for an endpoint that already forwards bytes to the target SSH service; it sends no target metadata and implements no proxy credential protocol.

Proxy settings and credentials stay in Main and are not exposed through ordinary asset snapshots or AI context.

## Scenario 3: Use A Jump Host

aiopsterm prefers standard SSH TCP forwarding through the selected jump host. Password, OTP, and keyboard-interactive requests from either hop appear in the shared authentication dialog.

If the jump host rejects TCP forwarding, the visible terminal may fall back to relay-shell:

1. Local OpenSSH logs into the relay.
2. aiopsterm waits for an interactive prompt.
3. It writes a nested `ssh <target>` into that terminal stream.

Relay-shell remains interactive but is not a structured SSH channel, so SFTP is unavailable. Use a TCP-forward-capable jump host or run `scp` or `rsync` in the terminal.

## Scenario 4: Synchronize JumpServer Assets

Create a JumpServer data source under Bastion Management:

1. Enter the JumpServer root URL.
2. Enter a Private Token.
3. Optionally enter an organization id.
4. Save the bastion's own SSH endpoint and authentication.
5. Run Refresh Organization Assets.

The backend creates and updates stable synchronized assets. It removes only stale rows previously marked as synchronized for that organization and preserves manually managed assets. A failed refresh leaves the previous validated snapshot intact.

The Private Token is stored through the credential boundary. Normal snapshots and exports expose only a presence flag.

## JumpServer And Kubernetes

The Kubernetes workspace can map synchronized JumpServer assets into its catalog, but JumpServer command streaming is not implemented. Connect, resource refresh, and Kubernetes terminal actions fail closed for those entries. Import a local kubeconfig for real Kubernetes operations.

## Troubleshooting Order

1. Run the host or bastion connection test.
2. Distinguish network, password, key, disabled-password, and missing-auth failures.
3. For JumpServer refresh failures, verify URL, token, organization id, and pagination.
4. For nested SSH failures, verify TCP forwarding.
5. For SFTP failures, check whether the connection is using relay-shell.
