# CI 构建与本地签名

本流程让 GitHub Actions 编译应用并测试待签名产物，再在本地 Mac 或 Windows 上签名和生成最终安装包。证书私钥保留在签名机器；Linux 直接提供 AppImage、DEB 和 SHA-256 校验文件。

## 在 GitHub 构建

工作流文件为 `.github/workflows/build-installers.yml`，名称为 **Build installers for local signing**。工作流进入默认分支后，可以在 Actions 中手动运行，选择 `all`、`linux`、`windows` 或 `macos`。也可以使用已登录的 GitHub CLI：

```bash
gh workflow run build-installers.yml --repo TangGee/aiopsterm --ref master -f platform=all
gh run list --repo TangGee/aiopsterm --workflow build-installers.yml
```

每个平台使用对应原生 runner。Linux 构建使用 Ubuntu 20.04 容器基线；架构以当次 runner 和产物清单为准。CI 构建 Codex、sidecar 和桌面应用，执行打包审计及 packaged 回归，再导出待签名输入。Mac 的 CI 产物使用 ad-hoc 签名，Windows 的 CI 产物不包含正式签名。

成功后可以下载：

- `signing-macOS-ARM64` 或对应架构的待签名输入。
- `signing-Windows-X64` 或对应架构的待签名输入。
- `release-Linux` 中的 Linux 安装包、来源记录和 `SHA256SUMS-linux.txt`。
- `release-macOS`、`release-Windows` 中供检查的 CI 安装包。这些不是本地签名完成后的正式发布包。

待签名输入保留 14 天，CI 安装包保留 7 天。工作流和本地脚本均不自动发布 GitHub Release。

## 下载并校验输入

在包含这些脚本的项目 checkout 中安装依赖。使用当次构建提交对应的源码和 lockfile；安装依赖不需要重新编译应用源码。下载机器需要 Node.js、GitHub CLI 和 tar，并通过 `gh auth login` 获得仓库访问权限。

下面的 `RUN_ID` 替换为工作流运行编号，输出目录必须尚不存在，其父目录需要存在：

```bash
npm ci
mkdir -p .cache/signing
npm run release:download -- RUN_ID --platform darwin --arch arm64 --output .cache/signing/mac-input
```

Windows x64 输入使用 `--platform win32 --arch x64`。可以在 Linux 下载其他平台的输入，再通过保留符号链接和权限的归档传输到签名机。

下载器只接受该仓库成功完成的指定构建工作流，核对压缩包校验值、文件清单和应用内部编译来源，然后输出完整提交 SHA。签名命令中的 `--commit` 必须使用这个 40 位 SHA。

## 在 Mac 上签名

需要 Xcode 命令行工具、有效的 `Developer ID Application` 证书、可用的私钥，以及默认名为 `aiopsterm-notary` 的 notarytool Keychain 凭据。其他公证凭据名可通过 `--notary-profile` 指定。凭据配置参见[安装包验证](package-verification.md)。

SSH 登录后，登录钥匙串可能仍处于锁定状态。以下命令通过交互提示解锁，不把密码写入命令参数：

```bash
security unlock-keychain
security find-identity -v -p codesigning
npm run release:sign -- .cache/signing/mac-input --commit FULL_COMMIT_SHA --identity "Developer ID Application: YOUR NAME (TEAM_ID)" --check
npm run release:sign -- .cache/signing/mac-input --commit FULL_COMMIT_SHA --identity "Developer ID Application: YOUR NAME (TEAM_ID)" --output dist/signed-mac
```

`--check` 仅检查输入、工具和公证凭据，不执行签名。实际执行会复制输入、签名应用及内部组件、公证应用、生成 DMG/ZIP，再签名和公证 DMG，校验附加票据及 Gatekeeper 结果。最后运行签名应用的 packaged 测试，并检查测试前后应用目录未被修改。

## 在 Windows 上签名

在拥有证书的已登录用户会话中执行。证书必须位于该用户的 `CurrentUser/My` 存储区并具有私钥；虚拟机 Guest Agent 的 SYSTEM 会话不等同于该用户。SimplySign 等签名提供程序需要先完成登录或 Token 确认，动态验证码只在提供程序界面输入。

安装 Windows SDK SignTool。脚本自动查找 SDK 中的工具，也可通过环境变量 `AIOPSTERM_SIGNTOOL` 指定路径。PowerShell 示例：

```powershell
Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Select-Object Subject, Thumbprint, HasPrivateKey
npm run release:sign -- .cache/signing/windows-input --commit FULL_COMMIT_SHA --identity CERTIFICATE_THUMBPRINT --check
npm run release:sign -- .cache/signing/windows-input --commit FULL_COMMIT_SHA --identity CERTIFICATE_THUMBPRINT --output dist/signed-windows
```

正式执行会签名应用目录中的 EXE、DLL 和 NODE 文件，生成 NSIS 安装器，并通过自定义签名回调签名卸载器和安装器。每次签名都校验发布者、有效性及时间戳；单次签名超过 180 秒会失败。安装器生成后运行签名应用的 packaged 测试。

## 判断是否完成

只有签名、平台验证和应用测试全部成功，输出目录才会出现 `signed-release.json` 和 `SHA256SUMS.txt`。来源记录关联输入清单、构建提交、签名身份、最终安装包哈希和应用目录清单。

输出目录必须是新目录，脚本不覆盖旧发布包，也不修改下载的输入。失败时可能留下不完整的输出目录；排除故障后选择新的输出目录重试。目录中存在一个 EXE 或 DMG 并不代表整条流程成功。

签名和附加公证票据会改变安装包哈希。本流程移除打包器较早生成的更新清单及 blockmap，只交付独立安装包和最终 SHA-256 清单。完整源码本地编译的其他入口仍见[安装包验证](package-verification.md)。
