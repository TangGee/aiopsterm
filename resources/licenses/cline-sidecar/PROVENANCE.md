# Cline Sidecar License Overrides

These files fill license omissions in the published npm tarballs used by the
sidecar bundle. The build includes their contents in the generated third-party
notices and records the evidence path in the CycloneDX SBOM.

- `opencode-LICENSE`: `@opencode-ai/sdk@1.17.18`, retrieved from
  `https://raw.githubusercontent.com/anomalyco/opencode/v1.17.18/LICENSE`,
  SHA-256 `625f0f619133f89bbbb2abe37369613dfa1885eba1e50d02170deb62bb42cb6b`.
- `simple-git-LICENSE`: `simple-git@3.36.0`,
  `@simple-git/args-pathspec@1.0.3`, and
  `@simple-git/argv-parser@1.1.1`, retrieved from commit
  `01bb7ceae698831e9abd9310f7d61484970ab53c`,
  SHA-256 `3a31277abe4e0a30eb17dad52addace2fd73580fd9d79d40590e69785fdf71d5`.
- `node-22.20.0-LICENSE`: fallback license and third-party notices for the
  `node-win-x64@22.20.0` and `node-win-arm64@22.20.0` packages, whose published
  tarballs contain the executable and package metadata but no license file.
  SHA-256 `e991d81497a85bb24fc6bffae0a3637a6accd6c6bc5ce1f2c5698bd555cf9d49`.
