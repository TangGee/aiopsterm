# Control CLI Tutorial

`aio` 是 aiopsterm 的本地控制命令，用来从终端控制当前 aiopsterm UI。它适合脚本、Agent、排障命令和轻量自动化，例如查看当前工作区、读取终端屏幕、聚焦面板、发送通知、跳转到待处理 AI 会话。

## Command Names

aiopsterm 创建的本地终端会自动把这些命令加入 `PATH`：

- `aio`：推荐使用的短命令。
- `aictl`：语义更明确的兼容别名。
- `aiopsterm-control`：长兼容别名。
- `aiopen`：在 aiopsterm 主工作区文件编辑器中打开本地文本文件。
- `aiossh`：快速连接已管理主机，等价于 `aio ssh <host>`。
- `aioic`：按工作区空闲清理设置关闭符合条件的面板。
- `aiobc`：立即关闭后台面板，只保留当前面板。

普通用户和脚本优先写 `aio`：

```bash
aio context
aio surface list
aio terminal list
aio settings open --target ai-notifications
aiossh prod-bastion
aiobc
```

底层 helper 文件仍然是 `resources/aiopsterm-control.js`，但不需要手动输入 Electron runtime 启动串。`aio` 包装命令会在内部使用 aiopsterm 自带的 JavaScript runtime，不依赖系统 `node`。

## Where It Works

`aio` 默认只在 aiopsterm 自己创建的本地终端里可用。这类终端会自动带上：

- `AIOPSTERM_CONTROL_SOCKET`
- `AIOPSTERM_JS_RUNTIME`
- `AIOPSTERM_CONTROL_HELPER_PATH`
- `AIOPSTERM_CONTROL_COMMAND=aio`

SSH 远端 shell 通常不会有这些本地控制变量。要控制 SSH 面板时，建议在 aiopsterm 本地终端里运行 `aio`，再通过 panel/session id 操作目标终端。

## Quick Start

查看当前上下文：

```bash
aio context
```

查看命令帮助：

```bash
aio help
```

列出当前可见 surface：

```bash
aio surface list
```

列出终端：

```bash
aio terminal list
```

查看可复制的命令示例：

```bash
aio recipes
aio recipes terminal
aio recipes agent
```

需要机器可读输出时加 `--json`：

```bash
aio --json workspace snapshot
aio --json terminal list
```

## Terminal Tasks

读取当前终端屏幕：

```bash
aio terminal read-screen --lines 80
```

读取指定 panel：

```bash
aio terminal read-screen --panel <panel-id> --lines 80
```

聚焦指定终端：

```bash
aio terminal focus --panel <panel-id>
```

向终端发送文本：

```bash
aio terminal send --session "$AIOPSTERM_TERMINAL_SESSION_ID" --text $'pwd\n'
```

向指定 panel 发送命令：

```bash
aio terminal send --panel <panel-id> --text $'uptime\n'
```

发送按键：

```bash
aio terminal send-key --panel <panel-id> ctrl+c
aio terminal send-key --panel <panel-id> enter
```

抓取更多面板内容：

```bash
aio capture-pane --panel <panel-id> --lines 200
aio capture-pane --panel <panel-id> --scrollback --lines 500
```

`terminal send` 等价于用户在终端里输入文本。它是原始输入能力，不会经过 AI 命令审批流程；只在明确知道目标终端和要发送内容时使用。

## Workspace Cleanup

立即关闭所有后台面板并保留当前面板：

```bash
aiobc
```

该短命令等价于：

```bash
aio workspace action close_others
```

成功时输出 `background-cleanup`、已关闭数量和跳过数量。需要按空闲时长与工作区清理设置筛选时使用 `aioic`；它不会执行同样的立即全量后台清理。

## Local File Editing

`aiopen` 使用 aiopsterm 主工作区的文件编辑器打开本地文本文件。相对路径以执行命令时的当前目录为基准，绝对路径直接使用：

```bash
aiopen ./src/main.ts
aiopen /var/log/example.log
```

一次可以打开多个文件：

```bash
aiopen ./src/main.ts ./src/config.ts /tmp/debug.log
```

每个文件会成为一个主工作区标签页，并使用与 AI 项目文件相同的自动保存、失焦保存、磁盘变更监听和冲突处理。已经打开的同一路径会复用原标签页。

`aiopen` 只接受已经存在的本地文本文件。目录、不存在的文件、二进制文件和超过 2 MiB 的文件会失败。如果一组路径中只有部分文件无效，有效文件仍会打开，但命令退出码为非零，并在标准错误中逐项输出失败原因。

在 aiopsterm 管理的本地终端中，`aiopen` 会自动加入 `PATH`。从普通系统终端调用打包控制 helper 时，需要显式指定当前实例的控制套接字：

```bash
ELECTRON_RUN_AS_NODE=1 <aiopsterm-executable> <helper-path> \
  --socket <control-socket-path> aiopen ./src/main.ts
```

## SSH Remote Panels

已在主机管理里保存过的主机，优先用短命令：

```bash
aiossh prod-bastion
aio ssh prod-bastion
```

`aiossh <managed-host>` 只匹配已管理主机的 `name`、`title`、`host`、`ip`、`id` 或 `uuid`。如果目标主机已经有可见 SSH 面板，aiopsterm 会直接定位并复用；如果没有打开，就新建一个可见 SSH 面板并连接。名称前缀匹配到多个主机时会返回歧义错误，不会随便选一个。

列出已管理主机：

```bash
aio host list
aio host list --prefix prod
aio host list --names
```

新增主机走单独命令，不混在 `aiossh` 里：

```bash
aio host add prod-bastion --host 10.24.8.12 --user ops --port 22 --group 生产
```

