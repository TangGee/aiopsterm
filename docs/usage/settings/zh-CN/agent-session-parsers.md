# Agent 会话解析规则

本页对应 `设置 -> AI 通知 -> Agent Hook 安装器` 中的会话解析规则功能。点击卡片标题区域右侧的问号按钮可以直接打开本文档。

解析规则只描述 Agent 会话文件的结构。aiopsterm 的通用解析框架负责读取 JSONL、执行 JSON Pointer 匹配、提取内容和角色并生成会话内容卡片。规则不会执行 JavaScript、Shell、SQL 或动态模块。

## 设置操作

- 导入会话解析规则：替换对应内置 Agent 的默认解析规则。导入文件的 `source` 必须与该设置项一致。
- 恢复默认规则：删除用户覆盖规则，重新使用应用内置规则。
- 添加 Agent：导入一个自定义 Agent 规则。自定义来源统一保存为 `custom:<名称>`，当前只支持读取 JSONL 会话文件并以只读方式展示。
- 替换解析规则：替换已经添加的自定义 Agent 规则。
- 删除：删除自定义 Agent 支持及其已导入的会话索引，不删除 Agent 自己的原始会话文件。

规则保存到应用数据目录的 `agent-sessions/parser-rules/` 下。无法被任何规则解析的整条 JSONL 记录会以只读原始 JSON 展示，不会静默丢弃。

## 完整配置结构

```json
{
  "schemaVersion": 1,
  "id": "aider",
  "source": "custom:aider",
  "displayName": "Aider",
  "storage": {
    "kind": "jsonl",
    "paths": ["${HOME}/.aider/sessions/**/*.jsonl"],
    "sessionIdPointer": "/session/id",
    "titlePointer": "/session/title",
    "summaryPointer": "/session/summary",
    "cwdPointer": "/session/cwd",
    "timestampPointer": "/timestamp"
  },
  "rules": [
    {
      "id": "chat-message",
      "match": {
        "/type": ["user", "assistant"]
      },
      "kind": "message",
      "rolePointer": "/role",
      "contentPointers": ["/content"],
      "editable": false
    }
  ],
  "fallback": "raw-json"
}
```

## 顶层字段

- `schemaVersion`：当前必须为 `1`。
- `id`：规则包标识，只允许小写字母、数字和连字符，最长 64 个字符。
- `source`：内置 Agent 使用固定来源名，例如 `codex`；新增 Agent 使用 `custom:<名称>`。导入新增 Agent 时也可以只写名称，应用会规范化为 `custom:<名称>`。
- `displayName`：设置页和 AI 会话列表中使用的显示名称。
- `storage`：会话存储位置及会话元数据字段。
- `rules`：按顺序执行的语义提取规则，最多 200 条。
- `fallback`：当前必须为 `raw-json`。

禁止使用顶层 `script`、`command`、`sql` 和 `module` 字段。

## storage 字段

- `kind`：自定义 Agent 当前必须为 `jsonl`。内置规则还可能使用 `opencode-sqlite` 或 `events`。
- `paths`：JSONL 文件路径，最多 16 条。支持 `~`、`${HOME}`、`*`、`**` 和 `?`。
- `sessionIdPointer`：从第一条有效 JSON 对象读取会话 ID；缺失时使用文件名。
- `titlePointer`：从第一条有效 JSON 对象读取会话标题；缺失时使用 `displayName`。
- `summaryPointer`：可选会话摘要字段。
- `cwdPointer`：可选项目目录字段。
- `timestampPointer`：可选时间字段，支持数字时间戳或可由 `Date.parse` 识别的字符串；缺失时使用文件修改时间。

所有 Pointer 都使用 JSON Pointer 转义：字段名中的 `~` 写成 `~0`，`/` 写成 `~1`。

## rules 字段

每条规则支持以下字段：

- `id`：规则标识。
- `match`：可选匹配条件。键是 JSON Pointer，值可以是字符串、数字、布尔值或字符串数组。数组表示满足其中任意一个值。
- `scopePointer`：可选作用域 Pointer。适合解析消息块数组，例如 `/payload/content/*`。`*` 会逐项展开。
- `kind`：UI 中显示的消息类型，例如 `message`、`system prompt`、`reasoning`、`tool call` 或 `tool result`。
- `role`：固定角色，可选值为 `system`、`developer`、`user`、`assistant`、`tool` 或 `unknown`。
- `rolePointer`：从记录读取角色。设置 `scopePointer` 后，以 `/` 开头的 Pointer 相对于当前作用域，以 `$` 开头的 Pointer 从整条 JSONL 记录根节点读取。
- `contentPointers`：需要展示的内容字段，至少一条，最多 16 条。字符串直接展示；对象和数组格式化为 JSON。
- `label`：固定附加标签。
- `labelPointer`：从记录读取附加标签，常用于工具名称。
- `editable`：该字段是否允许编辑。自定义 Agent 当前整体只读，因此该值不会绕过来源级只读限制。

