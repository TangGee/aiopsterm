# Package Verification

After building Linux packages with `npm run build:linux`, run the package-level checks:

```bash
npm run smoke:packaged
npm run audit:linux-package
```

`smoke:packaged` launches `dist/linux-unpacked/aiopsterm` under Xvfb with an isolated temporary user-data directory, waits for the main window, and verifies that the local shell tab and terminal output area render.

`audit:linux-package` checks the Linux build output without launching the app. It verifies:

- the expected AppImage, deb, `app.asar`, and `app.asar.unpacked` files exist for the current package version
- packaged `node-pty` still includes `build/Release/pty.node`, runtime JS, package metadata, and license
- packaged `node-pty` no longer includes build-only directories such as `bin`, `scripts`, `src`, `deps`, `prebuilds`, or test files
- the deb desktop file registers `MimeType=x-scheme-handler/aiopsterm;`
- the deb desktop file keeps `%U` URL argument handling in its `Exec` line

These checks assume Linux tooling is available, including `xvfb-run` for the packaged smoke test and `dpkg-deb` for deb metadata extraction.
