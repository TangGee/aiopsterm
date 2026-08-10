# Integrate JumpServer

This guide is for JumpServer administrators and integration developers. It explains how aiopsterm synchronizes one organization's host catalog while keeping the API datasource and bastion SSH login as separate security boundaries.

## Scenario: Synchronize One Organization Catalog

One JumpServer bastion record contains two configuration sets:

| Configuration | Purpose |
| --- | --- |
| JumpServer root URL, Private Token, organization id | Call the asset API and refresh the organization catalog |
| Bastion address, SSH port, username, and password or key | Log in to the bastion and use it as a jump path |

The API token does not replace SSH credentials, and SSH credentials cannot read the asset API. Grant least privilege independently.

## JumpServer API Contract

aiopsterm constructs:

```http
GET /api/v1/assets/hosts/?limit=100&offset=0
Authorization: PrivateToken <token>
X-JMS-ORG: <organization-id>
```

`X-JMS-ORG` is sent only when an organization id is configured. Enter a root such as `https://jumpserver.example.com`; do not include the hosts API path in the root URL.

Client behavior:

- 30-second timeout per page.
- 100-page safety limit.
- Follows only same-origin next-page URLs.
- Accepts a JumpServer list or a paged response with `results` and `next`.
- Network, authentication, non-success HTTP, non-JSON, cross-origin pagination, and malformed-host errors fail the whole refresh.

Give the token account read-only host-asset access in the intended organization. Validate it from an administrative environment:

```sh
curl \
  -H "Authorization: PrivateToken $JMS_PRIVATE_TOKEN" \
  -H "X-JMS-ORG: $JMS_ORG_ID" \
  "https://jumpserver.example.com/api/v1/assets/hosts/?limit=100&offset=0"
```

Do not place the token in source code, logs, or issue screenshots.

## Field Mapping And Stable Updates

Valid remote hosts map:

- JumpServer host id.
- Name and address.
- SSH port.
- Node path.
- Status, type, and category.
- Comment.

Local rows are stably updated by remote identity within the selected bastion and organization scope. A successful refresh:

1. Updates existing synchronized assets.
2. Creates new assets.
3. Deletes remote-missing rows explicitly marked as JumpServer-synchronized for that organization.
4. Preserves manually created hosts and other organizations.

Updates apply only after the complete remote result validates. Authentication, pagination, or payload failures leave the existing synchronized catalog unchanged, preventing a transient outage from causing mass deletion.

## Credential And Data Protection

The backend credential store encrypts the Private Token before SQLite or fallback persistence. Normal asset snapshots expose only `hasJumpserverToken`, and asset exports omit the token. Plaintext is returned for editing only through the dedicated editable-secret boundary.

Integrators should also:

- Use a separate token per environment.
- Rotate tokens and immediately run a refresh test.
- Prevent reverse proxies from logging `Authorization` or `X-JMS-ORG`.
- Use a valid TLS certificate for the root URL; do not leave verification disabled after testing.

## SSH, Secondary Login, And File Management

Synchronization discovers assets. Real target connections still use aiopsterm's SSH runtime:

- Standard SSH TCP forwarding through the bastion is preferred for secondary SSH.
- Password, OTP, and keyboard-interactive requests stay in aiopsterm's authentication dialog.
- If the bastion rejects TCP forwarding, a visible terminal may fall back to relay-shell and run nested SSH.
- Relay-shell is not a structured SSH channel and cannot support SFTP. Use a TCP-forward-capable path, or run `scp` or `rsync` in the terminal.

## Kubernetes Boundary

Synchronized assets can be mapped into the Kubernetes catalog, but JumpServer Kubernetes command streaming is not implemented. Connect, resource refresh, terminal, and resource actions for this source fail closed. Import a directly usable kubeconfig for real cluster operations.

## Integration Checklist

1. Validate the token, organization header, and first page with curl.
2. Confirm every pagination `next` URL has the same origin as the configured root.
3. Save the datasource in aiopsterm and verify that normal snapshots and exports contain no token.
4. Run the first refresh and check create count, names, addresses, ports, and node paths.
5. Change one remote asset and refresh; confirm a stable update rather than a duplicate.
6. Delete one remote synchronized asset and create one manual local host; confirm only the synchronized row is removed.
7. Test with a bad token and confirm the existing catalog remains intact.
8. Test bastion SSH, secondary SSH, OTP, and the SFTP boundary separately.

See [Asset Management](../../usage/best-practices/en-US/11-assets.md), [Assets And Workspace Resources](../../usage/assets-workspace.md), and [SSH Terminal Runtime](../../technical/ssh-terminal.md).
