# AI 通知

本页控制 AI 会话被发现、提醒和休眠的行为，以及外部通知协议产生的提醒和本地连接终端里的通知自动化入口。

按用户场景配置请看 [AI 会话管理](../../best-practices/zh-CN/05-ai-sessions.md)；自研 Agent 或脚本接入请看 [AI 会话、文件变更与通知开发指南](../../../developer/zh-CN/ai-notification-integration.md)。

## 通知偏好

- 桌面通知：控制外部通知协议和 AI 会话事件是否触发系统桌面通知。关闭后，应用内通知列表、AI 会话面板和事件记录仍会保留。
- 顶部铃铛提醒控制通知：控制外部通知协议产生的未读通知是否进入顶部铃铛队列。AI 会话审批、问题和待处理提醒始终保留，避免误关关键交互。
- 通知点击定位：AI 会话类通知会打开左侧 `AI 会话` 面板并选中对应对话；普通控制通知仍定位到对应终端面板。
- 通知声音：新的 AI 待处理、审批、问题或控制通知进入顶部提醒队列时，可以播放声音。内置声音包含清脆提示音、柔和提示音，以及“启禀殿下，AI需要你审批了”的趣味语音方案。
- 自定义声音：可在设置页选择 MP3、WAV、OGG、M4A、AAC、FLAC 或 WebM 文件。aiopsterm 会把文件复制到应用数据目录下的 `notification-sounds/`，配置中保存复制后的路径和 URL。
- 试听：设置页提供试听按钮，用于确认当前声音方案或自定义音频能正常播放。

## Agent Hook 安装器

- 会话管理 Hook：把 aiopsterm 的 Hook Helper 显式写入支持的 Agent 用户级 Hook 配置，用于让左侧 `AI 会话` 面板发现通过 aiopsterm 本地连接终端启动的 AI 会话。
- 会话解析规则：每个 Agent 可以导入声明式 JSON 规则，用于从本地会话文件提取内容、角色和消息类型；也可以通过“添加 Agent”接入新的只读 JSONL 来源。完整字段和示例见 [Agent 会话解析规则](agent-session-parsers.md)。
- CLI：显示是否在当前 `PATH` 中检测到对应命令，例如 `codex`、`claude`、`cursor-agent`、`gemini`、`copilot`、`grok`、`opencode`、`codebuddy`、`droid`、`qodercli`、`amp`、`pi`、`omp`、`kiro-cli`、`acli`、`kimi` 或 `dsh`。
- Hook 配置：安装器只插入带 aiopsterm marker 的命令，不删除其它用户 Hook。
- Kimi Code：安装器把受标记的 `[[hooks]]` 区块写入 `~/.kimi-code/config.toml`，覆盖会话、回合、权限、工具、完成、失败与退出事件，同时保留用户的模型和其它 Hook 配置。
- DeepSeek Harness：安装器为 `web` 和 `headless` profile 安装官方 `@deepseek-ai/dsh-hooks-codex` bridge，并把受标记的 profile patch 指向 `~/.dsh/aiopsterm/hooks.json`。首次安装需要 `pnpm`；安装器只移除自己的 patch，不删除用户 profile 或插件依赖。
- 生效范围：Hook Helper 只有在 `AIOPSTERM_MANAGED_TERMINAL=1` 且存在 `AIOPSTERM_AGENT_SOCKET_PATH` 的 aiopsterm 本地连接终端里才会上报事件。外部系统终端会空返回，不接管 Agent 原生审批。

## AI 会话休眠

- 启用 Agent Hibernation：允许 aiopsterm 在后台 AI 会话过多时休眠符合条件的本地连接终端。休眠只针对可恢复的 AI 会话，不会处理当前可见终端、正在等待输入的会话或缺少恢复命令的会话。
- 空闲时间（秒）：终端最后活动超过该秒数后才会成为休眠候选。范围是 `5` 到 `604800` 秒。
- 最大活跃终端数：可恢复 AI 终端数量超过该值后，后台最旧的候选才会进入休眠流程。范围是 `1` 到 `256`。
- 确认倒计时（秒）：休眠前在界面中保留确认窗口的时间。设置为 `0` 表示符合条件后直接休眠后台候选。范围是 `0` 到 `3600` 秒。

## 自动化入口

- Control Socket：aiopsterm 本地连接终端会注入 `AIOPSTERM_CONTROL_SOCKET`。脚本和 CLI 可以通过该 socket 调用控制协议，例如发送通知、列出通知、打开通知或操作受管 AI 会话。
- CLI Helper：`resources/aiopsterm-control.js` 是控制协议 helper。aiopsterm 本地连接终端会把 `aio`、`aictl` 和 `aiopsterm-control` 加入 PATH，首选短命令是 `aio list-notifications`。这些命令内部使用 aiopsterm 自带 JavaScript runtime，不需要系统 `node`。
- 控制协议文档：打开 [Control Socket](../../../technical/control-socket.md) 查看 `notify`、`list-notifications`、自动化请求和通知字段说明。
