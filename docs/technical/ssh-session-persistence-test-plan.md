# 本地与 SSH 会话保持功能及性能测试计划

状态：待执行。本文定义测试要求，没有任何一行代表测试已经通过。

对应设计：[SSH 会话保持与复用实施计划](ssh-session-persistence-plan.md)。本文与主计划同时用于 Goal 验收；修改设计契约时同步修改用例和追踪关系。

## 1. 测试层级、执行规则与覆盖清单

| 层级 | 环境 | 证明范围 |
| --- | --- | --- |
| Unit | Vitest，注入 clock、随机源、transport、registry | 状态转换、取消、退避、并发、参数与权限校验 |
| Integration | 本地隔离 sshd/tmux 或等价可控 SSH fixture，真实 ssh2 | shell/PTY exec、认证、流事件、管理协议、代理和跳板 |
| UI | Playwright 启动真实 Electron，隔离 userData | 设置、标签、目录、焦点、输入、窗口与整个应用恢复 |
| Live | ali 的专属测试目录和 tmux server，加本地故障代理 | 在真实主机上保持原进程与完整恢复路径 |
| Perf | 固定本地环境加 ali，使用同一合成负载 | 时延、吞吐、内存、事件循环、公平性、长稳 |

E01-E06、F01-F60、U01-U10、A01-A08、PF01-PF10，以及本地 L01-L12、LP01-LP03，共 109 个验收条目，全部属于本轮必选。一个条目可展开为多个自动化测试；参数化组合需逐项记录，不能因为主条目有一个样本通过就认为所有组合通过。

P0 建立机器可读的 case manifest，包含 ID、阶段、实现文件、参数化变体、结果、命令、Git 提交、runId、artifact 路径。先验证 manifest 中用例 ID 唯一且数量完整；最终 gate 拒绝缺失、未运行、timeout 和 skip 的必选项。阶段执行只校验该阶段范围，最终执行校验全部条目。

平台范围：本轮强制 Linux 开发环境和 Linux 发布包验证；macOS/Windows 需保证类型、平台分支及现有跨平台构建规则不退化，原生平台实测作为单独发布证据，不能用 Linux 测试声称已经通过。Relay-shell 的“不支持保持”分支是必选用例，不把未支持能力伪装成绿色成功。

本地 L/LP 使用 Linux 实际 tmux 和实际 node-pty/Electron，不通过 SSH 绕回 localhost 代替。U05-U08、U10 的通用会话操作在 local/SSH 两种 targetKind 各运行一次；认证和断网 UI 用例仍只针对 SSH。Windows 原生与 WSL 本地保持属于范围外，但不支持提示和既有普通终端回归必须验证。

所有预期功能结果默认期限为本地夹具 10 秒、ali 30 秒；重试期限、连接超时和性能用例另有明确要求时使用其专属期限。依靠事件或条件等待，不用固定 sleep 掩盖竞态。Unit 中用虚拟时间覆盖长退避；长稳测试必须实际运行规定时长。

## 2. 夹具与数据

### 2.1 会话身份夹具

每轮生成独立 runId。远端测试 shell 记录以下合成数据：

- runId 和 shell nonce。
- shell PID，以及 Linux `/proc/<pid>/stat` 中的启动身份；与本次远端 boot 身份一起比较，避免 PID 复用误判。
- `AIOPSTERM_TEST_TOKEN` 环境变量和 runId 专属 cwd。
- shell 启动的合成任务 PID、启动身份及单调递增计数。
- tmux server label、session 标识、pane 标识及创建信息。

合成任务有截止时间，不无限写磁盘。计数文件与日志放在本轮临时目录，单文件上限 16 MiB，轮转或停止产生；保存退出码和结束原因。最终清理必须核实精确 runId 与路径，禁止通配符删除其他 tmux session 或用户目录。

证明“原任务保持”必须同时满足 shell 和任务的联合身份不变、cwd/环境不变、断线期间计数增长。仅看 shell PID、旧屏幕截图、tmux session 名称或最后一行输出都不够。

### 2.2 网络故障夹具

在本地运行受控 TCP 代理，仅代理被测 SSH 连接；独立控制连接直接观察 ali。

| 模式 | 注入方式 | 要覆盖的故障 |
| --- | --- | --- |
| Reset | 主动销毁被测双向 socket | 快速感知的连接中断 |
| Blackhole | 双向停止转发，保留 socket，缓冲固定上限并丢弃超额数据 | 链路失联，需要 keepalive 判定 |
| Half-close | 单向 EOF，另一方向暂存活 | end/close/error 顺序差异 |
| Delay | 受控队列延迟，不做无限缓冲 | RTT 20、100、300 ms |
| Flap | 周期性开放/阻断指定连接 | 重试计数与握手风暴 |
| Bandwidth | 令牌桶限速，输出标记速率 | 吞吐和背压 |

用户态 TCP 代理不能真实模拟 IP 丢包与内核重传；不得将其报告标成 packet-loss 测试。若需要真正丢包，只在本地隔离 network namespace 中使用 netem，不能修改 ali 全局网络。

夹具必须记录 faultApplied、faultCleared、新 socket 建立、认证完成、attachVerified、inputAccepted、首个任务响应等时间点。使用同一测试控制器的单调时钟计算跨阶段时延；不要直接相减两台未同步机器的墙钟。

### 2.3 UI 与输出夹具

UI 用临时 userData 和测试资产，使用实际 preload/IPC 链路。Unit double 可测状态，但不能充当 Live/UI 已完成证据。强制退出的是本轮启动的 Electron PID，不是用户正在运行的应用。

