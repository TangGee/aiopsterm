# Package Verification

Before packaging changes are merged, run the package configuration audit:

```bash
npm run audit:package-config
```

`audit:package-config` verifies that the package scripts expose `build:codex`, `audit:codex-runtime`, `build:linux`, `build:deb`, `build:mac`, and `build:mac:dir`; that Linux/macOS package scripts build the bundled Codex package before electron-builder; that the Codex build uses the package builder from the locally modified `codex/` tree; that electron-builder keeps the External reference reference tree excluded; that Linux targets include AppImage and deb; that macOS targets include dmg and zip; that artifact names are explicit; that `resources/icons`, `resources/codex-aiopsterm-mcp.js`, `resources/aiopsterm-external-codex-mcp.js`, and `resources/aiopsterm-agent-hook.js` are copied into packaged resources; that the afterPack hook copies the complete generated Codex package into packaged resources; that the GPT-generated source PNG exists; that the required Linux PNG icon sizes are valid; and that the `aiopsterm://` protocol remains registered.

`audit:codex-runtime` checks the generated Codex package before app packaging. It requires `codex-package.json`, the `bin/codex` entrypoint, bundled `rg`, and Linux `bwrap`; on Linux it also rejects unresolved dynamic dependencies and OpenSSL 1.1 dynamic links such as `libssl.so.1.1` / `libcrypto.so.1.1`.

On Linux, the Codex musl package build requires the native release toolchain used by Codex: `ca-certificates curl musl-tools pkg-config libcap-dev g++ clang libc++-dev libc++abi-dev lld xz-utils`. CI jobs may provide prebuilt helper binaries through `AIOPSTERM_CODEX_BWRAP_BIN` and `AIOPSTERM_CODEX_RG_BIN`, but the package entrypoint must still come from this repository's local modified `codex/` source unless `AIOPSTERM_CODEX_PACKAGE_DIR` is intentionally supplied. The Codex package builder downloads Codex-built V8 artifacts from OpenAI Codex releases by default; offline or restricted runners should preconfigure `RUSTY_V8_ARCHIVE` and `RUSTY_V8_SRC_BINDING_PATH`.

After building the full Linux package set with `npm run build:linux`, run the package-level checks:

```bash
npm run smoke:packaged
npm run audit:linux-package
```

`smoke:packaged` launches `dist/linux-unpacked/aiopsterm` under Xvfb with an isolated temporary user-data directory, waits for the main window, and verifies that the local shell tab and terminal output area render.

`audit:linux-package` checks the Linux build output without launching the app. It verifies:

- the expected AppImage, deb, `app.asar`, and `app.asar.unpacked` files exist for the current package version
- the packaged Codex package exists at `resources/codex`, includes `codex-package.json`, `bin/codex`, `codex-path/rg`, and `codex-resources/bwrap`, and the entrypoint is executable, answers `codex --version`, and has no unresolved or OpenSSL 1.1 Linux dynamic dependencies
- packaged `node-pty` still includes `build/Release/pty.node`, runtime JS, package metadata, and license
- packaged `node-pty` no longer includes build-only directories such as `bin`, `scripts`, `src`, `deps`, `prebuilds`, or test files
- the self-owned app icon PNG set generated from `resources/app-icon-source.png` is present for Linux desktop metadata and runtime window icon loading
- the deb desktop file registers `MimeType=x-scheme-handler/aiopsterm;`
- the deb desktop file keeps `%U` URL argument handling in its `Exec` line

These checks assume Linux tooling is available, including `xvfb-run` for the packaged smoke test and `dpkg-deb` for deb metadata extraction.

After a deb-only build with `npm run build:deb`, verify that `dist/aiopsterm-<version>-linux-amd64.deb` exists. The full `audit:linux-package` check expects both AppImage and deb outputs, so run it after `build:linux` when validating the complete Linux package set.

macOS packaging is configured with:

```bash
npm run build:mac
npm run build:mac:dir
```

Run those commands on macOS. Linux development machines can audit the macOS target configuration with `npm run audit:package-config`, but they should not be treated as successful macOS packaging runners.
