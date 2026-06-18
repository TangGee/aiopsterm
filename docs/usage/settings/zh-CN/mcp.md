# MCP 设置

本页管理 Agent 可用的 MCP Servers、Tools 和 Resources。

## 顶部操作

- Add Server：打开 MCP 配置编辑器，可添加或编辑 `mcp_settings.json`。
- Save：在配置编辑器中保存 MCP JSON。
- Close：关闭 MCP 配置编辑器。

## MCP Server 列表

- 展开/收起：点击 server 名称可查看其 tools 和 resources。
- 状态标签：展示 server 当前状态，例如 connected、disabled 或 error。
- 编辑：打开 MCP 配置编辑器。
- 删除：删除该 server 配置。
- 启用开关：控制 server 是否启用。禁用后该 server 的工具和资源不会提供给 Agent。

## Tools

- Tool 名称：点击可启用或停用该 tool。
- Auto Approve：开启后，该 tool 可在符合策略时自动批准。高风险或不符合策略的调用仍应走审批。
- PARAMETERS：展示 tool 参数、必填标记和参数说明。
- 参数输入框：输入运行 tool 时使用的 JSON 参数。
- Run：直接测试调用该 tool，并显示返回结果或错误。

## Resources

- Resources 标签：查看 server 暴露的资源。
- Read：读取指定 resource，并显示返回内容或错误。

MCP 能力会进入 Agent 可用工具集合，启停和 Auto Approve 设置会影响后续 Agent 调用行为。