固定输出集包括 ASCII 行、中文宽字符、跨 chunk UTF-8、ANSI 颜色、光标移动、normal/alternate screen、鼠标与括号粘贴模式。文本采用合成数据；代码和测试脚本不加入 emoji 或装饰符号。

tmux 模式输出经过终端重绘，并不等于 shell 原始字节流。连续普通行输出可使用序号检查；TUI 使用解析后的屏幕单元格与模式状态检查，不能用两条原始 ANSI 流的 hash 相等作为正确性要求。断网期间超出 history 限额的日志允许截断，但必须显示截断状态。

## 3. 环境与基线用例

| ID | 前置条件和操作 | 必须断言 / 证据 |
| --- | --- | --- |
| E01 | 检查主计划的 aiopsterm 基线、两个 reference HEAD 和 origin；审阅当前 diff | 固定版本可定位；记录并保留其他任务改动；没有源码导入 |
| E02 | 通过资产入口解析 ali，核实目标账户和服务器身份，读取 OS、tmux、shell、CPU/内存 | 目标唯一；凭证不输出；记录实际能力，不能将无法解析的 ali 名称当成已连接 |
| E03 | 创建测试目录、专属 tmux server 和有期限计数任务；模拟测试失败并运行 teardown | 测试只影响本轮资源；teardown 幂等；遗留资源可由本轮 manifest 精确回收 |
| E04 | 检查 Node/Electron 原生模块 ABI；运行既有 SSH、flow、panel、IPC 和 renderer 关联测试 | 保存基线结果；失败注明是否既有问题，不能统称功能失败或用 backend double 替代实机 |
| E05 | 对网络代理分别执行 reset、blackhole、half-close、delay，另开观察连接 | 只影响测试连接；延迟可测量；黑洞不无限积累内存；控制通道仍可用 |
| E06 | 运行 case manifest 和结果 gate，故意移除一项、写入 skip 和 timeout 再检查 | gate 对三种不完整结果都失败；能关联命令、提交、结果和 artifact |

## 4. 功能用例

### 4.1 身份、持久化与授权

| ID | 前置条件和操作 | 必须断言 |
| --- | --- | --- |
| F01 | 同资产连续新建两个终端，再分屏、复制连接 | logicalSessionId 与远端 session 各自独立；只允许 transport 被共享 |
| F02 | 同一 create requestId 并发提交两次，模拟一次响应丢失后重试 | 只产生一个逻辑记录和一个远端任务；不同 requestId 可独立创建 |
| F03 | 同主机不同账户、同资产改变端点/跳板，再尝试恢复旧记录 | 不跨身份接回；变化需要重新核实绑定；不能只按 host 或标题去重 |
| F04 | 加载无新字段的旧配置、旧会话记录和新 schema，保存后重开 | 配置按规定迁移；旧普通终端不伪造 tmux 身份；schema 迁移幂等 |
| F05 | 注入截断文件、未知 schema、单条损坏记录、落盘中途退出 | 旧有效状态不被破坏；损坏记录隔离；下一次启动可诊断且不误启动任务 |
| F06 | 保存 attached/detached/missing 记录，重建 Main registry | attached 不能直接恢复为 running；目录先待核实，用户打开才连接 |
| F07 | 用另一个 BrowserWindow sender 操作不属于自己的 view，包含 write/resize/terminate/history | Main 拒绝；renderer 传入的 session ID 不能绕过绑定；日志不泄露内容 |
| F08 | 对同一任务依次测试 detach、再次 attach、terminate、forget；重复每个请求 | detach 保留 PID；terminate 只结束目标；forget 不发送 kill；结果幂等且未知结果不冒充成功 |

### 4.2 自动重连和竞态

| ID | 前置条件和操作 | 必须断言 |
| --- | --- | --- |
| F09 | 活动会话分别触发 reset、keepalive timeout、transport end/close 与 DNS/拒绝连接 | 仅可重试的网络错误进入 reconnecting；结构化原因一致，逻辑记录不删除 |
| F10 | 参数化 error/end/close/channel-close 的顺序及重复事件，正常 exit 也跑全部相关序列 | 每次故障最多一个重试；正常退出不复活；最终 exit/closed 不重复发出 |
| F11 | 虚拟时钟驱动持续失败，注入随机源上下边界 | 1/2/4/8/15/30 秒退避符合设计抖动范围和上限；不出现负延迟或多余 timer |
| F12 | 每次握手后不足 30 秒即断开，再让连接稳定满 30 秒 | 短暂成功不清零失败周期；稳定后重置；反复 flap 不形成快速循环 |
| F13 | 持续故障到达 10 分钟上限，然后触发手动重试 | 自动尝试停止并进入 failed；手动动作开始一个新周期；不存在后台残留重试 |
| F14 | 在等待、认证、shell callback、已 ready 四个时机执行手动 detach/terminate | timer 取消；迟到 ready 不恢复会话；无新 socket；关闭资源仅一次 |
| F15 | proxy/forwardOut Promise 迟到，旧 transport 在新 generation 后发 data/error/close | 旧资源释放；旧事件不改变新状态、不污染屏幕；取消后也不泄漏新建 socket |
| F16 | 模拟密码失效、MFA、取消、超时；同目标三个 view 同时恢复 | needs-auth 与网络重试分开；只弹一个认证入口；取消后不反复请求；答案不保存到会话表 |
| F17 | 初次未信任目标、已有正确指纹、服务端密钥变化、资产名称重用 | 未确认身份不开始持久恢复；变化不自动绕过；旧会话不会连到替代服务器 |
| F18 | 断线期间键盘输入、粘贴、二进制、宏、AI 写入；断线前提交一次计数加一命令 | 未连接写入返回不可写；恢复后无缓存补发；原命令远端计数最多加一，不因未知响应重发 |
| F19 | 重连期间连续 resize 100 次，含零、负数、NaN、过大值；恢复连接 | 无效尺寸拒绝或归一化；最后合法尺寸只发送一次；旁观 view 不改变尺寸 |
| F20 | 普通 SSH 模式先初次失败后成功，再网络断开重连；关闭自动重连再断开 | 开启时按策略恢复新 shell，状态说明新进程；关闭时不自动恢复；正常 exit 不重连 |

