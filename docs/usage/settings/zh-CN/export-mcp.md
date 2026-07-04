# 导出 MCP

本页位于 `设置 -> 导出 MCP`，用于把 aiopsterm 的主机连接、会话和工具能力导出成外部 MCP server。外部 Codex、Claude Code 或其他支持 MCP 的 Agent 可以通过这个 server 调用 aiopsterm 的主机网关、会话和工具接口。

## 前置条件

导出 MCP 由 aiopsterm 启动环境变量控制：

```bash
export AIOPSTERM_EXTERNAL_CODEX_MCP_ENABLE=1
```

token 默认由 aiopsterm 在首次使用时生成并保存到应用数据目录下的 `external-codex-mcp/token.json`，文件权限会尽量设置为仅当前用户可读写。`AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN` 仍可作为显式覆盖；设置后需要重启 aiopsterm，并且设置页的“重新生成 Token”不会覆盖该环境变量。

`AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET` 可选；不设置时，aiopsterm 会在应用数据目录下创建稳定 socket：Unix-like 系统为 `external-codex-mcp/aiopsterm-external-codex.sock`，Windows 为 `\\.\pipe\aiopsterm-external-codex`。修改这些环境变量后需要重启 aiopsterm。

## SSH 认证体验

导出 MCP 的 `connect_host` 是 headless 连接，但现在会复用 aiopsterm 的 SSH 认证弹窗。目标主机优先通过已保存密码、私钥、Keychain、SSH Agent 或当前进程内已认证连接完成非交互式认证；如果直连、标准跳板机或目标主机要求现场输入 SSH 密码、OTP 或 keyboard-interactive 二次认证，MCP 会返回 `SSH_AUTH_REQUIRED`，并在 `errorMessage` 中明确提示用户回到 aiopsterm 完成认证。

外部 Agent 可以调用 `list_auth_requests`、`get_auth_request_status` 和 `focus_auth_request` 查询或聚焦认证请求。默认情况下，密码和验证码仍由用户在 aiopsterm 内输入，外部 Agent 只收到请求 id、目标主机、认证类型和本地化提示，不会收到密码或验证码。

如果确实信任本机外部 Agent，可以在本页开启 `允许外部 Agent 提交 SSH 认证信息`。开启后，外部 Agent 可调用 `submit_ssh_auth_response` 提交密码、验证码或 keyboard-interactive 响应；关闭时该 tool 会返回本地化错误，提示用户可以在 `设置 -> 导出 MCP` 开启该能力，或直接回 aiopsterm 完成认证。

relay-shell 后再 `ssh` 的文本密码提示仍不是结构化 SSH 认证事件。它只在 relay 登录和二次 `ssh` 都不需要交互输入时可用；需要动态口令、密码或 host-key 确认的 relay 流程请使用 aiopsterm 的可见终端完成。

## 为什么需要 Token

导出 MCP 不是普通状态读取接口。外部 Agent 连接后可以通过 aiopsterm 的主机网关、会话和工具接口发起操作，因此稳定 socket 路径只负责定位服务，不能作为认证边界。

token 用来证明调用方是被授权的外部 MCP 客户端。即使 socket 只在本机，本机同一用户下的其他进程也可能尝试连接；安装器会把当前 token 写入 Codex 或 Claude Code 的 MCP 环境变量。

手动复制配置会把完整配置写入系统剪贴板，其中包含当前 token。用户主动复制并粘贴到外部 Agent 后，该配置由用户本机环境负责；请只粘贴到可信 Agent。

## 内置安装器

内置安装器会检测本机 CLI 和配置状态，并只管理名为 `aiopsterm_hosts` 的 MCP server 条目。

- Codex：调用 `codex mcp remove aiopsterm_hosts` 后再调用 `codex mcp add aiopsterm_hosts --env ... -- <aiopsterm-runtime> <helper>`，并写入 `ELECTRON_RUN_AS_NODE=1`。
- Claude Code：调用 `claude mcp remove -s user aiopsterm_hosts` 后再调用 `claude mcp add -s user aiopsterm_hosts -e ... -- <aiopsterm-runtime> <helper>`，并写入 `ELECTRON_RUN_AS_NODE=1`。

安装按钮不会直接手写 Codex 或 Claude Code 配置文件；配置文件只用于状态探测和冲突提示。

如果页面提示已有 `aiopsterm_hosts` 但与当前导出 MCP 设置不匹配，通常是旧配置写入了带进程号的 socket 路径，或 token 已重新生成；重新安装即可刷新为当前稳定 socket 和 token。

`重新生成 Token` 会立即让已安装或已复制的外部 Agent 配置失效。Codex / Claude Code 需要重新安装，其他 Agent 需要重新复制配置。

## 其他 Agent 手动配置

非常见 Agent 不一定有稳定的 MCP CLI。此时使用 `其他 Agent 手动配置` 区域：

- `复制 JSON 模板`：适合支持 `mcpServers` JSON 配置的 Agent。
- `复制 stdio 命令模板`：适合支持手动填写 stdio command/env 的 Agent。

页面预览会用占位符隐藏 token，但复制按钮写入剪贴板的是完整配置，包含当前 token。重新生成 token 后需要重新复制。

如果开启了 `允许外部 Agent 提交 SSH 认证信息`，手动配置的 Agent 也会获得 `submit_ssh_auth_response` tool。请只把包含 token 的配置粘贴到可信 Agent，因为该 Agent 理论上可以提交你交给它的认证响应。

## 状态含义

- 服务：展示导出桥接服务是否启用、是否正在监听。
- Token：展示当前进程是否有可用 token；未配置时安装按钮会禁用。
- Socket：外部 MCP helper 连接 aiopsterm 的本地 socket 路径。
- MCP Helper：外部客户端实际启动的 `aiopsterm-external-codex-mcp.js` 路径。
- JS Runtime：外部客户端启动 helper 时使用的 aiopsterm 可执行文件路径，不依赖系统 `node`。
