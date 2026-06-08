# Desktop Protocol

aiopsterm registers the self-owned `aiopsterm://` desktop protocol in packaged builds.

Supported links:

```text
aiopsterm://open/workspace
aiopsterm://open/assets
aiopsterm://open/files
aiopsterm://open/snippets
aiopsterm://open/knowledge
aiopsterm://open/extensions
aiopsterm://open/kubernetes
aiopsterm://open/database
aiopsterm://open/settings
aiopsterm://open/settings?section=mcp
aiopsterm://open/user
aiopsterm://open?target=agents
```

Settings links support these `section` values:

```text
general
terminal
extensions
models
billing
ai
mcp
skills
rules
shortcuts
trustedDevices
privacy
about
docs
```

The main process rejects unsupported schemes, unsupported targets, unsupported settings sections, and internal attachment refs such as `aiopsterm://chat-attachment/...`.

Deep links only route to local aiopsterm UI state. They do not call External reference services, login callbacks, sync APIs, or remote backends.