`host add` 保存的是主机元数据。不要把密码写进命令行；密码、私钥、keychain 等敏感信息应继续走设置页或已有凭据管理流程。

也可以使用通用 SSH 面板配置命令连接临时地址。入口是 `workspace remote configure`，加 `--connect` 后立即连接：

```bash
aio workspace remote configure root@10.0.0.8 --port 22 --title prod-1 --connect
```

也可以拆开 host 和 user：

```bash
aio workspace remote configure --host 10.0.0.8 --user root --port 22 --title prod-1 --connect
```

指定连接到已有面板：

```bash
aio workspace remote configure root@10.0.0.8 --panel <panel-id> --connect
```

不指定 `--panel` / `--surface` 时，aiopsterm 会优先找合适的空 SSH 面板，找不到就新建一个。需要密码、OTP 或 keyboard-interactive 二次认证时，会走 aiopsterm 正常 SSH 登录流程。

查看和控制 SSH 面板：

```bash
aio workspace remote status
aio workspace remote reconnect --panel <panel-id>
aio workspace remote disconnect --panel <panel-id>
aio workspace remote disconnect --panel <panel-id> --clear
```

连接后仍然用普通终端命令读写这个 SSH 终端：

```bash
aio terminal read-screen --panel <panel-id> --lines 80
aio terminal send --panel <panel-id> --text $'hostname\n'
```

## Settings

打开设置页：

```bash
aio settings open
aio settings open --target terminal
aio settings open --target ai-notifications
```

`settings open` 只负责打开 Settings 模块并切换到指定设置页，不直接修改配置值。常用 target：

```text
general
terminal
extensions
models
billing
aiNotifications / ai-notifications
aiRemoteHostManagement / ai-remote-host-management / ai
mcp
exportMcp / export-mcp
skills
rules
shortcuts
trustedDevices / trusted-devices
privacy
about
docs
```

也可以写成：

```bash
aio settings open terminal
aio settings open --section shortcuts
aio settings open --page privacy
```

查询和修改配置值：

```bash
aio settings get terminal.fontSize
aio settings get terminal.fontSize --raw
aio settings put terminal.fontSize 15
aio settings put theme dark
aio settings put background.opacity 0.8
```

`settings get/put` 使用点号路径，只支持普通配置 key，例如 `terminal.fontSize`、`theme`、`background.opacity`。`put` 会先按 JSON 解析值，`15` 会保存成数字，`false` 会保存成布尔值，解析不了的内容按字符串保存。

## Shell Completion

`aio`、`aictl`、`aiopsterm-control` 和 `aiossh` 都提供 bash、zsh、fish 补全脚本。补全覆盖所有 `aio` 命令路径：顶层命令、嵌套子命令和常用选项都会按当前光标位置给出候选。`aio ` 后直接按 Tab 只展示常用主入口，避免把兼容别名和高级控制命令一次性全部展开；输入前缀后仍可补全完整命令集。`aiossh <managed-host>` 和 `aio ssh <managed-host>` 的主机候选会动态读取本地资产库，所以输入一半再按 Tab 可以补全已管理主机：

```bash
source <(aio completion bash)
```

zsh：

```zsh
source <(aio completion zsh)
```

fish：

```fish
aio completion fish | source
```

aiopsterm 创建的本地终端会自动加载补全。普通系统终端可以手动 source 上面的脚本。动态主机补全依赖当前 shell 能访问 `AIOPSTERM_CONTROL_SOCKET`；命令和选项补全不需要 socket。

如果 `aio ` 后按 Tab 没有候选，先确认当前 shell 已注册补全：

```bash
complete -p aio
```

没有输出时，说明补全脚本没有加载，可以手动执行：

```bash
source <(aio completion bash)
```

也可以直接检查补全核心是否能返回顶层命令：

```bash
aio complete cli --index 1 -- aio
```

这条命令应输出 `help`、`terminal`、`settings`、`ssh` 等常用顶层候选。如果这里有输出而 Tab 没提示，问题在当前 shell 的 completion 加载；如果这里也没输出，再检查 `aio` 命令路径和环境变量。

## Notifications

发送一条通知：

```bash
aio notify --source ci --level warning --title "Build needs review" --body "npm test failed"
```

查看未读通知：

```bash
aio list-notifications --unread
```

跳到最新未读通知：

```bash
aio jump-to-unread
```

## AI Sessions

查看需要用户处理的 AI 会话：

```bash
aio agent session list --needs-input
```

查看 feed：

```bash
aio feed list
```

跳到某个待处理项：

```bash
aio feed jump <id>
```

这些命令用于定位和处理已有会话，不会自动替用户批准权限请求或回答问题。

## Raw RPC

高级脚本可以直接调用控制协议方法：

```bash
aio rpc terminal.list --params-json '{"limit":2}'
```

`rpc` 不会绕过安全边界。它只是把指定 method 和 JSON 参数发到同一个本地 Control Socket，由对应 dispatcher 决定是否允许和如何执行。

## Troubleshooting

如果提示 `aio: command not found`，通常说明当前 shell 不是 aiopsterm 新创建的本地终端。打开一个新的本地终端后再试：

```bash
echo "$AIOPSTERM_CONTROL_COMMAND"
aio context
```

如果提示 `AIOPSTERM_CONTROL_SOCKET is not set`，说明当前 shell 没有连接到 aiopsterm 的本地控制 socket。普通使用场景下不要手动拼底层长命令，优先从 aiopsterm 本地终端执行 `aio`。

如果输入了不存在的命令，`aio` 会输出可读错误并提示运行 `aio help`，不会打印 Node.js 调用栈。需要脚本解析错误时可以加 `--json`：

```bash
aio --json missing-command
```

更多协议细节见 [Control Socket](../technical/control-socket.md)。