同一条记录匹配出内容后，只展示规则提取出的字段。如果整条记录没有任何规则产生内容，才会触发 `raw-json` 回退。因此规则应覆盖所有需要查看的消息块。

## scopePointer 示例

下面的规则逐项解析 `payload.content`，只展示 `input_text` 和 `output_text` 的 `text`，角色从整条记录的 `payload.role` 读取：

```json
{
  "id": "response-message",
  "scopePointer": "/payload/content/*",
  "match": {
    "/type": ["input_text", "output_text"]
  },
  "kind": "message",
  "rolePointer": "$/payload/role",
  "contentPointers": ["/text"]
}
```

## Codex system prompt 示例

Codex 首条记录的系统提示位于 `session_meta.payload.base_instructions.text`。对应规则如下：

```json
{
  "id": "system-prompt",
  "match": {
    "/type": "session_meta"
  },
  "kind": "system prompt",
  "role": "system",
  "contentPointers": ["/payload/base_instructions/text"]
}
```

Codex 的 `response_item/message` 使用 `rolePointer: "$/payload/role"` 读取 `developer`、`user` 或 `assistant`。工具调用使用固定 `role: "tool"`，并通过 `labelPointer: "/payload/name"` 显示工具名称。

导入内置 Agent 规则会替换整份默认配置，不是只追加一条规则。修改 Codex 时应从下面的完整默认配置开始：

```json
{
  "schemaVersion": 1,
  "id": "codex",
  "source": "codex",
  "displayName": "Codex",
  "storage": {
    "kind": "jsonl",
    "paths": ["${HOME}/.codex/sessions/**/*.jsonl"]
  },
  "rules": [
    {
      "id": "system-prompt",
      "match": { "/type": "session_meta" },
      "kind": "system prompt",
      "role": "system",
      "contentPointers": ["/payload/base_instructions/text"]
    },
    {
      "id": "user-event-message",
      "match": { "/type": "event_msg", "/payload/type": "user_message" },
      "kind": "message",
      "role": "user",
      "contentPointers": ["/payload/message"]
    },
    {
      "id": "assistant-event-message",
      "match": { "/type": "event_msg", "/payload/type": ["agent_message", "assistant_message"] },
      "kind": "message",
      "role": "assistant",
      "contentPointers": ["/payload/message"]
    },
    {
      "id": "assistant-event-reasoning",
      "match": { "/type": "event_msg", "/payload/type": "agent_reasoning" },
      "kind": "reasoning",
      "role": "assistant",
      "contentPointers": ["/payload/text"]
    },
    {
      "id": "response-message",
      "scopePointer": "/payload/content/*",
      "match": { "/type": ["input_text", "output_text"] },
      "kind": "message",
      "rolePointer": "$/payload/role",
      "contentPointers": ["/text"]
    },
    {
      "id": "function-call",
      "match": { "/type": "response_item", "/payload/type": "function_call" },
      "kind": "tool call",
      "role": "tool",
      "contentPointers": ["/payload/arguments"],
      "labelPointer": "/payload/name"
    },
    {
      "id": "custom-tool-call",
      "match": { "/type": "response_item", "/payload/type": "custom_tool_call" },
      "kind": "tool call",
      "role": "tool",
      "contentPointers": ["/payload/input"],
      "labelPointer": "/payload/name"
    },
    {
      "id": "function-result",
      "match": { "/type": "response_item", "/payload/type": ["function_call_output", "custom_tool_call_output"] },
      "kind": "tool result",
      "role": "tool",
      "contentPointers": ["/payload/output"]
    },
    {
      "id": "reasoning-summary",
      "scopePointer": "/payload/summary/*",
      "match": { "$/type": "response_item", "$/payload/type": "reasoning" },
      "kind": "reasoning",
      "role": "assistant",
      "contentPointers": ["/text"]
    },
    {
      "id": "reasoning-content",
      "scopePointer": "/payload/content/*",
      "match": { "$/type": "response_item", "$/payload/type": "reasoning" },
      "kind": "reasoning",
      "role": "assistant",
      "contentPointers": ["/text"]
    },
    {
      "id": "web-search",
      "match": { "/type": "response_item", "/payload/type": "web_search_call" },
      "kind": "tool call",
      "role": "tool",
      "contentPointers": ["/payload/query"]
    }
  ],
  "fallback": "raw-json"
}
```

## 编写和验证流程

1. 复制一小段真实 JSONL 到测试目录，不要直接在唯一的原始会话文件上试验。
2. 先填写 `storage.paths` 和会话元数据 Pointer，确认 Agent 会话能出现在列表。
3. 为 system、developer、user、assistant、tool 和 reasoning 分别添加规则。
4. 从对应 Agent 设置项导入规则，避免把一个 Agent 的规则误导入另一个 Agent。
5. 打开会话内容，检查角色、消息类型、行号和 JSON Pointer。
6. 修改规则后重新导入，并在会话内容页手动刷新。

解析不了的整条记录应显示为 `raw-json`。如果某条期望消息完全没有出现，优先检查它是否和同一 JSONL 行中已经匹配的其他字段共存，并补充相应的 `scopePointer` 和内容规则。
