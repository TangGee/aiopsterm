# 六个产品场景的补录素材

本轮按[补录范围](video-plan.md#2026-11-15-确认的补录范围)交付独立素材，由用户剪辑，未对外发布。本机目录为 `/home/tlinux/Videos/aiopsterm-supplement-20261115/`。视频无配音、音乐、字幕或加速；文件名对应的 `-timeline.json` 记录操作时间，`verification.json` 记录实际规格、完整解码结果和 SHA-256。

## 场景和剪辑定位

| 文件 | 内容 | 关键时间定位 |
| --- | --- | --- |
| `01-ai-notification-session-edit-raw.mp4` | 真实 Codex 任务完成后，从 AI 通知进入会话，查看并编辑用户记录，保存后重新读取核对 | 00:26 通知；00:32 查看内容；00:44 编辑保存 |
| `02-classic-ali-readonly-raw.mp4` | Classic 绑定阿里 SSH，审批系统资源与测试命名空间的只读巡检，取得真实输出和结论 | 00:35 审批命令；后半段为执行结果及结论 |
| `03-embedded-codex-ali-selected.mp4` | 右侧内嵌 Codex 绑定阿里，调用远程工具，审批后得到测试服务状态 | 00:02 提交任务；00:25 审批远程命令 |
| `04-kubernetes-ali-fixed-raw.mp4` | 收起右侧 Codex，全宽展示测试 Pod、Describe、Deployment 和容器内 HTTP 检查 | 00:08 输出跟随；00:19 Deployment；00:38 执行检查；结尾返回 `aiopsterm-k3s-ok` |
| `05-sql-workspace-raw.mp4` | 打开独立 SQLite 演示库，查看合成订单数据，执行汇总 SQL，使用 DB AI 生成并手动运行只读查询 | 00:05 表数据；00:27 执行 SQL；00:37 DB AI；01:29 运行生成的查询 |
| `06-feishu-interactive-codex-raw.mp4` | `/sessions` 列表点击绑定，直接启动交互式 `codex`；普通消息新增命令行入口，继续追问新增 `--pretty`，真实修改文件并运行测试 | 00:00 终端列表；00:12 已绑定并启动；00:18 第一轮任务；00:58 第一轮结果；01:01 追问；结尾第二轮结果 |

01 至 06 的时长分别为 57.43、84.03、72.07、52.83、98.27、115.07 秒，均为 H.264、30 fps、无音轨。01 至 05 为 1600×900，06 仅录飞书聊天区域，为 1238×908。六个文件完整解码通过，已抽查各段关键画面，录屏质量验证不代表完整产品验收。

03 是原始实录从第 45 秒起的连续片段，剔除了启动等待和历史警告画面，没有拼接执行结果。完整来源保留在 `discarded/03-embedded-codex-ali-raw.mp4`，偏移记录在对应时间文件中。其他作废试录同样放在 `discarded/`，不属于交付素材。

## 展示边界

- AI 通知片展示的是通知和会话管理，不是右侧 AI 面板。编辑的是已停止的专用演示会话；当前保存不会自动备份，编辑影响与限制见[会话指南](../usage/best-practices/zh-CN/05-ai-sessions.md)。
- 阿里巡检只查看系统资源和 `aiopsterm-test` 命名空间；没有改动业务服务。SQL 的 30 条订单为合成数据。
- Codex 是演示中的客户端/交互方式，录制使用配置的 `ark-code-latest`，不能把画面标为某个未经验证的 GPT 模型。
- 自定义模型可能显示模型元数据回退提示，Codex 界面也保留 warning 状态；这不等于任务失败。内嵌 Codex 片后半段可优先选取远程工具执行和服务结论，最终成片应以实际结果为主。
- 原片仍可能出现主机地址、账户名和本机路径。公开剪辑时应遮挡这些字段；不得发布演示配置、凭据文件或作废桌面素材。
- 等待可以在剪辑中压缩并注明，不能把剪辑时长描述成任务真实耗时。项目文件浏览可作为后续补充主题，尚不属于这组六段素材。

## 修复与验证依据

录制前修复并提交了 Kubernetes 输出跟随（`1469518e`）、`kubectl exec --` 容器命令参数隔离（`77b501b3`）、IM 普通文本独立提交（`8d9075ca`）。使用文档已同步，未将测试版功能描述为正式发布能力。

- Kubernetes：`kubernetes-backend`、`kubernetes-terminal-pty`、`kubernetes-workspace-presentation` 及两个工作区控制器测试文件，共 57 项通过；涵盖 `--` 前后参数、自动跟随、上滚暂停与恢复。真实 Ali UI 使用原始 exec 命令返回测试服务内容，证据为素材目录的 `k8s-exec-live-verification.json`。
- IM：`im-gateway-input-backend`、`core-backend`、`output-backend`、`terminal-backend`、`feishu-backend` 和 `im-gateway-ipc`，共 124 项通过。覆盖普通消息分开写入文本和回车、多行粘贴、特殊按键不额外提交、等待期间解绑或失权、消息顺序和写入失败。真实网关核心驱动 Codex CLI 0.167.0 的单行、多行 PTY 验证通过。
- AI 通知与内容：`agent-session-content-runtime`、`agent-session-notification-runtime`、`managed-ai-session-content-workspace` 共 25 项通过，覆盖通知与内容读写、保存限制。实际通知片另核对了保存后重读。
- 以上修复已通过项目完整构建。02、03、05 来自此前运行的应用；01、04、06 使用本地源码构建。重启后的飞书使用修复后的网关；本次没有重新打包 AppImage，不代表已有 AppImage 包含这些修复。
- 飞书实录的两个任务均由普通消息自动提交，没有另发 `/key enter`。真实 Codex 会话包含两次完成事件，所有工具调用成功，依次通过 4 项与 5 项测试。录制后独立运行 `python3 -m unittest -v`，5 项通过，并额外核对默认 JSON 输出保持单行；证据为素材目录的 `feishu-live-verification.json`。录制结束退出演示 Codex、解除飞书绑定，桌面应用继续运行。

测试命令为 `npx vitest run` 加上述对应测试文件；构建为 `npm run build`。单元测试、真实操作和视频解码分别提供证据，不能互相替代。