### 4.3 tmux 保持

| ID | 前置条件和操作 | 必须断言 |
| --- | --- | --- |
| F21 | tmux 缺失、不可执行、探测超时、输出过大四个夹具 | 返回具体能力错误；不挂死、不自动安装、不静默退化普通 shell |
| F22 | 最低支持版本和当前稳定版本运行必要能力探测，再使用不支持选项的夹具 | 支持版本通过；不支持者明确拒绝对应能力；文档标注实测版本，不仅解析版本号 |
| F23 | 远端创建成功后切断返回通道，随后重试初次创建 | 按原 pending 身份核查并复用原任务；不会多建 session 或重跑启动任务 |
| F24 | 删除本轮某个远端 session，再尝试自动/手动恢复 | missing 状态；没有执行 new-session；只有显式新建生成新逻辑 ID |
| F25 | 结束测试 session 后在测试 server 中创建同名新 session，再恢复旧记录 | 联合身份不匹配，拒绝当作原任务恢复；保留可诊断信息 |
| F26 | 请求带 shell 元字符、空格、换行、过长名、路径分隔符、tmux 目标模糊前缀 | 参数校验拒绝；后台管理只接受已登记 ID；恶意输入没有远端副作用 |
| F27 | 用户默认 tmux server 已有会话与自定义 hooks/options；创建持久终端后断开 | 专属 server 与用户配置隔离；不修改、分离或终止用户既有会话 |
| F28 | PTY exec 成功但 attach 失败；标记分片、重复、缺失；client 查询未匹配 | 只有本 attempt 的目标 client/session 正向确认后才 attached；握手消息不进入终端正文 |
| F29 | 在 tmux 中执行正常 exit、前台任务完成后 shell 继续、用户主动 tmux detach | 三者分别为退出、继续运行、已分离；不能一律判定网络断开并自动 attach |
| F30 | terminate 返回前断网，再恢复控制通道查询；重复 terminate | 先呈现结果未知；查询后确认 terminated 或仍存在；不终止其他 session |
| F31 | 只停止测试 server，模拟远端状态消失；再启动一个相同 label 的测试 server | 会话缺失或身份变化被识别；不会因 server label 相同就显示恢复成功 |
| F32 | 无视图保持 60 秒，期间计数增长；重新 attach；超过 history 容量输出 | 任务持续；只有有界历史保留；没有因无人连接设置被销毁；截断状态明确 |

### 4.4 复用、连接池与既有功能

| ID | 前置条件和操作 | 必须断言 |
| --- | --- | --- |
| F33 | 同一逻辑 session 打开三个 view，依次关闭一个、控制者、最后一个 | 其他视图有效；控制权按规则转移；最后 view 关闭才 detach，远端任务继续 |
| F34 | 输出高速递增序号时加入旁观 view，在快照期间继续输出 | 快照序列与增量原子衔接，无重复/缺口；超过缓冲上限时明确重新同步 |
| F35 | 两个 view 同时申请控制权，旧 view 带过期租约继续写入 | 最多一个成功控制者；过期 write/resize 被 Main 拒绝，不能仅靠 UI 禁用 |
| F36 | 只读 view 通过键盘、粘贴、快捷键、程序化 IPC 和 resize 发起操作 | 都不能改变远端；仍可选择、搜索、复制和查看历史 |
| F37 | 旧 terminal:create/write/resize/kill 调用方与新动作并存，覆盖 malformed envelope 和缺 bridge | 旧语义保持或所有调用方明确迁移；guard 拒绝畸形成功响应；不把旧 kill 偷改成 detach |
| F38 | 应用退出后删除/改名资产、删除密钥链项，再打开保存会话 | 改标题不串会话；目标或凭证缺失可见并可修复；不猜另一个相似资产 |
| F39 | 十个同 key 会话同时失联；并行加入不同账户、proxy、jump key | 同 key 最多一个在途握手；不同身份不合并；全局握手并发不超过四 |
| F40 | 一个共享连接下关闭 shell、换凭证、撤销连接和失效池 alias | shell 关闭不误杀兄弟会话；失效别名全清理；新凭证不错误复用旧认证连接 |
| F41 | 重连时运行独立 SFTP 和 background exec；正常状态再验证 ZMODEM 能力 | 不假称 exec/SFTP 属于保持的 shell；结果如实失败/成功；不自动重发；tmux 不支持的 ZMODEM 必须明确禁用或证明可用 |
| F42 | Classic/Codex 绑定已有逻辑终端，制造重连和明确终止 | 临时失联不产生新 AI 对话、不丢绑定；不可写被传回；实际终止按既有资源协议解除绑定 |
| F43 | Settings 开关保存、重载、导入旧配置、非法类型和值 | 默认值、归一化与持久化符合主计划；backend 读取同一权威配置 |
| F44 | 已有 plain/tmux 会话运行中切换保持开关和自动重连设置，再新建会话 | 创建时模式不变；新会话采用新配置；UI 不误标旧会话的保证 |
| F45 | 使用合成密码、私钥样本、MFA token、环境标记并触发失败和重连日志 | 非敏感元数据可查；目录、日志、截图、报告不出现任何秘密样本正文 |
| F46 | 构建、生成依赖图、审查资源包和 app.asar | 两个 reference 目录、其源码和路径没有进入依赖或包；未引入 Tabby/russh 或 tmux 编译依赖 |
| F47 | 通过 HTTP CONNECT 和 SOCKS 代理分别新建 tmux 会话、断开、恢复 | 路径与代理身份保持；原 shell/任务身份不变；代理失败按原原因报告 |
| F48 | 单跳 TCP forward 连接 tmux；分别中断目标通道和跳板连接，再恢复 | 精确恢复目标 session；独立故障分类；跳板和目标连接池均无泄漏 |
| F49 | 使用原 relay-shell fallback 夹具，启用 tmux 保持或发生嵌套目标退出 | 不在未经确认的目标 shell 注入命令；说明保持不支持；普通 relay 功能仍通过原回归 |
| F50 | 取消 capability probe、history、list-clients、terminate 查询；制造超时与 stderr 大输出 | 所有短命 exec channel 和 timer 有界释放；管理输出不混进 live terminal |

