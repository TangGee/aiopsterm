# 产品场景与运营补录素材

素材目录：`/home/tlinux/Videos/aiopsterm-supplement-20261115/`。交付原片供用户剪辑，未对外发布。目录保留十一段视频：01、05 按最新反馈重录，新增 07b 普通终端 Codex 语音和 08 审批/完成提醒；用户认可的 01b、贪吃蛇与原语音片保留。被替代的 01、05 旧片及其视频附属文件已删除。`verification-v3.json` 为当前唯一视频校验清单，`-timeline.json` 记录操作定位。

## 痛点、内容和剪辑位置

| 文件 | 要解决的问题与实际内容 | 建议定位 |
| --- | --- | --- |
| `01-interactive-codex-edit-resume-v3.mp4`，95.33 秒 | 历史需求有误又不想重开任务：普通终端 Codex 记住 staging，从通知进入会话编辑为 production，恢复相同会话后回答 production | 00:04 原始对话；00:27 通知入口；00:51 用户消息详情；01:02 保存；01:16 恢复并提问；01:23 后可见新答案 |
| `01b-bind-terminal-open-codex-v2.mp4`，84.17 秒 | 补全入口：展开 Codex、点击绑定、选择当前终端；通过工具执行 `pwd`，左右两侧核对同一目录 | 00:02 展开；00:05 选终端；00:12 提交；00:48 批准只读命令；末段目录结果 |
| `02-classic-ali-readonly-raw.mp4`，84.03 秒 | 减少 AI 与 SSH 之间复制：Classic 绑定阿里，审批只读巡检，根据真实输出给结论 | 00:35 审批；后半段结果。沿用已验收素材 |
| `03-embedded-codex-ali-selected.mp4`，72.07 秒 | 明确 Agent 操作对象：内嵌 Codex 绑定阿里，通过远程工具查询测试服务 | 00:02 提交；00:25 审批；后半段服务结果。沿用已验收素材 |
| `04-kubernetes-readiness-repair-v2.mp4`，110.17 秒 | Pod Running 但 0/1 Ready：Describe 发现探针 8081 连接失败，容器内验证实际 8080 可用，修正后复验 Available 1/1 | 00:04 Describe；00:32 容器验证；00:56 修改探针；01:21 新 Pod 就绪；01:46 Deployment 恢复 |
| `05-sql-existing-query-optimization-v3.mp4`，132.23 秒 | 已有 SQL 重复扫描且需要保留业务语义：先加载和执行相关子查询，再让 DB AI 改为条件聚合，执行并核对四行相同结果 | 00:00 加载 SQL；00:04 原结果；00:15 优化要求；约 01:40 模型输出；01:58 执行优化 SQL；02:09 收起 AI 查看结果 |
| `06-feishu-snake-codex-v2.mp4`，297.07 秒 | 离开桌面仍能交代开发：`/sessions` 点击绑定，直接启动交互式 `codex`，自然语言写贪吃蛇，再追加 R 重开与测试 | 00:00 列表；00:16 绑定和启动；00:46 第一轮需求；约 03:46 追加需求；04:54 第二轮完成、11 项测试通过 |
| `06b-snake-browser-play-v2.mp4`，13.90 秒 | 验证开发结果能用：打开同一个生成项目，方向键移动并吃到食物得 20 分、空格暂停和继续、R 重开 | 00:02 开始；00:07 得 20 分后暂停；00:10 继续；00:11 重开 |
| `07-voice-input-v2.mp4`，31.47 秒 | 长需求输入繁琐：空 Classic 输入框采集语音，连续识别、停录补标点，再手动追加根分区要求 | 00:02 开始录音；00:12 最终识别；末段人工补充。输入没有自动发送 |
| `07b-terminal-codex-voice-v3.mp4`，71.93 秒 | 交互终端也能口述需求：在普通终端 Codex 语音询问贪吃蛇按键实现，核对后手动回车，Agent 读取真实代码并回答 | 00:03 开始采集；00:26 文字尚未提交；00:27 手动回车；后半段实际工具读取与解释 |
| `08-terminal-codex-notifications-v3.mp4`，49.23 秒 | 切到其他工作后不知道 Agent 是否在等人：提交创建演示发布清单任务，切数据库，收到审批提醒，定位原生 Codex 并批准，再切数据库收到完成提醒 | 00:02 提交并切走；00:14 审批提醒；00:17 定位；00:27 原生审批；00:44 完成提醒；末段返回结果 |

01 与 01b 是独立实录，06 与 06b 分别是飞书开发和同一项目的浏览器试玩，不能剪成未经中断的连续镜头。03 为既有实录的连续截取；07b 去掉前 10 秒文件夹信任准备画面，剩余内容连续、未加速。其他新版保留原始等待，剪辑可压缩，但不可把成片长度描述为模型真实耗时。

01 的关键证据是相同会话 ID 的后续答案变为 production。CLI 恢复后的旧界面历史仍显示 staging，而模型使用的 `response_item` 已修改；不要宣传为修改一个字段会同步改写所有重复展示记录。05 原 SQL 确实先执行，再请求优化；模型生成期间有约一分半等待，可保留需求、返回和执行结果三处。

## 真实数据与展示边界

