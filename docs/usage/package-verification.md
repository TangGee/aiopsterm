# Package Verification

Before packaging changes are merged, run the package configuration audit:

```bash
npm run audit:package-config
```

`audit:package-config` verifies the existing Codex and platform package entry points plus the exact-pinned Cline SDK, Bun bundler, and Node runtime build/audit commands. Every platform package script must build the sidecar before electron-builder. The builder config must copy `build/cline-sidecar`, exclude `@cline/*`, all application source (including sidecar TypeScript), and `external-reference/` from `app.asar`, and retain the reviewed license overrides. Run `npm run build:cline-sidecar && npm run audit:cline-sidecar` before the package audit. The sidecar audit executes the current-platform `node[.exe]` with `cline-agent-sidecar.cjs`, verifies the protocol lifecycle and supported provider initialization, reconciles the Bun metafile with `sbom.cdx.json`, validates hashes and license evidence, and rejects the unused Claude Agent SDK and SAP provider dependency trees.

The packaged `cline-sidecar` resource directory must contain `node`/`node.exe`, `cline-agent-sidecar.cjs`, `manifest.json`, `metafile.json`, `sbom.cdx.json`, `THIRD-PARTY-NOTICES.txt`, `NODE-LICENSE`, `CLINE-LICENSE`, and `CLINE-ATTRIBUTION.txt`. Bun is a build tool only and must not appear in that directory. The six platform Node packages are exact optional dependencies with root-lockfile SHA-512 integrity, but electron-builder must exclude every `node-linux-*`, `node-darwin-*`, `node-bin-darwin-*`, and `node-win-*` directory from `app.asar`; only the selected copied runtime may be distributed under `cline-sidecar`.

The target-level package commands split the release surface into four installable package targets:

| Target | Host runner | Build command | Main expected artifact |
| --- | --- | --- | --- |
| `linux-appimage` | Linux | `npm run package:build -- linux-appimage` | `dist/aiopsterm-<version>-linux-<arch>.AppImage` |
| `linux-deb` | Linux | `npm run package:build -- linux-deb` | `dist/aiopsterm-<version>-linux-amd64.deb` on x64 |
| `macos` | macOS | `npm run package:build -- macos` | `dist/aiopsterm-<version>-macos-<arch>.dmg` and `.zip` |
| `windows` | Windows | `npm run package:build -- windows` | `dist/aiopsterm-<version>-setup-<arch>.exe` |

`package:build` refuses to build a target on the wrong host platform and removes that target's previous artifact/unpacked output before invoking the platform package script. `package:build:matrix` builds every target supported by the current host when no targets are passed, or the named targets when arguments are provided:

```bash
npm run package:build:matrix
npm run package:build:matrix -- linux-appimage linux-deb
```

After building a target on its native runner, run:

```bash
npm run package:verify -- linux-appimage
npm run package:verify -- linux-deb
npm run package:verify -- macos
npm run package:verify -- windows
```

`package:verify` refuses to verify a target on the wrong host platform. On the target host it runs `audit:package-config`, `audit:packaged-app`, and `smoke:packaged`, then runs the split Linux installer audit for `linux-appimage` or `linux-deb`, and finally checks that the expected artifact exists.

`audit:codex-runtime` checks the generated Codex package before app packaging. It requires `codex-package.json`, the platform entrypoint (`bin/codex` or `bin/codex.exe`), bundled `rg` or `rg.exe`, Linux `bwrap`, and Windows `codex-resources/codex-command-runner.exe` plus `codex-resources/codex-windows-sandbox-setup.exe`; on Linux it also rejects unresolved dynamic dependencies and OpenSSL 1.1 dynamic links such as `libssl.so.1.1` / `libcrypto.so.1.1`.

On Linux, the Codex musl package build requires the native release toolchain used by Codex: `ca-certificates curl musl-tools pkg-config libcap-dev g++ clang libc++-dev libc++abi-dev lld xz-utils`. CI jobs may provide prebuilt helper binaries through `AIOPSTERM_CODEX_BWRAP_BIN` and `AIOPSTERM_CODEX_RG_BIN`, but the package entrypoint must still come from this repository's local modified `codex/` source unless `AIOPSTERM_CODEX_PACKAGE_DIR` is intentionally supplied. The Codex package builder downloads Codex-built V8 artifacts from OpenAI Codex releases by default; offline or restricted runners should preconfigure `RUSTY_V8_ARCHIVE` and `RUSTY_V8_SRC_BINDING_PATH`.

On macOS, `build:codex` runs the same POSIX package builder on the native macOS runner. It writes the generated package under `codex/codex-rs/target/x86_64-apple-darwin/aiopsterm-codex-package` on Intel runners or `codex/codex-rs/target/aarch64-apple-darwin/aiopsterm-codex-package` on Apple Silicon runners. Build and verify each architecture on its matching macOS runner unless a separate universal-binary release plan is introduced.

