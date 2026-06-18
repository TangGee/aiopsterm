# AI 偏好设置

本页控制普通 AI 对话和 Agent 回环的运行偏好。

## Agent Hook 安装器

- Codex / Claude Code 会话管理 Hook：把 aiopsterm 的 Hook Helper 显式写入 Codex 或 Claude Code 的用户级 Hook 配置，用于让左侧 `AI 会话` 面板发现通过 aiopsterm 本地连接终端启动的 AI 会话。
- CLI：显示是否在当前 `PATH` 中检测到 `codex` 或 `claude` 命令。未检测到时需要先安装对应 CLI，或确认启动 aiopsterm 的环境能访问该命令。
- Hook 配置：Codex 使用 `~/.codex/hooks.json`，Claude Code 使用 `~/.claude/settings.json`。安装器只插入带 aiopsterm marker 的命令，不删除其它用户 Hook。
- 附加配置：Codex 还会在 `~/.codex/config.toml` 的 aiopsterm 标记块内启用 hooks feature。卸载时会移除该标记块，并尽量恢复安装前的 `hooks` 配置行。
- Hook Helper：显示当前应用打包出的 `aiopsterm-agent-hook.js` 路径。Hook 命令通过 `node` 调用它，避免依赖脚本可执行位。
- 安装 / 重新安装：先清理旧的 aiopsterm-owned Hook 命令，再写入当前 Helper 路径。不会静默执行，必须在设置页显式点击。
- 卸载：只移除 aiopsterm-owned Hook 命令；同一事件里其它 Hook，例如用户自己的审计或通知 Hook，会保留。
- 生效范围：Hook Helper 只有在 `AIOPSTERM_MANAGED_TERMINAL=1` 且存在 `AIOPSTERM_AGENT_SOCKET_PATH` 的 aiopsterm 本地连接终端里才会上报事件。外部系统终端会输出 `{}` 并正常退出，不接管 Codex/Claude 原生审批。

## 通用

- 启用 Extended Thinking：开启后，AI 请求会使用额外推理预算相关配置。
- Budget：Extended Thinking 的 token 预算。预算越高，模型可用于推理的 token 越多，但请求成本和耗时也可能增加。
- 自动执行只读命令：允许低风险只读命令在确认范围内自动执行。它不会绕过高风险命令审批。
- 命令输出过滤：Agent 回传长命令输出时压缩中间部分，界面仍保留完整输出。
- 知识库搜索：普通 AI 对话发送前自动检索并附加相关知识库文档。
- 经验抽取：控制 AI 回答中是否提炼可复用运维经验。
- 自动批准：只允许低风险只读动作自动通过，不跳过高风险命令审批。
- 安全配置：打开 `security-config.json` 编辑器，用于维护命令安全策略、黑名单、白名单和风险审批规则。

## 功能

- OpenAI Reasoning Effort：设置 OpenAI 模型的推理强度。`低` 更快更省，`高` 更偏向复杂推理。

## AI 模型代理

- 启用代理：控制 AI 模型 API 请求是否通过代理访问。
- 代理类型：选择 HTTP、HTTPS、SOCKS4 或 SOCKS5。
- Host：代理服务器地址。
- Port：代理服务器端口。
- 启用代理身份：代理需要用户名密码时开启。
- Username / Password：代理身份认证凭据。

## 终端

- Shell Integration Timeout：Agent 等待终端命令输出的默认超时时间，单位为秒。命令运行时间超过该值后，Agent 可能停止等待更多输出。
