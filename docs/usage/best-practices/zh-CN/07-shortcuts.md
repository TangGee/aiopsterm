# 快捷键：高效操作终端与工作区

本文帮助你在不破坏 Shell 控制键的前提下，用键盘完成终端、标签、搜索、AI 和布局操作。

## 从哪里打开

点击窗口左下角的 **设置齿轮**，在设置左侧导航中点击 **快捷键**。要修改某一项，点击该动作右侧的按键框，再按下新组合键；发生冲突时页面会立即提示。点击单项重置按钮恢复一个动作，点击页面顶部的恢复默认按钮重置全部快捷键。

![快捷键设置](../images/zh-CN/settings-shortcuts.png)

## 最常用快捷键速查

| 快捷键 | 动作 | 说明 |
| --- | --- | --- |
| `Ctrl+Shift+T` | 新建本地终端 | 可在设置中修改；从本地终端打开时继承当前 cwd |
| `Ctrl+Shift+Y` | Fork 当前 SSH | 仅在当前终端是可 Fork 的 SSH 通道时生效 |
| `Ctrl+Shift+W` | 关闭当前面板 | 可在设置中修改 |
| `Ctrl+Tab` | 打开最近面板 | 可搜索终端、知识文档、AI 会话和项目文件 |
| `Ctrl+Shift+A` | 显示或隐藏 AI 侧边栏 | 可在设置中修改 |
| `Ctrl+Shift+P` | 打开快捷命令 | 打开用户配置的快捷命令和宏 |
| `Ctrl+Shift+K` | 打开内联 AI 命令 | 以当前终端为目标生成命令 |
| `Ctrl+Shift+M` | 打开文件管理 | 打开当前 SSH 主机的文件工作区 |

`Ctrl+T` 本身不是 aiopsterm 的新建终端快捷键。终端聚焦时，普通 `Ctrl+字母` 会交给 Shell；新建终端的默认组合是 `Ctrl+Shift+T`。如果在设置中把某个应用动作改成 `Ctrl+T`，它只会在非终端区域触发，终端内仍优先透传给 Shell。

## 终端为什么使用组合键

终端聚焦时，`Ctrl+A/C/D/E/K/L` 等组合必须交给 readline、vim、tmux 和远程 TUI。aiopsterm 因此把复制、粘贴、新建终端等应用操作放在 `Ctrl+Shift` 或 `Ctrl+Alt` 组合中。macOS 的界面提示会根据实际快捷键显示；不要把系统级的按住按键重复输入与应用快捷键混为一谈。

## 可自定义的工作区快捷键

下表中的动作可以在 **设置 -> 快捷键** 中重映射。设置页显示的是当前生效值；下表列出新安装时的默认值。

| 动作 | Windows / Linux | macOS |
| --- | --- | --- |
| 新建本地终端 | `Ctrl+Shift+T` | `Ctrl+Shift+T` |
| 显示或隐藏 AI 侧边栏 | `Ctrl+Shift+A` | `Ctrl+Shift+A` |
| 切换到第 1 至 9 个标签 | `Alt+1..9` | `Alt+1..9` |
| 打开快捷命令 | `Ctrl+Shift+P` | `Ctrl+Shift+P` |
| 关闭当前面板 | `Ctrl+Shift+W` | `Ctrl+Shift+W` |
| 打开最近面板 | `Ctrl+Tab` | `Ctrl+Tab` |
| 按访问历史后退 | `Ctrl+Left` | `Cmd+[` |
| 按访问历史前进 | `Ctrl+Right` | `Cmd+]` |
| 按标签栏顺序切换到左侧面板 | `Ctrl+Shift+Left` | `Ctrl+Shift+Left` |
| 按标签栏顺序切换到右侧面板 | `Ctrl+Shift+Right` | `Ctrl+Shift+Right` |

## 终端快捷键

下列按键只在终端相关界面生效，目前不在快捷键设置页中重映射。macOS 的 `Option` 对应下表中的 `Alt`；终端固定快捷键在 macOS 上也接受相应的 `Ctrl` 组合。

| 动作 | Windows / Linux | macOS |
| --- | --- | --- |
| 复制 / 粘贴 | `Ctrl+Shift+C` / `Ctrl+Shift+V` | `Cmd+C` / `Cmd+V` |
| 打开搜索 | `Ctrl+Alt+F` | `Cmd+Option+F` |
| 下一个 / 上一个搜索结果 | `Ctrl+Alt+G` / `Ctrl+Alt+H` | `Cmd+Option+G` / `Cmd+Option+H` |
| 清除搜索高亮 | `Ctrl+Alt+J` | `Cmd+Option+J` |
| 新建 / 关闭窗口 | `Ctrl+Shift+N` / `Ctrl+Shift+Q` | `Cmd+Shift+N` / `Cmd+Shift+Q` |
| Fork 当前 SSH 通道 | `Ctrl+Shift+Y` | `Cmd+Shift+Y` |
| 打开内联 AI 命令 | `Ctrl+Shift+K` | `Cmd+Shift+K` |
| 清屏 | `Ctrl+Shift+L` | `Cmd+Shift+L` |
| 打开当前主机文件管理 | `Ctrl+Shift+M` | `Cmd+Shift+M` |
| 字体放大 / 缩小 / 复位 | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | `Cmd+=` / `Cmd+-` / `Cmd+0` |
| 切换到上一个 / 下一个终端标签 | `Ctrl+PageUp` / `Ctrl+PageDown` | `Cmd+PageUp` / `Cmd+PageDown` |
| 当前标签向左 / 向右移动 | `Ctrl+Shift+PageUp` / `Ctrl+Shift+PageDown` | `Cmd+Shift+PageUp` / `Cmd+Shift+PageDown` |
| 向上 / 向下滚动一行 | `Ctrl+Shift+Up` / `Ctrl+Shift+Down` | `Cmd+Shift+Up` / `Cmd+Shift+Down` |
| 向上 / 向下滚动一页 | `Shift+PageUp` / `Shift+PageDown` | `Shift+PageUp` / `Shift+PageDown` |
| 滚动到顶部 / 底部 | `Shift+Home` / `Shift+End` | `Shift+Home` / `Shift+End` |
| 切换全屏 | `F11` | `F11` |
| 重新连接已关闭或出错的终端 | `Enter` | `Enter` |