- 01 在普通终端完成对话，退出后在应用会话编辑器将用户消息的 staging 改为 production，再通过 `codex resume` 恢复同一会话 `01a1de7b-2d2d-7cf0-92d1-d6964659f0ea`。追问仅为“本次发布的目标环境是什么？只回复环境名。”，实际回答 production。证据 `session-resume-v3-verification.json`；当前保存不自动备份，见[会话指南](../usage/best-practices/zh-CN/05-ai-sessions.md)。01b 的绑定与右侧内嵌 Codex 是另一段场景。
- 04 是在阿里 `aiopsterm-test` 中专门构造的探针端口错误，不能描述为生产事故。仅修改并删除了 `checkout-api-demo` 演示 Deployment，其他业务服务未改动。右侧 Codex 全程收起。
- 05 使用独立 SQLite 演示库和 61 条合成订单，增加一条 billing 已支付订单验证零待处理边界。优化前后均为 worker 8/849.75、api 8/836、web 8/822.25、billing 0/0，排序一致。独立 SQLite 对比结果及执行计划：两个相关子查询和 DISTINCT 被一次分组聚合替代。证据 `sql-optimization-v3-verification.json`，两条 SQL 另存；不把画面中的单次耗时差宣传为可靠性能倍数。
- 06 使用已配置的 `ark-code-latest` 驱动 Codex，不标成未经验证的 GPT 型号。普通消息自动提交，没有额外 `/key enter`。游戏在素材目录的 `snake-game/index.html`，无需外网；演示目录单独提交为 `148c663`。飞书任务和浏览器试玩均来自此项目。
- 07 使用 Edge TTS 的 `zh-CN-XiaoxiaoNeural` 合成演示语音，经虚拟麦克风进入真实采集、本地 Zipformer 与输入目标链路；不是真人口述，也没有预填识别结果。保留 AAC 演示音轨，原始音频另存 `07-voice-input-source.wav` 供剪辑调音，07b 同样保留 AAC 音轨与独立源音频，其他片段无音轨。07b 的合成语音通过真实 ASR 输入普通终端 Codex，未自动提交；识别有“贪吃蛇”被写成“贪蛇”等词语偏差，不宣传逐字准确。手动回车后实际读取游戏代码，未修改游戏。证据 `terminal-voice-v3-verification.json`。结束后已恢复原默认音频输入源。
- 08 使用 Codex 原生只读模式，真实 `PermissionRequest` 提醒后由用户在终端批准 `apply_patch`，创建专用 `release-plan.txt` 后真实 `Stop` 事件产生完成提醒；未伪造 Hook 或审批。文件中的“测试通过”等是演示清单文本，不代表真实发布已经获批。事件及文件证据见 `notifications-v3-verification.json`。
- 原片保留账户、路径和部分主机信息，公开剪辑应遮挡。不要发布配置、凭据或作废桌面素材。CLI 自定义模型元数据回退及 Linux 沙箱提示不能被剪辑说明误写成已修复的问题；实际工具成功另有证据。

## 修复、测试和验证

此前录制前移除了 Codex 配置中已弃用的 `features.web_search_request` 写入，保留 `web_search="disabled"`（`7bd04e99`，31 项相关测试通过）。语音预演发现 Classic 空输入样式变化误触发目标失效，修复为区分展示属性与内容修改，同时保留用户编辑保护（`442156fe`）。[语音实现边界](../technical/voice-input.md)集中维护该行为。

- `global-voice-targets`、`global-voice-recording`、`global-voice-streaming`、`voice-realtime-recording`：33 项通过；新增展示属性更新不中断口述、真实手动修改仍拒绝迟到结果的回归。实际音频识别整句并人工补充成功，证据 `voice-v2-verification.json`。
- 本次复核并运行 `agent-session-content-runtime`、`agent-session-notification-runtime`、`managed-ai-session-content-workspace`、`terminal-voice-draft`：27 项通过。覆盖保存、分页、未保存保护、版本冲突、通知处理、语音最终一次写入与手动输入/光标变化保护。现有用例无需修改；真实同会话恢复、审批/完成和终端语音另由新版实录及 JSON 证据验证，不能仅凭单元测试宣称模型上下文已更新。
- 本次复核并运行 `database-ai-context-runtime`、`database-sql-execution-workspace-runtime`：7 项通过，覆盖当前 SQL 表上下文、歧义排除、执行及错误/结果标签行为；另验证优化前后结果、零待处理边界和执行计划。未改产品代码，不新增镜像实现的测试。
- 贪吃蛇 `node --test`：11 项通过，覆盖移动、禁止反向和同一步二次转向、进食、四面墙、自碰撞、尾格、结束、暂停和重开。浏览器实际按键验证真实吃食物得 20 分、暂停画面不变、R 重开归零，无页面异常，见 `snake-browser-verification.json` 和 `snake-tests.log`。
- Kubernetes、SQL 和绑定 Codex 的真实验收分别见 `k8s-readiness-v2-verification.json`、`sql-optimization-v3-verification.json`、`bind-codex-v2-verification.json`。
- 既有修复仍保留：K8s 跟随滚动 `1469518e`、exec 参数隔离 `77b501b3`（57 项相关测试），IM 文本与回车独立写入 `8d9075ca`（124 项相关测试）。本轮没有重复改动或重跑这些无关用例；新实录验证了实际链路。
- 前轮源码构建和语音修复已加载。本次没有产品代码变更，未重复构建或重新打包 AppImage。通知预演发现演示 Codex 后台进程沿用旧应用 Socket，重建该演示后台连接后实际事件正常；不把环境重连写成软件兼容性修复。

当前十一段均有完整解码和哈希记录；保留的七段哈希与上次验证一致，四段新版重新完整解码、检查关键画面。新版均为 H.264、1600×900、30 fps，07b 有 AAC 音轨。新旧证据按片段区分，不代表整个产品通过发版验收。

录制后退出演示 Codex，恢复默认音频输入，保留演示库和游戏供复核。飞书演示网关保持关闭，未重新向聊天发送消息；K8s 演示资源沿用此前清理结果。最终剪辑与发布由用户处理。
