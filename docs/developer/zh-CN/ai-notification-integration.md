# 接入 AI 会话、文件变更与通知

本文面向要把自研 Agent、构建脚本或自动化工具接入 aiopsterm 的开发者。一个完整接入通常包含三条独立但可关联的通道：

1. Agent Hook 报告会话生命周期、工具调用和待处理请求。
2. 文件变更协议报告 Agent 实际修改的项目文件。
3. Control CLI 发送面向用户的通用通知。

托管 AI 会话通知和通用通知不是同一个存储。若希望 AI 会话进入 `待处理`，必须发送相应 Hook 事件；只调用 `aio notify` 不会创建 AI 会话。

## 场景一：让自研 Agent 出现在 AI 会话列表

aiopsterm 创建的本地终端会提供以下环境变量：

| 变量 | 用途 |
| --- | --- |
| `AIOPSTERM_MANAGED_TERMINAL` | 值为 `1` 时表示当前是托管终端 |
| `AIOPSTERM_AGENT_SOCKET_PATH` | Agent 事件 socket |
| `AIOPSTERM_AGENT_HOOK_PATH` | 应用自带 Hook helper |
| `AIOPSTERM_JS_RUNTIME` | 执行 helper 的应用内 JavaScript 运行时 |
| `AIOPSTERM_TERMINAL_SESSION_ID` | 所属终端会话 |
| `AIOPSTERM_PANEL_ID` | 所属面板 |
| `AIOPSTERM_SURFACE_ID` | 所属表面 |
| `AIOPSTERM_WORKSPACE_ID` | 所属工作区 |

`source` 不是任意字符串。当前已注册 `codex`、`claude-code`、`cursor`、`gemini`、`copilot`、`grok`、`opencode`、`codebuddy`、`factory`、`qoder`、`antigravity`、`kiro`、`hermes-agent`、`rovodev`、`amp`、`pi`、`omp`、`kimi-code` 和 `deepseek-harness`。下文的 `my-agent` 假设开发者已经完成 source 注册；未注册名称会被拒绝。

新增 Agent source 时需要：

1. 在 `src/shared/contracts/managedAiSessions.ts` 增加规范 ID。
2. 在 `src/main/backend/agent/agentIntegrationAdapters.ts` 注册 ID、CLI 别名和文件跟踪能力。
3. 为事件规范化和项目文件能力增加测试。
4. 需要一键安装时再实现 Hook installer；需要离线会话库时再实现本地历史 importer。只有实时通知不要求 importer。

推荐让 Agent 的 Hook 系统执行 aiopsterm helper，由 helper 读取标准输入中的 Hook JSON、补充终端路由并发送到 socket：

```sh
ELECTRON_RUN_AS_NODE=1 "$AIOPSTERM_JS_RUNTIME" "$AIOPSTERM_AGENT_HOOK_PATH" \
  --source my-agent \
  --event SessionStart
```

协议事件至少要能解析出以下字段：

```json
{
  "source": "my-agent",
  "sessionId": "session-20260726-001",
  "event": "SessionStart",
  "cwd": "/work/service-api",
  "title": "Service API maintenance"
}
```

字段兼容：

- 会话 ID 可用 `sessionId` 或 `session_id`。
- 事件名可用 `event`、`hookEventName` 或 `hook_event_name`。
- 支持 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`AskUserQuestion`、`Notification`、`Stop` 和 `SessionEnd`，也接受对应的 snake_case 名称。
- `panelId`、`terminalSessionId`、`cwd`、`title`、`summary`、`message`、`transcriptPath`、`launchCommand`、`resumeCommand` 和进程 ID 字段用于改善定位、展示和恢复。

建议的生命周期：

```text
SessionStart
UserPromptSubmit
PreToolUse
PermissionRequest or AskUserQuestion
Stop
SessionEnd
```

`Stop` 表示本轮完成并等待用户检查，会让会话进入需要关注的状态；`SessionEnd` 才表示运行结束。不要把每个工具完成都上报为 `Stop`。

阻塞决策能力取决于 Agent：

- 支持等待 Hook 响应的 Agent 可使用 helper 的 `--wait-decision`，由 AI 会话面板返回 allow、deny 或 reply。
- 原生 Codex 的权限提示由 Codex TUI 自己处理。aiopsterm 可以记录、提醒和定位，但不能替它提交审批。
- helper 在非托管终端、应用不可用或等待超时时失败开放并输出空 JSON，让 Agent 原生流程继续工作。

## 场景二：报告 Agent 修改的项目文件

只有明确报告的变更才会进入项目文件抽屉的最近变更。普通 shell 命令的磁盘副作用不会被自动推断。

协议版本 1：

