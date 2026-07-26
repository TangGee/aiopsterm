# 主机Agent

本页集中管理主机内嵌 AI Agent 能力。顶部二级入口包含 `对话与主机`、`MCP`、`Skills` 和 `规则`。外部 Agent Hook、AI 会话休眠、桌面提醒和 Control Socket 在 [AI 通知](ai-notifications.md) 中配置；外部 Agent 使用的 MCP 导出在 [导出 MCP](export-mcp.md) 中配置。

实际操作流程见[用 AI 操作远程主机](../../best-practices/zh-CN/09-host-agent.md)。

## 对话与主机

该子页管理内嵌 Codex 和内嵌 AI 对话中的命令执行、上下文增强、安全审批和终端等待行为。

## 通用

- 自动执行只读命令：允许低风险只读命令在确认范围内自动执行。它不会绕过高风险命令审批。
- 命令输出过滤：Agent 回传长命令输出时压缩中间部分，界面仍保留完整输出。
- 知识库搜索：普通 AI 对话发送前自动检索并附加相关知识库文档。
- 经验抽取：控制 AI 回答中是否提炼可复用运维经验。
- AI 会话自动命名：Agent 回合结束后用当前模型总结 2-5 个词的会话标题；手动标题不会被覆盖。
- 自动批准：只允许低风险只读动作自动通过，不跳过高风险命令审批。
- 安全配置：打开 `security-config.json` 编辑器，用于维护命令安全策略、黑名单、白名单和风险审批规则。

## 终端

- Shell Integration Timeout：Agent 等待终端命令输出的默认超时时间，单位为秒。命令运行时间超过该值后，Agent 可能停止等待更多输出。

## MCP

MCP 子页管理 aiopsterm 内部 Agent 可用的 MCP Servers、Tools 和 Resources。详见 [MCP 设置](mcp.md)。

## Skills

Skills 子页管理本地技能包。启用后的技能可作为 AI 对话上下文使用。详见 [Skills 设置](skills.md)。

## 规则

规则子页维护 User Rules。规则会作为 Agent 行为约束参与对话和命令生成。详见 [规则设置](rules.md)。
