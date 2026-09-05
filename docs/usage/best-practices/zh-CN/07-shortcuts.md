# 快捷键：高效操作终端与工作区

本文帮助你在不破坏 Shell 控制键的前提下，用键盘完成终端、标签、搜索、AI 和布局操作。

## 从哪里打开

点击窗口左下角的 **设置齿轮**，在设置左侧导航中点击 **快捷键**。要修改某一项，点击该动作右侧的按键框，再按下新组合键；发生冲突时页面会立即提示。点击单项重置按钮恢复一个动作，点击页面顶部的恢复默认按钮重置全部快捷键。

![快捷键设置](../images/zh-CN/settings-shortcuts.png)

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

下列按键只在终端相关界面生效，目前不在快捷键设置页中重映射。表中的 `Primary` 在 Windows 和 Linux 上表示 `Ctrl`，在 macOS 上表示 `Cmd`；`Alt` 在 macOS 键盘上也标为 `Option`。

| 动作 | 默认快捷键 |
| --- | --- |
| 复制 / 粘贴 | `Ctrl+Shift+C` / `Ctrl+Shift+V`；macOS 也支持 `Cmd+C` / `Cmd+V` |
| 打开搜索 | `Primary+Alt+F` |
| 下一个 / 上一个搜索结果 | `Primary+Alt+G` / `Primary+Alt+H` |
| 清除搜索高亮 | `Primary+Alt+J` |
| 新建 / 关闭窗口 | `Primary+Shift+N` / `Primary+Shift+Q` |
| 为当前 SSH 通道创建 Fork | `Primary+Shift+Y` |
| 打开内联 AI 命令 | `Primary+Shift+K` |
| 清屏 | `Primary+Shift+L` |
| 打开当前主机文件管理 | `Primary+Shift+M` |
| 字体放大 / 缩小 / 复位 | `Primary+=` / `Primary+-` / `Primary+0` |
| 切换到上一个 / 下一个终端标签 | `Primary+PageUp` / `Primary+PageDown` |
| 当前标签向左 / 向右移动 | `Primary+Shift+PageUp` / `Primary+Shift+PageDown` |
| 向上 / 向下滚动一行 | `Primary+Shift+Up` / `Primary+Shift+Down` |
| 向上 / 向下滚动一页 | `Shift+PageUp` / `Shift+PageDown` |
| 滚动到顶部 / 底部 | `Shift+Home` / `Shift+End` |
| 切换全屏 | `F11` |
| 重新连接已关闭或出错的终端 | `Enter` |

`Ctrl+Shift+T` 和 `Ctrl+Shift+W` 同时受快捷键设置控制；重映射后，旧的默认组合不再触发对应动作。

## 编辑器常用快捷键

| 使用位置 | 动作 | Windows / Linux | macOS |
| --- | --- | --- | --- |
| 文件、知识库和 JSON 编辑器 | 保存 | `Ctrl+S` | `Cmd+S` |
| SQL 编辑器 | 执行语句 | `Ctrl+Enter` | `Cmd+Enter` |
| SQL 编辑器 | 查找 / 替换 | `Ctrl+F` / `Ctrl+H` | `Cmd+F` / `Cmd+H` |

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
