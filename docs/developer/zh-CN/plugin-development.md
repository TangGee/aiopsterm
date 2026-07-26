# aiopsterm 插件开发

aiopsterm 插件是宿主可验证、可安装的声明式能力包。它不是 External reference 插件的兼容层，也不执行插件自带的 JavaScript 入口。

当前支持两类插件：

- `content`：向终端工作区贡献可见命令。
- `provider`：向宿主贡献受控的数据导入表单，由宿主适配器完成校验和持久化。

## 包结构

外部插件使用 ZIP 格式，并将扩展名改为 `.aiopsterm-plugin`。清单必须位于压缩包根目录：

```text
my-plugin.aiopsterm-plugin
└── aiopsterm.plugin.json
```

内置插件不需要压缩，放在 `resources/builtin-plugins/<plugin-name>/aiopsterm.plugin.json`。构建配置会将该目录复制到应用资源目录。

`.external-reference` 文件和 External reference 的 `plugin.json` 不受支持。

## 通用清单字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `manifestVersion` | 是 | 当前固定为 `1` |
| `id` | 是 | 全局唯一插件 ID，建议使用反向域名或产品前缀 |
| `displayName` | 是 | 插件列表中的名称 |
| `version` | 是 | 插件版本 |
| `kind` | 是 | `content` 或 `provider` |
| `description` | 是 | 插件简介 |
| `engines.aiopsterm` | 是 | 支持 `*`、精确版本或 `>=x.y.z` |
| `iconKey` | 否 | `runbook`、`cloud`、`private` 或 `local` |
| `categories` | 否 | 分类字符串数组 |
| `readme` | 否 | 详情页说明 |
| `functions` | 否 | 详情页能力摘要 |
| `contributes` | 是 | 与插件种类匹配的贡献点 |

宿主会拒绝清单版本、插件种类、引擎版本或贡献点不合法的插件。插件包内可以包含说明文件，但这些文件不会被当作可执行入口加载。

## Content 插件

Content 插件至少贡献一个命令：

```json
{
  "manifestVersion": 1,
  "id": "example.disk-check",
  "displayName": "Disk Check",
  "version": "1.0.0",
  "kind": "content",
  "description": "提供磁盘检查命令。",
  "engines": {
    "aiopsterm": ">=0.1.0"
  },
  "contributes": {
    "commands": [
      {
        "id": "disk-check.usage",
        "title": "磁盘使用情况",
        "description": "显示文件系统容量。",
        "command": "df -h"
      }
    ]
  }
}
```

用户在插件详情页选择“发送到终端”后，命令进入 aiopsterm 现有终端执行控制器。插件不能绕过终端安全策略，也不能直接访问终端会话对象。

## Provider 插件

Provider 插件至少贡献一个 `assetProviders` 项。当前唯一适配器是 `json-assets`，字段类型当前只支持 `textarea`：

```json
{
  "manifestVersion": 1,
  "id": "example.cmdb",
  "displayName": "Example CMDB",
  "version": "1.0.0",
  "kind": "provider",
  "description": "从 JSON 导入资产。",
  "engines": {
    "aiopsterm": ">=0.1.0"
  },
  "contributes": {
    "assetProviders": [
      {
        "id": "cmdb-json",
        "name": "CMDB JSON",
        "description": "粘贴资产数组。",
        "adapter": "json-assets",
        "fields": [
          {
            "key": "payload",
            "label": "CMDB JSON",
            "type": "textarea",
            "required": true
          }
        ]
      }
    ]
  }
}
```

JSON 可以是数组，也可以是包含 `assets` 数组的对象。每个资产必须包含 `externalId`、`name` 和 `host`。可选字段包括 `username`、`port`、`group`、`status`、`tags` 和 `comment`。

宿主限制单次输入不超过 2 MiB、资产不超过 1000 条，并在写入前完成结构校验、重复 ID 检查和字段归一化。插件不能直接调用资产数据库。

## 本地验证

开发内置插件时运行：

```bash
npm run typecheck
npx vitest run tests/extensions-backend.test.ts tests/extensions-client.test.ts
npm run audit:i18n
npm run audit:package-config
npm run audit:client-mocks
```

外部插件打包后，可在插件面板拖入 `.aiopsterm-plugin` 文件。桌面客户端必须提供真实绝对路径，浏览器伪造的文件名不会被视为可安装包。

## 新增贡献点

新增贡献点不是单纯扩展 JSON。维护者必须同时更新共享契约、主进程清单解析、后端宿主适配器、IPC 和 preload 边界、渲染器结果校验、UI、打包审计以及边界测试。涉及任意代码执行的新能力需要单独设计隔离和权限模型，不能复用当前声明式插件通道。