### 4.5 画面、历史与应用生命周期

| ID | 前置条件和操作 | 必须断言 |
| --- | --- | --- |
| F51 | 合成 TUI 和可用时的 vim/top/less 切换 alternate screen、颜色、中文宽字符、鼠标和 bracketed paste；期间断网 | 恢复后的 screen cells、光标和输入模式符合远端当前状态；没有半截字符或模式残留 |
| F52 | 普通输出中滚动查看旧历史，再断网恢复；另测 alternate screen 恢复 | 原已显示历史可查看；活动屏幕由 tmux 重绘；不将远端快照重复追加进 ANSI 流 |
| F53 | 获取正常、超过 5000 行、超过 1 MiB、包含控制序列的远端历史 | 只读显示/复制；按上限截断；不执行 OSC/剪贴板/命令；不读取其他 session |
| F54 | 每个字节边界拆分握手标记、UTF-8 和 ANSI 序列，并在半截时断线 | 旧 generation 解码器不污染新数据；管理标记过滤正确，不吞普通相似文本 |
| F55 | 新 generation 收到旧 ACK、重复 ACK、超额 ACK，再触发 safety resume | 新预算不被错误扣减；恢复不永久暂停；sent/acked 不出现非法负数 |
| F56 | 一个 view 停止 ACK 或 core worker 崩溃，另一个继续读取，之后恢复慢 view | 快 view 不被无限拖住；慢 view 按上限重同步；没有无限缓存；断开视图不挂起远端任务 |
| F57 | 附着时 reload renderer、销毁控制窗口、重新打开窗口 | 逻辑 session 和远端任务保留；视图有序重建；无旧 handler 重复发送 |
| F58 | 退出整个 Electron 应用再开；另对测试 Main 进程强制退出再开 | tmux 中原任务联合身份保持；目录可恢复；plain 不假称原进程保留 |
| F59 | 控制 view 崩溃，旁观 view 尝试接管；旧 view 迟到恢复写入 | 租约准确回收；新控制者可操作；旧租约不复活；尺寸不抖动 |
| F60 | 运行中、detached、missing、terminated 的记录分别 forget，重启应用 | 只删除本地记录；运行中明确保留远端；不会重建被忘记的记录或删除其他数据 |

### 4.6 本地会话保持

本地使用专属 runId、临时目录和 tmux server label；任务联合身份、计数期限、输出上限与清理方式沿用第 2.1 节。独立观察进程不能作为应用的子进程随退出一起终止。以下用例在 P3L 实现 backend 断言，P4 补足实际 UI，P6 全部验收。

| ID | 前置条件和操作 | 必须断言 |
| --- | --- | --- |
| L01 | 检测 Linux 本机 tmux；分别测试缺失、不可执行和不支持平台的能力结果 | 支持时使用本机 tmux；缺失不静默退化且不自动安装；普通本地 PTY 不受影响 |
| L02 | 用不同 shell profile、cwd 和测试环境先后创建两个本地持久终端；第二次改变启动环境 | 两个独立任务；各自 profile/cwd/token 正确，不沿用早先 tmux server 的旧环境；秘密不出现在 argv 或日志 |
| L03 | 本地任务持续计数，关闭标签并等 10 秒，从目录重新打开，循环 5 次 | shell 与任务联合身份不变，计数增长，目录和环境不变；关闭仅 detach |
| L04 | 正常退出整个测试 Electron，确认 Main/renderer 都已退出，独立观察 10 秒再重启；3 轮 | 本地任务仍运行；恢复接回原进程；不能以托盘常驻、仅 reload 或重开 shell 代替 |
| L05 | 对本轮 Main 强制退出，再启动独立 Electron 进程，循环 3 次 | 本地 tmux server 和任务未被进程树清理；目录可恢复；没有额外 shell/任务 |
| L06 | 关闭本地 attach client 后自动恢复；对照用户 detach、任务正常 exit、明确 terminate | 非预期 client 丢失可以精确接回；三种主动/终态不复活；逻辑 ID 不变，generation 单调增加 |
| L07 | 用两个窗口查看本地同会话并接管；对照新建、复制连接、分屏 | 复用入口共享同任务，新建默认独立；只读输入/resize 拒绝；关闭一个 view 不伤另一个 |
| L08 | 只结束本轮本地 tmux server，再恢复保存记录；另用同名新 session 替代旧记录 | missing/身份不匹配，不偷偷重建；机器重启后的失效状态按相同规则处理，不声称可复活 |
| L09 | 本地与 SSH 建立相同显示名称的任务，分别 terminate/forget；重复请求 | adapter 和 targetBinding 隔离，精确操作目标；forget 不杀任务，terminate 不跨本地/远端 |
| L10 | 本地合成 TUI、中文宽字符、normal/alternate screen、历史查询、ACK 中断与多 view 快照 | 与共享屏幕/历史/背压契约一致；不因本地适配绕过 generation、租约和缓冲上限 |
| L11 | 测试本地保持开关的默认、保存、重载、运行中切换；运行普通本地 shell 和 AI/终端工具 | 本地与 SSH 设置独立；已创建模式不变；普通 PTY/AI 写入语义不退化；平台能力准确显示 |
| L12 | 本地 create 成功后丢响应、迟到 PTY callback、取消管理子进程、重复退出和清理 | 幂等恢复原任务；只有本轮 attach client 被取消，所有短命进程/timer 回收；默认用户 tmux server 不受影响 |

