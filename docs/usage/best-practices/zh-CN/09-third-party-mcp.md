# 为主机 Agent 配置第三方 MCP Server

本章介绍把第三方 MCP 工具和资源接入 aiopsterm 的 Classic 主机 Agent。它与“把 aiopsterm 能力导出给外部 Agent”方向相反，使用不同设置、进程和权限边界。

## 从哪里打开

点击 **设置齿轮 -> 主机Agent -> MCP**。点击 **Add Server** 打开 JSON 编辑器；保存后回到服务器列表查看连接状态、Tools 和 Resources。这个页面不会安装 `aiopsterm_hosts`、`aiopsterm_ai_sessions` 或 `aiopsterm_databases`，这些服务位于[导出 MCP](08-export-mcp.md)。

![MCP 设置页](../images/zh-CN/settings-mcp.png)

图中 **①** 是 MCP 子页签，**②** 打开 Server 配置，**③** 展示发现到的工具和资源。

## 添加 stdio Server

```json
{
  "mcpServers": {
    "local-tools": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/server.js"],
      "env": { "SERVICE_TOKEN": "..." },
      "timeout": 10
    }
  }
}
```

`command` 必须在 aiopsterm 主进程环境中可执行，脚本路径使用绝对路径。保存凭据后，它只用于启动 Server，不会作为普通上下文字段交给模型。

## 添加远程 Server

```json
{
  "mcpServers": {
    "remote-tools": {
      "type": "streamableHttp",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ${TOKEN}" }
    }
  }
}
```

支持 `streamableHttp` 和兼容的 `sse` 配置。省略 `type` 时，有 `url` 且无 `command` 才按 HTTP 处理；同时存在两者时应显式写类型，避免启动错误的传输。

## 验证连接与授权工具

1. 保存配置并等待状态刷新。
2. 只有显示 `connected` 才表示初始化和发现完成；写入 JSON 不等于已经连通。
3. 展开 Server，检查 Tools 和 Resources 是否与预期一致。
4. 只为确定安全的只读工具开启 Auto Approve；写入、执行和外部网络工具保留人工审批。
5. 在 Classic 对话中发起一个只读任务，确认工具卡标注了正确 Server 和参数。

Agent 只能读取列表中明确暴露的资源 URI。资源读取仍需要审批；传输命令、环境变量、HTTP 请求头和凭据不会显示给模型。

## 常见问题

- `ENOENT`：`command` 或脚本路径不存在；删除无效的开发示例配置。
- `disconnected`：检查进程能否启动、HTTP 地址、认证头和超时。
- 没有 Tools：Server 可能只提供 Resources，或 `tools/list` 返回无效结果。
- 工具未自动运行：检查该工具自己的 Auto Approve，而不是只看 Server 开关。
- 外部 Codex 看不到：本页服务提供给内嵌 Classic；外部 Agent 应在 **设置 -> 导出 MCP** 安装对应能力。

上一篇：[导出 MCP](08-export-mcp.md) · 下一篇：[文件管理](10-files.md) · [返回目录](../index.md)