`Ctrl+Shift+T` 和 `Ctrl+Shift+W` 同时受快捷键设置控制；重映射后，旧的默认组合不再触发对应动作。

## 编辑器常用快捷键

| 使用位置 | 动作 | Windows / Linux | macOS |
| --- | --- | --- | --- |
| 文件、知识库、会话内容和 JSON 编辑器 | 保存 | `Ctrl+S` | `Cmd+S` |
| 文本编辑器 | 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Y` | `Cmd+Z` / `Cmd+Shift+Z` |
| 文本编辑器 | 剪切 / 复制 / 粘贴 | `Ctrl+X` / `Ctrl+C` / `Ctrl+V` | `Cmd+X` / `Cmd+C` / `Cmd+V` |
| 文本编辑器 | 全选 | `Ctrl+A` | `Cmd+A` |
| 文本编辑器 | 查找 / 替换 | `Ctrl+F` / `Ctrl+H` | `Cmd+F` / `Option+Cmd+F` |
| SQL 编辑器 | 执行语句 | `Ctrl+Enter` | `Cmd+Enter` |
| SQL 编辑器 | 保存 | `Ctrl+S` | `Cmd+S` |

## AI 输入与搜索

| 使用位置 | 按键 | 动作 |
| --- | --- | --- |
| Classic AI 或 DB AI 输入框 | `Enter` | 发送消息 |
| Classic AI 或 DB AI 输入框 | `Shift+Enter` | 插入换行 |
| Classic AI 输入框 | `Ctrl+Enter` / `Cmd+Enter` | 发送消息 |
| Classic AI 输入框 | `@` | 打开上下文选择器 |
| Classic AI 输入框 | `/` | 打开命令选择器 |
| Classic AI 会话 | `Ctrl+F` / `Cmd+F` | 搜索当前对话 |
| 对话搜索框 | `Enter` / `Shift+Enter` | 下一个 / 上一个匹配项 |
| 弹窗、菜单或编辑状态 | `Escape` | 关闭、返回或取消当前操作 |

## 内置终端快捷命令

aiopsterm 创建的本地终端会自动把下面的命令加入 `PATH`。这些是命令行快捷入口，不是键盘组合键；SSH 远端 Shell 默认没有这些命令。

| 命令 | 用途 | 示例 |
| --- | --- | --- |
| `aio` | 推荐的工作区控制命令 | `aio terminal list` |
| `aictl` | `aio` 的兼容别名 | `aictl context` |
| `aiopsterm-control` | `aio` 的完整名称兼容入口 | `aiopsterm-control help` |
| `aiopen` | 在主工作区打开一个或多个本地文本文件 | `aiopen README.md src/main.ts` |
| `aiossh` | 连接或定位已管理主机 | `aiossh prod-api` |
| `aiswitch` | 切换到已管理主机，作用等价于 `aio host switch` | `aiswitch prod-api` |
| `aioic` | 按设置中的空闲时间清理可确认空闲的面板 | `aioic` |
| `aiobc` | 立即关闭后台面板，只保留当前面板 | `aiobc` |

正确命令名是 `aiopen` 和 `aiossh`，没有 `aioopen` 或 `aiopssh`。运行 `aio help` 查看完整命令树，运行 `aio recipes` 查看可复制示例；更详细的参数和工作流见[控制命令教程](../../control-cli-tutorial.md)。

常用组合示例：

```bash
aiopen ./README.md
aiossh prod-api
aio terminal read-screen --lines 80
aio settings open --target shortcuts
aioic
aiobc
```

完整按键以设置页当前值和当前版本界面提示为准，因为可配置快捷键可能已被用户修改，系统或桌面环境也可能占用某些组合。

## 自定义步骤

1. 在 **设置 -> 快捷键** 搜索动作名称。
2. 点击动作右侧的按键框，确认进入录制状态。
3. 按完整组合键，不要逐个点击键帽。
4. 若显示冲突，先决定保留哪个动作，再为另一个动作换键。
5. 回到实际终端验证：普通 Shell 控制键应继续透传，应用动作应只触发一次。

## 最佳实践与排错

- 高频应用操作使用 `Ctrl+Shift`，保留普通 `Ctrl+字母` 给终端程序。
- 不要绑定 macOS Mission Control、Windows 输入法或 Linux 桌面环境已经占用的组合。
- 某个快捷键无响应时，先点击目标终端或面板确认焦点，再检查设置页是否冲突。
- 远程 vim/tmux 收不到按键时，恢复该动作默认值并确认没有把终端控制键改成应用快捷键。

上一篇：[快捷命令与宏](06-quick-commands.md) · 下一篇：[导出 MCP](08-export-mcp.md) · [返回目录](../index.md)