## 5. 用户界面验收

| ID | 操作 | UI 与后端联合断言 |
| --- | --- | --- |
| U01 | 打开终端设置，切换两个开关并重启；检查中文和英文 | 文案区分重连与保持、标明 tmux 依赖；值真正持久化，不只是开关显示变化 |
| U02 | tmux 会话运行合成任务，reset/blackhole 后恢复 | 原标签、标题、焦点和画面保留；状态轻量显示恢复中；成功后能继续操作原任务 |
| U03 | 普通 SSH 故障恢复 | 明示新 shell，不展示“原任务已恢复”；旧输出不作为进程存活证明 |
| U04 | 恢复中输入、粘贴、运行快捷命令，然后取消重试 | 不可写反馈清楚；取消后无后台重连；输入不会在之后自动执行 |
| U05 | 关闭 tmux 标签，再从会话目录打开；再使用结束会话 | 关闭语义是保留任务；结束入口区别明确；远端 PID 结果与操作一致 |
| U06 | 退出应用并重开，打开已存会话；同时准备一条 missing 记录 | 目录可见；打开后核实；丢失记录有独立新建入口，不自动替代原任务 |
| U07 | 打开两个窗口查看同会话，接管并调整尺寸 | 只读状态可见；控制权反馈正确；旁观操作不影响远端输入和尺寸 |
| U08 | 打开远端历史、搜索和复制；请求超过上限 | 与 live 画面分开；截断提示存在；没有管理协议文本泄漏 |
| U09 | MFA、用户取消、tmux 缺失、原 session 丢失、host-key 变化 | 每种原因有准确状态和对应操作；不重复弹窗，不抹掉用户当前焦点 |
| U10 | 键盘导航、不同窗口大小、threaded 和既有 fallback renderer；检查控制台 | 操作可达，无遮挡；恢复和历史路径不依赖某一绘制后端；无新增异常 |

U02、U05-U07 必须保留截图或短视频、Main 生命周期日志和远端身份记录三类证据。截图只辅助判断 UI，不能替代远端断言。

## 6. ali 实机验收

| ID | 前置条件和操作 | 必须断言与重复次数 |
| --- | --- | --- |
| A01 | 实际 backend 连接 ali，创建专属 tmux session，设置 cwd/token 并启动有期限计数任务；断开 10 秒再恢复 | shell、任务联合身份及 cwd/token 不变，断线期间计数增长；reset 和 blackhole 各 5 轮 |
| A02 | 同 A01，断开 60 秒；首次恢复失败一次，再放行 | 恢复仍是原任务，正常退避；无第二个 session；连续 3 轮 |
| A03 | 在实际 UI 使用合成全屏 TUI，并用 ali 已安装的 vim/top/less 之一补充验证；断开恢复后输入退出 | 屏幕和模式正确、输入可用；自动化 TUI 5 轮，实际工具每个可用者 1 轮；无工具时自动化 TUI 仍必测 |
| A04 | detached 时精确删除本轮一个远端 session，尝试恢复；另测重复终止 | missing/terminated 如实显示；无新进程；未影响兄弟 session；每种 3 轮 |
| A05 | 关闭标签再从目录打开；测试应用正常退出后重开 | 同一远端任务仍在；逻辑目录身份不变；各 3 轮 |
| A06 | 强制退出本轮 Electron Main 再启动，随后验证 lease、目录和原任务 | 确认是独立 PID 启动；恢复成功且无重复连接/任务；3 轮 |
| A07 | 两个 UI 窗口查看同一任务；转移控制权，关闭控制窗口再接管 | 只读拒绝写入，其他窗口保留，原进程不变；5 次接管循环 |
| A08 | 同时保持 10 个轻量任务，注入群体断线恢复；结束其中 5 个，其余 detach 后再清理 | 每个任务身份正确，握手并发有界，兄弟不被误杀；3 轮；最终远端和本地临时资源清零 |

ali 不承担测试 sshd 重启、整机断网、系统重启或无限 CPU/输出负载。缺失能力、恶意服务端和身份替换在隔离 fixture 验证。远端状态丢失用精确结束测试 session/server 来覆盖，不触碰用户 server。

## 7. 性能测试方法与门槛

以下数字为本计划设定的候选验收门槛，不是已有实测数据。P0 固定环境和 baseline；如因环境测量证明门槛不可用，先在报告中给出原始数据、原因和修订依据，再同步修改计划，不能在失败后直接调宽断言。