On Windows, `build:codex` does not run the POSIX shell builder. The Node entrypoint builds the Codex package from the local `codex/` source tree by invoking Codex's `scripts/build_codex_package.py` for `x86_64-pc-windows-msvc` on x64 runners or `aarch64-pc-windows-msvc` on arm64 runners. The generated package is written under `codex/codex-rs/target/x86_64-pc-windows-msvc/aiopsterm-codex-package` or `codex/codex-rs/target/aarch64-pc-windows-msvc/aiopsterm-codex-package`.

Windows source packaging requires a native Windows runner with Python 3, rustup, and the MSVC C++ build tools/Windows SDK available for Cargo. The builder reads `codex/codex-rs/rust-toolchain.toml`, installs that toolchain and the Windows Rust target through rustup when needed, passes the rustup-managed Cargo executable to Codex's package builder, and lets Codex build `codex.exe`, `codex-command-runner.exe`, and `codex-windows-sandbox-setup.exe`. Codex's package builder resolves `rg.exe`; CI may override helper resources with `AIOPSTERM_CODEX_RG_BIN`, `AIOPSTERM_CODEX_COMMAND_RUNNER_BIN`, and `AIOPSTERM_CODEX_WINDOWS_SANDBOX_SETUP_BIN`.

Complete package overrides are still supported for caches or custom CI inputs. Set `AIOPSTERM_CODEX_PACKAGE_DIR` to a package directory that contains `codex-package.json`, `bin/codex.exe`, `codex-path/rg.exe`, and the two Windows helper executables, or set `AIOPSTERM_CODEX_BIN` to the package entrypoint under `<package>/bin/codex.exe`.

After building the full Linux package set with `npm run build:linux`, run the package-level checks:

```bash
npm run smoke:packaged
npm run audit:linux-package
```

`smoke:packaged` launches `dist/linux-unpacked/aiopsterm` under Xvfb with an isolated temporary user-data directory, waits for the main window, and verifies that the local shell tab and terminal output area render.

`smoke:packaged` now chooses the unpacked app path for the current platform by default:

- Linux: `dist/linux-unpacked/aiopsterm`
- macOS: `dist/mac/aiopsterm.app/Contents/MacOS/aiopsterm`
- Windows: `dist/win-unpacked/aiopsterm.exe`

On Linux without `DISPLAY`, the script attempts to re-run itself under `xvfb-run` when that command is available. You can pass an explicit executable path as the first argument.

The packaged Playwright check exercises the packaged executable more deeply:

```bash
npm run test:e2e:packaged
```

It launches the current platform's unpacked packaged app through Playwright Electron with an isolated `AIOPSTERM_USER_DATA_DIR`, waits for the main window, verifies that the local terminal and Files module are reachable, and calls `notification.create` plus `notification.list` through the packaged control socket or Windows named pipe. Override the executable with `AIOPSTERM_PACKAGED_APP=/path/to/app`; override the control endpoint with `AIOPSTERM_PACKAGED_CONTROL_SOCKET=...` when debugging a custom package layout.

After a directory or full package build on any platform, run the unpacked resource audit:

```bash
npm run audit:packaged-app
```

`audit:packaged-app` checks the current platform's unpacked app resources, the packaged Codex package, the platform `rg` helper name, and the platform `node-pty` runtime files. It requires an Electron-only `better-sqlite3` native manifest, verifies that exactly one ABI-keyed SQLite binding remains, rejects every earlier `bindings` lookup candidate, checks the binding SHA-256, and launches the packaged Electron executable in Node mode to execute a real in-memory `SELECT 1`. It also requires every Cline sidecar runtime, bundle, manifest, SBOM, metafile, notice, and license artifact, executes the packaged Node `--version`, and validates the distributable manifest boundary. It does not replace `audit:linux-package` for Linux installer/deb/AppImage checks.

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

After an AppImage-only build with `npm run build:linux:appimage`, run:

```bash
npm run audit:linux-appimage
```

After a deb-only build with `npm run build:deb`, run:

```bash
npm run audit:linux-deb
```

macOS packaging is configured with:

```bash
npm run build:mac
npm run build:mac:dir
```

Run those commands on macOS. Linux development machines can audit the macOS target configuration with `npm run audit:package-config`, but they should not be treated as successful macOS packaging runners.

Windows packaging is configured with:

```bash
npm run build:win
npm run build:win:dir
```

Run those commands on Windows so the native Windows Codex package, native modules, and NSIS target are built on the correct platform. Linux development machines can audit the Windows target configuration with `npm run audit:package-config`, but they should not be treated as successful Windows packaging runners.

On a Windows machine without remote CI, `scripts/build-windows.ps1` is the supported local orchestration entrypoint. It uses official sources by default, accepts `-ChinaMirror` as a process-local opt-in, and finishes with the same `package:build -- windows` and `package:verify -- windows` gates documented above.
