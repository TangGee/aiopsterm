# 隐私设置

本页控制遥测、敏感信息脱敏、数据同步状态和账户停用。

## Telemetry

- 启用：允许发送用于改进产品体验的遥测信息。
- 禁用：关闭遥测。

## Secret Redaction

- 启用：在输出和上下文中脱敏常见密钥、Token 和地址。
- 禁用：不执行这类脱敏处理。
- Supported Patterns：启用脱敏后展示当前支持的脱敏规则，例如 IPv4、AWS Access ID、GitHub Token、Google API Key。

## Data Sync

- 启用：开启数据同步运行状态。
- 禁用：关闭数据同步。
- Runtime：当前同步运行时，例如 local-file。
- Status：同步状态，例如 synced 或 error。
- Last Sync：最近同步时间。
- Scopes：本次同步覆盖的配置范围。
- 状态文件路径：本地同步状态文件位置。
- 错误信息：同步失败时展示错误原因。

## Account Management

- 停用账户：打开停用确认弹窗。
- DEACTIVATE 确认输入：只有输入 `DEACTIVATE` 后才能执行停用账户。

停用账户会关闭同步和登录状态，属于高影响操作。
