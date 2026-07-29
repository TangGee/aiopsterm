# 命令安全设置

本页位于 `设置 -> 主机Agent -> 对话与主机 -> 命令安全`，用于控制结构化命令写入终端前的检查。

命令安全适用于命令行、全局执行、快捷命令和 Agent 执行。用户在终端窗格内直接键盘输入，或通过右键、中键、上下文菜单和 `Ctrl+Shift+V` 粘贴时，不经过命令安全检查。人工粘贴仍使用正常终端会话检查、写入结果校验和错误提示。

## 可视化设置

- 启用命令安全：关闭后，结构化命令不再执行长度、黑白名单和危险命令检查。
- 严格白名单模式：开启后，未命中白名单的结构化命令会被阻止。
- 最大命令长度：超过该长度的结构化命令会被阻止，允许范围是 `1` 到 `100000`。
- 严重命令策略：选择直接阻止或执行前确认。
- 高危命令、中危命令和黑名单策略：分别选择直接阻止或执行前确认。
- 危险命令：每行一个可执行程序名称，例如 `rm` 或 `shutdown`。
- 黑名单和白名单：每行一个规则，可使用 `*` 通配符。
- 恢复默认值：将整份命令安全配置恢复为应用默认值。
- 高级 JSON 配置：打开完整配置文件编辑器。

多行规则保存时会移除空行、首尾空格和重复项。

## 高级 JSON 配置

编辑器顶部显示当前配置文件的实际路径。Linux 默认路径是 `~/.config/aiopsterm/security-config.json`，其他平台以编辑器显示为准。

完整配置示例：

```json
{
  "security": {
    "enableCommandSecurity": true,
    "enableStrictMode": false,
    "blacklistPatterns": [],
    "whitelistPatterns": [
      "ls",
      "pwd",
      "whoami",
      "date"
    ],
    "dangerousCommands": [
      "rm",
      "format",
      "shutdown"
    ],
    "maxCommandLength": 10000,
    "securityPolicy": {
      "blockCritical": true,
      "askForMedium": true,
      "askForHigh": true,
      "askForBlacklist": false
    }
  }
}
```

字段说明：

- `enableCommandSecurity`：命令安全总开关。
- `enableStrictMode`：是否启用严格白名单。
- `blacklistPatterns`：命中后按 `askForBlacklist` 决定确认或阻止。
- `whitelistPatterns`：严格模式下允许的命令规则。
- `dangerousCommands`：按命令第一个可执行程序名称识别的危险命令。
- `maxCommandLength`：结构化命令的最大字符数。
- `blockCritical`：`true` 直接阻止严重命令，`false` 改为执行前确认。
- `askForMedium`、`askForHigh`、`askForBlacklist`：`true` 表示执行前确认，`false` 表示直接阻止。

检查顺序是最大长度、黑名单、危险命令、严格白名单。使用 `;`、`&&` 或 `||` 连接的复合命令会逐段检查。规则中的 `*` 可以匹配任意文本。

编辑器会校验并标准化 JSON，保存失败时不会用未确认内容替换当前运行配置。不要通过关闭命令安全总开关解决人工终端粘贴问题；人工粘贴已经固定绕过该策略。