性能报告记录硬件、OS、Node/Electron/tmux 版本、Git 提交、网络 RTT、终端尺寸、scrollback、可见 view 数、负载 seed、并发数、运行次数和采样频率。CPU 百分比统一按一个逻辑 CPU 为百分之百记录；报告本地 Main、renderer、workers，以及远端 tmux 与合成任务的独立开销。

比较基准：baseline 为 P0 的原 SSH 实现；candidate-plain 用于检测新增机制的普通模式退化；candidate-tmux 用于验证保持模式自己的性能。相同输出集、配置和主机下比较。每轮预热 30 秒，测量至少 60 秒，顺序交替，普通性能场景至少 5 轮；PF09 使用独立长稳规范。

| ID | 场景与测量 | 验收门槛 |
| --- | --- | --- |
| PF01 | 普通 SSH 首次连接与正常交互基线，candidate-plain 对比 baseline；100 次小命令往返 | 首次连接 p95 增量不超过 max(基线百分之十, 100 ms)；客户端自身输入/渲染附加 p95 不超过 50 ms；报告 RTT 与远端执行时间 |
| PF02 | reset 与 blackhole 的发现时延；单会话故障解除后的恢复，网络 RTT 不超过 100 ms，无 MFA | reset 发现 p95 不超过 2 秒；blackhole 不超过实际 keepalive interval 乘 countMax 加 5 秒；故障解除后 p95 不超过当前最大重试等待 30 秒加 5 秒握手/attach，即 35 秒；唤醒后成功 attempt 的 p95 不超过 5 秒 |
| PF03 | 每 view 5000 行历史，1/10/20 个空闲持久会话，每轮 5 分钟；与相同负载 candidate-plain 对比 | 20 会话时本地总额外 RSS 不超过 128 MiB，空闲额外平均 CPU 不超过一个核心的百分之三；远端 tmux 与任务各自计量；不得每会话新增常驻 worker |
| PF04 | 受控顺序行输出：单 session 1 MiB/s 持续 60 秒，另测 10 session 各 100 KiB/s；单可见 view，其余后台 | candidate-plain 有效处理率不少于 baseline 百分之九十，candidate-tmux 不少于同负载 plain 百分之八十；活动输入 p95 不超过 150 ms；末尾标记最终可见，保留的最后一段历史与预期序列一致 |
| PF05 | 5000 行远端历史读取、晚加入 view 快照、断网后 TUI 重绘；RTT 不超过 100 ms | 单次历史请求至可展示 p95 不超过 2 秒，快照至交互 p95 不超过 2 秒；历史最多 1 MiB，晚加入快照/增量暂存每 view 最多 4 MiB；超限有明确重同步或截断 |
| PF06 | 本地 fixture 50 个同目标 session 同时失联，再测试 10 个不同目标；ali 仅 10 个 | 同 key 同时握手不超过 1，全局不超过 4；同 key 不出现每 view 重复认证；无忙循环；所有等待均满足退避/取消规则，恢复分布完整报告 |
| PF07 | 停止一个 view 的 ACK 30 秒，维持另一个 view 交互，再恢复慢 view；高速输出重复 5 轮 | 单会话 transport 待读取预算保留 64 KiB 至 2 MiB 的既有有界策略；软件队列超过上限必须停读/重同步；无无限增长；慢 view 恢复不晚于其重同步完成后 2 秒；健康 view 仍可操作 |
| PF08 | 100 轮创建/attach/detach/terminate，随后冷却 60 秒；记录 timers、listeners、FD、socket、RSS | 自有 timer/listener/活动连接计数回到基线；本地 FD 差不超过 5 且能归因；远端测试 session 为零；RSS 增量不超过 32 MiB，不能用未受控 GC 单次采样判定 |
| PF09 | 本地 fixture 8 小时、20 会话；ali 2 小时、5 会话，每 2 分钟注入 5 秒故障；每会话每秒一条短记录 | 零进程身份错配、零非预期终止、零重复命令；预热后 RSS 趋势不超过 5 MiB/小时，结束时增量不超过 64 MiB；无资源随重试次数线性增长；任务磁盘输出保持上限 |
| PF10 | PF04/PF06 期间采样 Main event-loop delay、UI 输入到呈现、窗口切换和长任务 | Main delay p95 不超过 50 ms、p99 不超过 100 ms；测试新增 UI 主线程任务不超过 200 ms；窗口切换 p95 不超过 200 ms；后台 view 不持续绘制 |

PF04 的输入压力为可持续合成速率，不要求远端进程以“最快速度无限输出”。若链路带宽不足，吞吐绝对速率在同机 fixture 验证；ali 报告实际可用带宽与相同比例测试，不能把瓶颈混算成 renderer 回归。10/20/50 会话的高负载以本地隔离环境为主。

PF04 有效处理率统一定义为合成任务产生的已知数据量除以“触发任务到末尾标记在终端呈现”的端到端时间；另行报告实际 SSH 接收字节、解析时间和绘制时间。tmux 可以合并中间屏幕更新，因此不要求客户端看到每个中间重绘，也不以 tmux ANSI 字节量与普通 SSH 原始字节量直接比较。PF02 的每种故障至少采集 30 个恢复样本再计算 p95；A 组的小样本循环主要证明功能，不替代性能采样。

背压上限是软件队列限制，不是操作系统、ssh2、tmux 和 renderer 所有内存总和的精确上限；它们均需独立采样。PF07 还需检查旧 generation 的 ACK 和旧 safety timer 不影响新 generation。

