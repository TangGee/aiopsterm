# Develop aiopsterm Plugins

An aiopsterm plugin is a declarative capability package validated and hosted by aiopsterm. It is not compatible with External reference plugins and does not execute a plugin-provided JavaScript entry point.

The current plugin kinds are:

- `content`, which contributes terminal commands.
- `provider`, which contributes a controlled data form processed by a host-owned adapter.

## Package Layout

An external plugin is a ZIP archive with the `.aiopsterm-plugin` extension. Its manifest must be at the archive root:

```text
my-plugin.aiopsterm-plugin
└── aiopsterm.plugin.json
```

Built-in plugins remain unpacked below `resources/builtin-plugins/<plugin-name>/aiopsterm.plugin.json`. Packaging copies that directory into the application resources.

`.external-reference` packages and External reference `plugin.json` manifests are unsupported.

## Manifest

Required common fields are `manifestVersion: 1`, a unique `id`, `displayName`, `version`, `kind`, `description`, `engines.aiopsterm`, and matching `contributes`. The engine range accepts `*`, an exact version, or `>=x.y.z`.

A `content` plugin must contribute at least one command:

```json
{
  "manifestVersion": 1,
  "id": "example.disk-check",
  "displayName": "Disk Check",
  "version": "1.0.0",
  "kind": "content",
  "description": "Disk inspection commands.",
  "engines": {
    "aiopsterm": ">=0.1.0"
  },
  "contributes": {
    "commands": [
      {
        "id": "disk-check.usage",
        "title": "Disk usage",
        "description": "Show filesystem capacity.",
        "command": "df -h"
      }
    ]
  }
}
```

Commands run through the existing terminal execution and security controller. A plugin cannot access terminal session objects or bypass that policy.

A `provider` plugin must contribute at least one asset provider. The current adapter is `json-assets`, and the current field type is `textarea`:

```json
{
  "manifestVersion": 1,
  "id": "example.cmdb",
  "displayName": "Example CMDB",
  "version": "1.0.0",
  "kind": "provider",
  "description": "Import JSON assets.",
  "engines": {
    "aiopsterm": ">=0.1.0"
  },
  "contributes": {
    "assetProviders": [
      {
        "id": "cmdb-json",
        "name": "CMDB JSON",
        "description": "Paste an asset array.",
        "adapter": "json-assets",
        "fields": [
          {
            "key": "payload",
            "label": "CMDB JSON",
            "type": "textarea",
            "required": true
          }
        ]
      }
    ]
  }
}
```

Input may be an array or an object containing an `assets` array. Every asset requires `externalId`, `name`, and `host`. The host limits a request to 2 MiB and 1000 assets, validates all rows before persistence, owns stable IDs, and normalizes fields.

## Verification

Run:

```bash
npm run typecheck
npx vitest run tests/extensions-backend.test.ts tests/extensions-client.test.ts
npm run audit:i18n
npm run audit:package-config
npm run audit:client-mocks
```

Adding a contribution type requires coordinated updates to shared contracts, manifest parsing, the host adapter, IPC and preload contracts, renderer guards and UI, packaging audits, and boundary tests. Capabilities that execute arbitrary code require a separate isolation and permission design.
