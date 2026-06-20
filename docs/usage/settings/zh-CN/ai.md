# AI 偏好设置

本页控制普通 AI 对话和 Agent 回环的运行偏好。

## Agent Hook 安装器

- 会话管理 Hook：把 aiopsterm 的 Hook Helper 显式写入支持的 Agent 用户级 Hook 配置，用于让左侧 `AI 会话` 面板发现通过 aiopsterm 本地连接终端启动的 AI 会话。
- CLI：显示是否在当前 `PATH` 中检测到对应命令，例如 `codex`、`claude`、`cursor-agent`、`gemini`、`copilot`、`grok`、`opencode`、`codebuddy`、`droid`、`qodercli`、`amp`、`pi`、`omp`、`kiro-cli`、`acli`。未检测到时需要先安装对应 CLI，或确认启动 aiopsterm 的环境能访问该命令。
- Hook 配置：Codex 使用 `~/.codex/hooks.json`，Claude Code 使用 `~/.claude/settings.json`。Cursor、Gemini、Copilot、Grok、OpenCode、CodeBuddy、Factory、Qoder、Amp、Pi、OMP、Kiro、Rovo Dev 使用各自 Hook/插件配置。安装器只插入带 aiopsterm marker 的命令，不删除其它用户 Hook。
- 附加配置：Codex 还会在 `~/.codex/config.toml` 的 aiopsterm 标记块内启用 hooks feature。卸载时会移除该标记块，并尽量恢复安装前的 `hooks` 配置行。
- Hook Helper：显示当前应用打包出的 `aiopsterm-agent-hook.js` 路径。Hook 命令通过 `node` 调用它，避免依赖脚本可执行位。
- 安装 / 重新安装：先清理旧的 aiopsterm-owned Hook 命令，再写入当前 Helper 路径。不会静默执行，必须在设置页显式点击。
- 卸载：只移除 aiopsterm-owned Hook 命令；同一事件里其它 Hook，例如用户自己的审计或通知 Hook，会保留。
- 生效范围：Hook Helper 只有在 `AIOPSTERM_MANAGED_TERMINAL=1` 且存在 `AIOPSTERM_AGENT_SOCKET_PATH` 的 aiopsterm 本地连接终端里才会上报事件。外部系统终端会输出 `{}` 并正常退出，不接管 Agent 原生审批。
- 管理能力：会话会持久保存到应用数据目录，左侧面板可查看事件流、处理记录、手动重命名、标记已处理、清理已结束会话。`允许`、`拒绝`、`回复` 是 aiopsterm 的本地管理记录，不伪装成 Agent 原生阻塞审批。

## AI 会话休眠

- 启用 Agent Hibernation：允许 aiopsterm 在后台 AI 会话过多时休眠符合条件的本地连接终端。休眠只针对可恢复的 AI 会话，不会处理当前可见终端、正在等待输入的会话或缺少恢复命令的会话。
- 空闲时间（秒）：终端最后活动超过该秒数后才会成为休眠候选。范围是 `5` 到 `604800` 秒。
- 最大活跃终端数：可恢复 AI 终端数量超过该值后，后台最旧的候选才会进入休眠流程。范围是 `1` 到 `256`。
- 确认倒计时（秒）：休眠前在界面中保留确认窗口的时间。设置为 `0` 表示符合条件后直接休眠后台候选。范围是 `0` 到 `3600` 秒。
- 恢复方式：休眠后的会话仍保留在 AI 会话面板里，使用保存的 `resumeCommand` 从 aiopsterm 本地连接终端恢复。

## 通知

- 桌面通知：控制外部通知协议和 AI 会话事件是否触发系统桌面通知。关闭后，应用内通知列表、AI 会话面板和事件记录仍会保留。
- 顶部铃铛提醒控制通知：控制外部通知协议产生的未读通知是否进入顶部铃铛队列。AI 会话审批、问题和待处理提醒始终保留，避免误关关键交互。

## 自动化与开发者

- Control Socket：aiopsterm 本地连接终端会注入 `AIOPSTERM_CONTROL_SOCKET`。脚本和 CLI 可以通过该 socket 调用控制协议，例如发送通知、列出通知、打开通知或操作受管 AI 会话。
- CLI Helper：`resources/aiopsterm-control.js` 是控制协议的 Node.js helper。它需要在带 `AIOPSTERM_CONTROL_SOCKET` 的环境里运行，通常也就是 aiopsterm 的本地连接终端。
- External Codex MCP：给外部 Codex 使用的 MCP 桥接服务。它不绑定某个终端，适合从系统终端里的 Codex 管理 aiopsterm 主机和会话能力。
- `AIOPSTERM_EXTERNAL_CODEX_MCP_ENABLE=1`：启用外部 Codex MCP 桥接服务。该项是启动环境变量，修改后需要重启 aiopsterm。
- `AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN`：可选访问令牌。设置后外部 MCP 客户端必须使用同一个 token。
- `AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET`：可选 socket 路径。未设置时使用应用数据目录中的默认 socket 路径。
- 控制协议文档：打开 [Control Socket](../../../technical/control-socket.md) 查看 `notify`、`list-notifications`、自动化请求和通知字段说明。
- 外部 Codex MCP 文档：打开 [External Codex MCP](../../../technical/external-codex-mcp.md) 查看给外部 Codex 的 MCP 配置方式。

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
