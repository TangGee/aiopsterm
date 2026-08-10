# AI 会话管理：观察外部编码 Agent

AI 会话模块用于观察和管理外部 Codex、Claude Code、OpenCode 等编码 Agent：接收运行状态和通知、定位所属终端、查看或修订完整对话记录，并检查 Agent 修改的项目文件。它不负责右侧内嵌 Codex/Classic，也不创建 DB AI；这些属于[主机 Agent](03-host-agent.md)和[Agents 产品会话](04-agents-product-sessions.md)。

## 从哪里打开与必要配置

点击模块栏的 **AI 会话** 图标进入收件箱。第一次使用必须先安装对应 Agent Hook：

1. 打开 **设置 -> AI 通知**，找到实际使用的 Agent 卡片。
2. 确认 CLI 已检测到，点击 **安装 Hook**。安装器只增加带 aiopsterm 标记的配置，不删除用户已有 Hook。
3. Codex 还要求 Hooks 功能启用，并且安装的 Hook 配置处于 `trusted` 状态；一键安装器会写入当前 Hook 的 trust hash。Codex 或插件更新后如果状态不再是已安装/可信，重新安装一次。
4. 在 aiopsterm 创建的本地终端中启动 Agent。实时事件只在带有 aiopsterm 托管环境的终端上报；普通系统终端不会被接管。
5. 运行一次短对话，确认会话进入 **运行中**，本轮结束时进入需要关注状态并触发通知。

> 本地历史导入与实时 Hook 是两条路径：历史文件可进入“会话库”，但没有 Hook 时不会得到实时运行、审批、提问、完成通知和可靠的最近文件变更。

![AI 通知设置](../images/settings-ai-notifications.png)

图中 **①** 打开 AI 通知，**②** 控制通知声音，**③** 导入或试听声音，**④** 安装并检查各 Agent Hook。

## 收件箱的三个视图

![AI 会话收件箱](../images/ai-sessions-inbox.png)

- **待处理**：等待审批、回答或确认的会话；顶栏铃铛会在这些会话间轮转。
- **运行中**：当前活跃会话，默认按项目分组。
- **会话库**：本地历史和已结束会话，可按项目、Agent 类型或时间组织。

双击会话会定位其 aiopsterm 终端。可恢复的空闲记录会在保存的 cwd 新建本地终端并写入该 Agent 的 resume 命令。原生 Codex 权限提示仍在 Codex 自己的终端处理；aiopsterm 负责记录、提醒和定位，不伪装成 Codex 审批端。

## 查看完整 AI 对话内容

![AI 会话内容](../images/ai-session-content.png)

1. 在会话行上点击右键，选择 **打开会话内容**。
2. 主工作区会新建以该会话命名的内容标签；图中 **①** 是消息时间线，**②** 切换源码/渲染或内容视图，**③** 是保存状态和操作区。
3. 使用渲染视图阅读用户消息、助手回复、工具调用和错误；需要核对原始字段时切到源码视图。
4. 这份内容来自 Agent 的真实 transcript，不是右侧 AI 面板重新生成的摘要。

如果没有“打开会话内容”，先检查该 Agent 是否提供可读 transcript，以及会话记录中的路径是否仍存在。只有通知事件而没有 transcript 的 Agent 仍可出现在列表，但不能展示不存在的历史正文。

## 修改 AI 对话内容

会话内容编辑用于修复错误上下文、移除敏感片段或纠正会话记录：

1. 先停止或退出正在运行的 Agent，避免它继续在内存中的旧上下文上工作。
2. 右键会话打开内容，切换到可编辑源码视图并修改。
3. 点击保存。aiopsterm 会先校验修订并在 `agent-sessions/content-backups/` 创建原文件备份；不支持的结构不会直接覆盖。
4. 关闭原 Agent 进程，再通过会话行恢复或手动 resume。运行中的进程不会自动重载磁盘 transcript。

修改的是本地对话记录，不等于撤销 Agent 已经执行的命令或文件变更。需要恢复原文时使用备份，不要手工拼接不完整 JSON/JSONL。

## 查看和修改 AI 项目文件

![AI 项目文件](../images/ai-project-files.png)

打开目标会话后，点击会话工具栏的 **项目文件** 按钮：

- **①** 显示项目、Agent 和能力等级。
- **② 最近变更**区分创建、修改、删除和重命名。
- **③ 项目树**按需读取真实磁盘目录；点击文件在 Monaco 编辑器打开。
- 编辑约在停顿 1 秒或失焦时保存。若 Agent 同时改动，必须选择重新加载或覆盖，不会静默丢失一方内容。

最近变更来自 Agent Hook 的原生事件、识别的文件工具或显式上报；普通 shell 命令的任意磁盘副作用不会被猜测为 AI 修改。所有路径必须位于该会话绑定的项目根目录内。

## 通知、声音和休眠

在 **设置 -> AI 通知** 配置桌面通知、声音、自定义音频与 Agent Hibernation：

- 审批、提问和本轮完成适合桌面通知和短提示音。
- 自定义 MP3、WAV、OGG、M4A、AAC、FLAC 或 WebM 会复制到用户数据目录，移动原文件不会导致失效。
- 休眠只处理后台、可恢复且没有等待输入的 Agent 终端；当前可见会话和没有 resume 命令的会话会跳过。
- `aio notify` 创建的是通用控制通知，不会创建 AI 会话，也不会替代 Agent Hook。

## 收不到事件时的检查顺序

1. **设置 -> AI 通知** 中 CLI 是否检测到、Hook 是否显示已安装。
2. Codex Hook 是否启用且 trusted；配置变化后重新安装以刷新 trust hash。
3. Agent 是否从 aiopsterm 的本地连接终端启动，而不是 macOS Terminal、iTerm2、Windows Terminal 或外部 Linux Shell。
4. 历史能看到但实时状态没有：通常是 importer 正常而 Hook 没有生效。
5. 通知没有声音：先在设置页试听，再检查系统通知权限和应用内声音开关。

上一篇：[Agents 产品会话](04-agents-product-sessions.md) · 下一篇：[快捷命令与宏](06-quick-commands.md) · [返回目录](../index.md)