“恢复时间”的起点是故障夹具确认放行，终点是本次 attachVerified 且一个合成输入获得任务回应。连接已建立但 tmux 还没接回不算完成。认证需要人工交互的场景不计入免交互 p95，必须单列耗时和结果。

### 7.1 本地性能门槛

本地 baseline 为原本地 PTY，candidate 为本地 tmux 模式。记录 node-pty、tmux、shell、硬件、终端尺寸及输出集；不把 SSH RTT 计入本地门槛。采样和 artifact 规范沿用第 7 节。

| ID | 场景与测量 | 验收门槛 |
| --- | --- | --- |
| LP01 | 30 次本地 create、detach/attach；100 次合成输入响应；单 session 1 MiB/s 输出 60 秒，5 轮 | attach 到可输入 p95 不超过 1 秒；首次创建相对普通 PTY 增量 p95 不超过 500 ms；正常交互端到端 p95 不超过 100 ms；有效处理率不少于普通 PTY 百分之八十 |
| LP02 | 20 个本地空闲会话保持 5 分钟，100 轮 attach/detach/terminate 后冷却 60 秒 | Main/renderer/tmux 合计额外 RSS 不超过 128 MiB，平均额外 CPU 不超过一个核心的百分之三；结束测试任务后自有 timers/连接/短命子进程回到基线，FD 差不超过 5 且可归因；detach 仍存活的任务不是泄漏 |
| LP03 | 10 个本地有期限计数任务运行 2 小时，每 5 分钟正常退出并重开测试应用，另执行 3 次 Main 强制退出 | 原任务联合身份全部保持，零重复命令；每次恢复可操作；预热后 RSS 趋势不超过 5 MiB/小时，结尾增量不超过 64 MiB；最终显式 terminate 后本轮任务全部清理 |

本轮不强制让开发机器真的休眠或重启，以免中断其他工作。状态恢复通过独立应用重启和受控 tmux server 丢失验证；文档明确本地休眠时执行可能暂停，系统重启后原进程已经消失。

## 8. 实现文件与命令入口

### 8.1 复用现有测试

优先扩展已有测试与夹具，不新建一套平行配置：

- `tests/ssh-terminal-backend.test.ts` 与 `tests/ssh-terminal-session-auth-runtime.test.ts`。
- `tests/terminal-sessions-ipc.test.ts`、`tests/terminal-backend.test.ts` 与 `tests/terminal-backend-guards.test.ts`。
- `tests/terminal-workspace-session-runtime.test.ts`、`tests/terminal-workspace-shell-runtime.test.ts` 与 `tests/terminal-panel-runtime.test.ts`。
- `tests/terminal-flow-control.test.ts`、`tests/terminal-data-coalescer.test.ts` 与 `tests/threaded-terminal-*.test.ts`。
- `tests/workspace-config-runtime.test.ts`、AI terminal bridge/绑定相关测试，以及 SSH proxy/agent/tunnel/SFTP/ZMODEM 关联回归。
- `tests/live-ssh-backend.test.ts` 的私密参数方式；该文件的现有普通 shell 用例不能替代新的持久会话 Live 用例。

建议新增聚焦测试：`tests/ssh-session-supervisor.test.ts`、`tests/ssh-persistent-session.test.ts`、`tests/terminal-session-registry.test.ts`、`tests/live-ssh-session-persistence.test.ts`、一个真实 Electron 会话保持 spec，以及 `scripts/test-ssh-session-persistence.mjs` 测试入口。最终名称在 P0 case manifest 固定。

本地增加 `tests/local-persistent-session.test.ts` 并扩展 `tests/local-terminal-backend.test.ts`；共享目录、UI 和租约用例按 targetKind 参数化，不复制整个 SSH runner。统一入口名称保持兼容，但新增 `--suite local` 和 `--suite local-performance`，P0 建立入口，P3L/P5 填充实现，P6 required-results 包括全部 L/LP。

当前工作区另有尚未提交的 regression/CI 配置工作。实施开始先查看其最终落点并兼容，不能覆盖别人的 runner，也不能把它的测试变更顺带纳入本功能提交。

### 8.2 已有可执行命令

以下为调研时已有命令，实施前检查实际 package.json：

```bash
npm run typecheck
npm run audit:i18n
npm run audit:state-ownership
npm run audit:client-mocks
npm run audit:package-config
npm run native:ensure:node
npx vitest run tests/ssh-terminal-backend.test.ts tests/terminal-flow-control.test.ts tests/terminal-panel-runtime.test.ts
npm run test:live:ssh
npm run build
npm run test:e2e
```

这些命令顺序列出，不意味着每阶段都重复全套。Node 测试与 Electron UI 测试按仓库原生模块切换流程顺序执行，避免同时重建同一 node_modules。发布阶段使用项目实际 Linux build/verify 入口检查产物。

`test:live:ssh` 现有参数为 `AIOPSTERM_LIVE_SSH_ENABLE`、`AIOPSTERM_LIVE_SSH_HOST`、`AIOPSTERM_LIVE_SSH_PORT`、`AIOPSTERM_LIVE_SSH_USERNAME`、`AIOPSTERM_LIVE_SSH_PASSWORD` 或 `AIOPSTERM_LIVE_SSH_PRIVATE_KEY`，另有 passphrase、timeout 和 remote dir。实际 ssh2 测试不能假定自动读取 OpenSSH 的 ali 别名；必须解析为明确目标并使用现有安全凭证入口。

### 8.3 P0 必须补齐的统一入口

