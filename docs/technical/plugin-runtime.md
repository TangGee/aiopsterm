# Plugin Runtime

The aiopsterm plugin runtime is a declarative host boundary. It owns discovery, validation, installation, persistence, contribution rendering, and provider writes without loading plugin code into Electron.

## Sources

The catalog merges three aiopsterm-owned sources:

- `builtin`: unpacked manifests from packaged `resources/builtin-plugins`.
- `store`: local store archives or a configured HTTP(S) catalog.
- `local`: `.aiopsterm-plugin` archives dragged into the desktop application.

Installed store and local rows are persisted under `userData/extensions/registry.json`. Extracted package contents live under `userData/extensions/installed/<id>/<version>`, and downloaded packages use `userData/extensions/cache`.

The runtime accepts only `.aiopsterm-plugin` archives with a root `aiopsterm.plugin.json`. It rejects `.external-reference`, External reference `plugin.json`, missing engine declarations, unsupported app versions, invalid plugin kinds, missing contributions, unsafe ZIP paths, manifest identity mismatches, version mismatches, and checksum mismatches.

## Runtime Flow

```text
manifest or package
  -> main-process parser and validator
  -> backend-owned catalog row
  -> preload IPC contract
  -> renderer structural guard
  -> contribution-specific UI
  -> existing host capability boundary
```

For a content contribution, the UI submits a declared command to the existing terminal execution controller. Terminal availability, command security, write acknowledgement, and output remain owned by the terminal runtime.

For a provider contribution, the UI submits field values through `extensions:provider:sync-assets`. The main process resolves an installed provider and adapter, parses and validates all input rows, generates stable asset IDs, normalizes asset fields, adds source tags, and calls the existing asset persistence boundary. The current JSON adapter limits input to 2 MiB and 1000 rows.

## Trust Boundary

The manifest is untrusted input. Renderer guards validate successful-looking backend envelopes before applying catalog or provider results. Package URLs use the shared HTTP(S)-only normalizer, optional SHA-256 checksums are verified before extraction, and ZIP entries cannot escape the target directory.

There is no `main.js` contract, Node module loader, renderer script injection, or direct database API for plugins. Adding executable plugins would require an independent process isolation, permissions, signing, resource limits, update policy, and audit design.

## Built-in Capability Probes

Two built-ins exercise both current extension points:

- `aiopsterm.linux-incident-runbook` is a `content` plugin with Linux inspection commands.
- `aiopsterm.generic-cmdb-assets` is a `provider` plugin using the host-owned `json-assets` adapter.

Packaging audits require both manifests in the application resources. Backend tests verify discovery, required built-in state, command contributions, provider import, package installation, persistence, cancellation, checksums, and explicit legacy-package rejection.
