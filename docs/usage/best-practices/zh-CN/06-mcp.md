# MCP 集成最佳实践

aiopsterm 的 MCP 相关能力有两个方向：**接入第三方 MCP Server** 给内部 Agent 使用，以及把 aiopsterm 自身能力**导出**给外部编码代理。

## 配置第三方 MCP Server

![主机Agent 设置页](../images/settings-hostagent.png)

打开 **① 设置 -> 主机Agent**，页内 **② 子页签** 依次是 `对话与主机`、`MCP`、`Skills`、`规则`。

![MCP 设置页](../images/settings-mcp.png)

切到 **① MCP 子页签**：

- **② Add Server** 打开 JSON 编辑器，直接编辑用户数据目录下的 `setting/mcp_settings.json`。
- **③ 服务器与工具列表**：主进程完成发现（`initialize` → `tools/list` → `resources/list`）后，这里展示每个 Server 的 Tools/Resources，工具行可展开查看参数并单独控制 Auto Approve。

`stdio` 与 `streamableHttp` 配置示例：

```json
{
  "mcpServers": {
    "local-tools": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/server.js"],
      "timeout": 10
    },
    "remote-tools": {
      "type": "streamableHttp",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ${TOKEN}" }
    }
  }
}
```

实用规则：

- 省略 `type` 时：有 `url` 无 `command` 按 `streamableHttp` 处理；`http`、`streamable_http`、`streamable-http` 别名保存时归一化；`command` 与 `url` 同时存在且无显式类型时按更安全的 stdio 解释。
- 后端没有返回有效 `connected` 状态的 Server 一律显示 `disconnected`，其 Run/Read 操作被禁用——不要以为写进 JSON 就等于连上了。
- 旧版 `sse` 服务器继续用 `"type": "sse"` 同样的字段。
- 种子示例 `ops-inventory` 只是开发/测试用名字；若本地配置里有它且命令不存在，会报 ENOENT，可直接删掉。

> 安全边界：Agent 只能读取已启用 Server 上明确列出的资源 URI，且每次读取都要在资源审批卡上显式点击；MCP 的传输命令、环境变量、请求头与凭据从不暴露给模型。

## 导出 MCP 给外部代理

![导出 MCP](../images/settings-export-mcp.png)

从左侧 **① 导出 MCP** 进入页面，**②** 管理本地网关和 Token，**③** 是第一个独立能力卡片；其余两个 Server 卡片在同页下方。

**设置 -> 导出 MCP** 把能力拆成主机与 SSH、托管 AI 会话、数据库只读访问三个独立 MCP Server，供外部 Codex、Claude Code 等代理按需安装：

| Server | 典型场景 | 能力边界 |
| --- | --- | --- |
| `aiopsterm_hosts` | 外部 Agent 复用已保存主机，建立无界面 SSH 连接并排查远程文件 | 列出主机、连接/断开、认证请求、运行有界命令、读取文件、glob 和 grep；不返回密码、私钥或令牌 |
| `aiopsterm_ai_sessions` | 外部 Agent 查看另一个编码代理卡在哪里，并把你带回对应终端 | 列出会话、审批/问题/计划、事件和通知，定位、标记、清理；Claude 阻塞 Hook 可回复，原生 Codex 提示只能定位后在其终端处理 |
| `aiopsterm_databases` | 让可信外部 Agent 浏览保存连接的结构并读取有界数据样本 | 连接投影、目录搜索、表结构/DDL、结构化筛选和分页；不接受任意 SQL，数据库读取权限默认关闭 |

安装步骤：

1. 在页面顶部确认本地网关已启用，再为目标 Agent 生成 Token。
2. 只安装任务需要的能力卡片。未安装的 Server 不会向 Agent 提供 tool schema。
3. 数据库场景还要显式开启 **允许外部 Agent 读取数据库**；非 SQLite 连接通常需要先在数据库工作区打开。
4. 回到外部 Agent 重新加载 MCP 列表，用一次只读查询验证连接。

页面提供外部 Agent MCP 安装器与 Token 管理。三个 Server 共用本地 socket、应用自带运行时和当前 Token，但工具列表完全隔离：

- `重新生成 Token` 会立即使旧 Token 失效，已运行的外部 Agent 需重新加载配置。
- 帮助脚本通过 aiopsterm 自带运行时执行（`ELECTRON_RUN_AS_NODE=1 <aiopsterm可执行文件> <helper.js>`），**不需要**系统安装 Node.js。
- 数据库工具走独立的 Export MCP 网关，用进程级随机句柄解析到已保存连接——外部代理拿不到第二份 DSN 或密码。
- 应用重启后数据库随机句柄会变化；外部 Agent 应重新调用连接列表，不能持久化旧句柄。

> 最佳实践：只把 Token 发给可信本地 Agent，疑似泄露时立即重新生成。主机命令仍受连接和认证边界约束；数据库保持只读；AI 会话工具不会关闭对应终端或杀死代理进程。