下面是待实现的命令契约，目前尚不存在。P0 必须让它们真实可执行并记录到开发文档，之后各阶段按同一入口出报告：

```bash
node scripts/test-ssh-session-persistence.mjs --suite unit
node scripts/test-ssh-session-persistence.mjs --suite integration
node scripts/test-ssh-session-persistence.mjs --suite ui
node scripts/test-ssh-session-persistence.mjs --suite live --target ali
node scripts/test-ssh-session-persistence.mjs --suite performance
node scripts/test-ssh-session-persistence.mjs --suite soak
node scripts/test-ssh-session-persistence.mjs --suite local
node scripts/test-ssh-session-persistence.mjs --suite local-performance
node scripts/test-ssh-session-persistence.mjs --verify-required-results
```

runner 负责参数校验、夹具生命周期、统一 runId、native runtime 前置检查、secret redaction 和结果导出，不把所有测试逻辑写在一个脚本中。`--target ali` 是 runner 的测试资产选择器，不等于向 DNS 直接传 ali；非唯一目标必须失败。

Unit/Integration 可在开发与 CI 自动运行；UI 放在有关变更及 P4/P6；Live 按明确 opt-in 执行；性能按 P0/P2/P4/P5 需要运行；长稳在 P5 独立 job 运行并保留可轮询进度。未配置 Live 凭证时普通日常测试可跳过，但 P6 的 required-results 检查必须拒绝缺失 Live 证据。

## 9. 报告、文档与失败处理

每次执行至少产生以下 artifact，内容只含合成测试数据：

| Artifact | 必要字段 |
| --- | --- |
| `environment.json` | 主机类别、软件版本、提交、reference 版本、配置摘要、资源上限 |
| `cases.json` | 每个用例及变体的 ID、pass/fail/skip/not-run、开始结束时间、命令、原因、附件 |
| `lifecycle.jsonl` | logicalSessionId、generation、状态、错误类别、retryAttempt、时间点；不含凭证正文 |
| `remote-identity.json` | 故障前/中/后联合身份、cwd/token 的测试值、任务计数和精确清理结果 |
| `performance.json` | 所有样本、单位、baseline/candidate、p50/p95/p99、资源曲线与统计方式 |
| `ui/` | 合成场景截图、录屏或 trace，与用例 ID 对应 |
| `cleanup.json` | 本轮创建和销毁的目录、session、socket、PID；残留及恢复清理结果 |

验证摘要统一进入 `docs/technical/ssh-session-persistence-validation.md`，按阶段记录“做了什么、命令、结果、失败原因、修复提交、证据目录”。原始 artifact 放在 Git 忽略的测试结果目录，不将大量截图或 secret 注入主仓库。需要长期保留的 CI artifact 在摘要中保存可访问位置和校验摘要。

用户使用文档、架构文档、性能说明和开发命令的交付范围见主计划第 8 节。文档中的能力和数值必须与实测一致；尚未实施的接口继续标注计划，不能提前宣称支持。

失败处理规则：

1. 先区分产品缺陷、测试缺陷和环境故障，保留原始失败证据。
2. 产品缺陷先补可失败的回归，再修复，重跑该用例及受影响关联用例。
3. 夹具故障修复后重跑，不能把原结果改成通过；保留新旧 runId。
4. 涉及共享连接池、生命周期、输入或背压的修复，需要重跑对应功能组和相关性能组。
5. P0 发现的既有无关失败单独登记和归因，不吞掉，也不默认扩展成其他项目重构任务。最终报告准确区分本任务结果和项目既有问题。
6. 无法访问 ali 或缺少必需依赖时可以继续本地工作，但实机用例保持未验证；最终不得宣称整个实施 Goal 完成。
7. 停止测试时取消本轮计时器和连接，清理专属远端资源；不要等待未归属的 SSH 进程，也不要使用全局 kill-server。

## 10. 最终验收映射

| 设计目标 | 主要验收条目 |
| --- | --- |
| G01 连接恢复 | F09-F17、F20、F39、F47-F49、U02-U04、PF02、PF06 |
| G02 进程保持 | F21-F32、A01-A06、PF09 |
| G03 身份保持 | F01-F06、F15、F25、F38、F42、F55、A05-A06 |
| G04 分离生命周期 | F08、F14、F29-F33、F60、U05-U06、A04-A05 |
| G05 应用恢复 | F06、F38、F57-F59、U06、A05-A06 |
| G06 会话复用 | F07、F33-F36、F56、F59、U07、A07 |
| G07 状态诚实 | F17、F20-F22、F24-F25、F28-F31、F49、U03、U09 |
| G08 输入可靠 | F18-F19、F35-F37、F41-F42、U04、U07 |
| G09 性能有界 | F11-F13、F34、F39、F50、F53、F55-F56、PF01-PF10 |
| G10 可交付 | E01-E06、F43-F46、全部 U/A、P6 文档及 Git 证据 |

本地补充映射：G02/G05 对应 L02-L06、L08、LP03；G03/G04 对应 L03-L09、L12；G06 对应 L07、L10；G07 对应 L01、L06、L08、L11；G08 对应本地参数化的 F18/F35/F36 及 L07/L11；G09 对应 LP01-LP03；G10 包括全部 L/LP、本地使用文档和 P3L 提交。F18 的本地参数化使用 client 不可用状态，不伪造本地 SSH 网络故障。

最终验收必须同时满足主计划的完成清单和本测试清单。只给出计划、只完成下载、只运行 unit、只通过连接演示，均不等于后续实施 Goal 已完成。