```json
{
  "protocolVersion": 1,
  "eventId": "tool-call-42-result",
  "source": "my-agent",
  "sessionId": "session-20260726-001",
  "cwd": "/work/service-api",
  "changes": [
    {
      "path": "src/server.ts",
      "kind": "modified"
    },
    {
      "path": "src/old-name.ts",
      "previousPath": "src/legacy-name.ts",
      "kind": "renamed"
    }
  ]
}
```

`kind` 只能是 `created`、`modified`、`deleted` 或 `renamed`。重命名必须提供 `previousPath`。

在 aiopsterm 托管终端中，使用 CLI 上报：

```sh
aio agent file-change record --event-json '{
  "protocolVersion": 1,
  "eventId": "tool-call-42-result",
  "source": "my-agent",
  "sessionId": "session-20260726-001",
  "cwd": "/work/service-api",
  "changes": [
    {
      "path": "src/server.ts",
      "kind": "modified"
    }
  ]
}'
```

实现约束：

- `source` 和 `sessionId` 必须对应一个已绑定本地项目的托管 AI 会话。
- 相对路径基于 `cwd` 解析，最终必须位于会话的规范化项目根目录内。
- 服务端限制单次批量大小。大批变更应拆分为多个有界事件。
- 相同 source、session、eventId、kind 和路径组合会去重，因此重试应复用原 `eventId`。
- 越界路径、缺少重命名前路径和不受支持的协议版本会被拒绝。
- `aio agent file-change record` 只在 aiopsterm 托管终端中可用。

如果 Agent 有结构化文件工具，在工具成功后上报其结果；失败或仅提出修改计划时不要上报。这样最近变更反映已发生事实，而不是模型意图。

## 场景三：从脚本发送通用通知

构建、发布和巡检脚本可以发送通知：

```sh
aio notify \
  --source ci \
  --level warning \
  --title "Build needs review" \
  --body "npm test failed" \
  --group release \
  --key service-api-main
```

支持字段：

| 字段 | CLI | 说明 |
| --- | --- | --- |
| title | `--title` | 必填显示标题；省略时使用默认标题 |
| subtitle | `--subtitle` | 辅助标题 |
| body | `--body` | 详细内容 |
| source | `--source` | 来源，如 ci、deploy、monitor |
| level | `--level` | `info`、`success`、`warning`、`error`、`approval`、`done` |
| group | `--group` | 业务分组 |
| key | `--key` | 幂等键 |
| action | `--action` | 动作语义 |
| url | `--url` | 可打开的链接 |
| panel/session | `--panel`、`--session` | 关联到终端表面 |

相同 `source + group + key` 会更新同一条通知，并重置为未读，适合持续更新同一个构建或部署状态：

```sh
aio notify --source deploy --group api --key release-42 \
  --level info --title "Deploying release 42"

aio notify --source deploy --group api --key release-42 \
  --level done --title "Release 42 completed"
```

没有 `key` 时每次调用都会创建新通知。通用通知保存在应用进程内的有界队列中，不是持久化审计记录；应用重启后不要依赖它恢复业务状态。

## 一个完整的工具回调

以下脚本假设 Agent 已经创建托管会话，并在文件工具成功后调用：

```sh
#!/usr/bin/env sh
set -eu

event_id="${1:?event id required}"
session_id="${2:?session id required}"
changed_path="${3:?changed path required}"

aio agent file-change record --event-json "{
  \"protocolVersion\": 1,
  \"eventId\": \"$event_id\",
  \"source\": \"my-agent\",
  \"sessionId\": \"$session_id\",
  \"cwd\": \"$PWD\",
  \"changes\": [
    {
      \"path\": \"$changed_path\",
      \"kind\": \"modified\"
    }
  ]
}"

aio notify \
  --source my-agent \
  --level success \
  --title "File update completed" \
  --body "$changed_path" \
  --group "$session_id" \
  --key "$event_id"
```

生产实现应使用可靠的 JSON 序列化器处理任意路径，不要直接拼接不可信字符串。

## 验证清单

1. 从 aiopsterm 新建本地终端，确认托管环境变量存在。
2. 发送 `SessionStart`，在 AI 会话的运行中列表确认项目和终端绑定。
3. 上报一个测试文件变更，确认最近变更的类型和相对路径正确。
4. 重发相同 `eventId`，确认没有重复记录。
5. 尝试项目外路径，确认请求被拒绝。
6. 使用相同通知 key 连续发送两个状态，确认更新的是同一条通知。
7. 关闭 aiopsterm 后运行 Hook，确认 Agent 本身不会因通知不可用而失败。

更多实现细节见[托管 AI 会话](../../technical/managed-ai-sessions.md)、[Control Socket](../../technical/control-socket.md)和[控制 CLI 教程](../../usage/control-cli-tutorial.md)。
