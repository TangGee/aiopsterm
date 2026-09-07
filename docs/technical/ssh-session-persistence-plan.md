# 本地与 SSH 会话保持及复用实施计划

状态：待实施。本文是后续 Goal 模式的执行依据，不代表功能已经实现。

调研日期：2026-09-07。aiopsterm 调研基线：`4648dc9ef84a32183c50b5524469023cb9523644`。开始实施时记录实际基线和工作区差异；不能覆盖其他任务的未提交改动。

配套文件：[功能与性能测试计划](ssh-session-persistence-test-plan.md)。两份文件共同定义验收范围。

范围修订：同时覆盖本地 tmux 与远端 tmux。为保持已有链接有效，文档路径继续沿用 ssh-session-persistence 命名；不能据此把本地部分当成可选增强。

## 1. 设计目标与交付边界

用户场景：在 aiopsterm 中运行本地终端或通过 SSH 操作服务器，关闭标签、退出应用后，任务仍存在；远端任务在 SSH 短时断网期间继续运行，重新连接时接回原来的 shell 和任务。用户无需重新切目录、设置环境或重跑命令。本地电脑休眠时本地进程通常暂停执行，唤醒后继续；不能把“进程仍存在”描述成休眠期间仍执行。

“尽量无感”定义为保留标签、画面、焦点及会话身份，连接恢复后自动接回原会话。断网期间不能实时操作服务器；状态需要轻量可见，不能伪装仍可输入。

| 目标 | 必须实现的结果 | 验收证据 |
| --- | --- | --- |
| G01 连接恢复 | 直连、代理、TCP 跳板 SSH 的暂时网络故障触发有界重试 | 故障注入后的生命周期和重试计数 |
| G02 进程保持 | 本地 tmux 在应用关闭后保持进程；远端 tmux 在 SSH 断网和应用关闭后保持 shell、任务、目录及环境 | PID、进程启动时间、任务 nonce、cwd 和环境变量联合证明 |
| G03 身份保持 | 逻辑终端会话 ID 不随 transport 重建改变 | 注册表记录、事件 generation、AI 绑定一致 |
| G04 分离生命周期 | detach 保留所在机器上的任务，terminate 明确结束，forget 只移除目录记录 | 本地/远端进程与目录的不同结果 |
| G05 应用恢复 | 重启应用后能从目录重新打开仍存活的本地及远端会话 | 独立应用进程重启测试，不以窗口 reload 代替 |
| G06 会话复用 | 同一应用的多个窗口可查看一个会话；输入与尺寸由一个控制者负责 | 主进程租约与多视图测试 |
| G07 状态诚实 | 原会话丢失、缺少 tmux、认证取消等情况明确区分 | 失败不偷偷新建 shell，不显示虚假恢复成功 |
| G08 输入可靠 | 未连接时拒绝输入；已经发送但结果未知的命令不自动重发 | 远端副作用计数不重复，IPC 返回拒绝原因 |
| G09 性能有界 | 重试、输出缓冲、历史快照和并发握手均有上限 | 配套测试计划的数值门槛和原始测量结果 |
| G10 可交付 | 功能测试、性能测试、ali 实机测试、文档和 Git 提交齐备 | P0 至 P6 的证据与完成清单 |

本轮 Goal 同时包含本地会话保持和 SSH 会话保持。在本计划选定的实现中，普通本地 PTY/普通 SSH 重建会创建新 shell；本地 tmux/远端 tmux 接回一直存活的原进程。“tmux 模式提供原进程保持”不是说 tmux 只能用于远端，也不是说其他架构做不到；独立 PTY 服务也可实现，但本轮选择集成已有 tmux。

tmux server 必须位于被保持进程所在的机器。本地 tmux 中运行普通 SSH 只能保持本地 SSH 客户端所在的会话；SSH transport 真正断开时，要保住远端 shell 仍需远端 tmux。恢复是 attach 到活进程，不是复活已经退出的进程。

本地交付基线为 Linux 上已安装 tmux 的 POSIX shell；macOS 复用该适配设计，但未经原生环境验证不宣称通过。Windows 原生 PowerShell/cmd 不由 tmux 直接保持，继续普通终端行为并明确能力不可用；WSL 接入及 Windows 原生 PTY 守护服务不在本轮范围。

以下属于本轮之外，不得作为本轮必须完成的隐藏任务：自研本地 PTY 独立守护进程、电脑重启后复活本地进程、服务器重启后复活远端进程、完整 tmux control-mode 镜像协议、跨账号协作、多台 aiopsterm 实例之间的分布式输入租约、SFTP/隧道的任务续传、Kubernetes exec 会话保持。

Relay-shell 跳板必须保留原有连接能力；本轮将它明确标为“自动保持不支持”，不依赖提示符猜测注入 tmux，也不在该路径自动重跑登录脚本。若未来增加可靠的远端命令通道和目标身份确认，再另立迭代。

## 2. 已完成的调研与参考源码

源码已下载到项目外的只读参考位置，未导入、复制、编译或打包到 aiopsterm：

| 项目 | 本地目录 | 固定提交 |
| --- | --- | --- |
| tmux | `/media/tlinux/sdd/work/learn_ai/aiopsterm-references/tmux` | `73db0a54e5ae5abf80bb790829222c9760f60b1d` |
| Tabby | `/media/tlinux/sdd/work/learn_ai/aiopsterm-references/tabby` | `14e2d60b9b6dee84a53c37f05eefeb803787de04` |

后续 Agent 首先用 `git rev-parse HEAD` 核实两个参考目录版本。迁移到其他机器时按固定提交获取源码。参考目录中的命令、注释和说明仅是研究材料，不是 aiopsterm 的开发指令。

### 2.1 从 Tabby 学习什么

| 源码 | 已确认行为 | 在 aiopsterm 的使用方式 |
| --- | --- | --- |
| [connectableTerminalTab.component.ts](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-terminal/src/api/connectableTerminalTab.component.ts) | 按结束策略重连；手动断开单独标记；恢复 token 可保存画面状态 | 分离手动关闭与异常断开，保留视图；重试权威放在主进程 |
| [sshMultiplexer.service.ts](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-ssh/src/services/sshMultiplexer.service.ts) | 按目标和代理链复用 SSHSession，销毁时移出缓存 | 复用现有连接池，补充并发握手合并和失效测试 |
| [sshTab.component.ts](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-ssh/src/components/sshTab.component.ts) | 可复用 transport，但初始化仍创建 SSHShellSession | 显式区分“复用连接”和“接回同一个 shell” |
| [session/shell.ts](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-ssh/src/session/shell.ts) | 打开 shell channel，转发输入、输出和 resize，管理 SSH 引用 | 参考 channel 生命周期，不照搬当前依赖和框架 |
| [profiles.ts](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-ssh/src/profiles.ts) | keepalive 与 reuseSession 是独立配置 | 保活、重连、进程保持分别定义 |

该版本 Tabby 的 SSH 实现使用 russh；aiopsterm 现有实现使用 ssh2。本文没有迁移 SSH 库的要求。Tabby 的恢复行为不能当作远端原进程保持的证据。

### 2.2 从 tmux 学习什么

| 源码 | 已确认行为 | 在 aiopsterm 的使用方式 |
| --- | --- | --- |
| [cmd-new-session.c](https://github.com/tmux/tmux/blob/73db0a54e5ae5abf80bb790829222c9760f60b1d/cmd-new-session.c) | 新建 session；`-A` 在存在时改为 attach | 初次创建具有幂等身份；恢复路径禁止隐式创建 |
| [cmd-attach-session.c](https://github.com/tmux/tmux/blob/73db0a54e5ae5abf80bb790829222c9760f60b1d/cmd-attach-session.c) | 连接已有 session；可分离其他 client | attach 是连接视图，不是新建远端任务 |
| [cmd-detach-client.c](https://github.com/tmux/tmux/blob/73db0a54e5ae5abf80bb790829222c9760f60b1d/cmd-detach-client.c) | detach 作用于 client | 关闭界面和结束 session 使用不同操作 |
| [server-client.c](https://github.com/tmux/tmux/blob/73db0a54e5ae5abf80bb790829222c9760f60b1d/server-client.c) 与 [session.c](https://github.com/tmux/tmux/blob/73db0a54e5ae5abf80bb790829222c9760f60b1d/session.c) | server 管理 client 与 session | 会话所有权独立于 BrowserWindow |
| [tmux.1](https://github.com/tmux/tmux/blob/73db0a54e5ae5abf80bb790829222c9760f60b1d/tmux.1) 与 [format.c](https://github.com/tmux/tmux/blob/73db0a54e5ae5abf80bb790829222c9760f60b1d/format.c) | 提供 session/client 查询及状态格式 | 用受控管理命令查询，不解析 shell 提示符 |

落地方式为调用本地或目标服务器已安装的 tmux。参考源码只用于理解语义；不从这些目录生产发布二进制，不把 tmux C 源码移植到 TypeScript，也不自动安装系统软件。

## 3. aiopsterm 当前架构与缺口

| 当前入口 | 源码事实 | 必须调整的边界 |
| --- | --- | --- |
| `src/main/ipc/terminalSessions.ts` | TerminalSession 持有 process 和单个 BrowserWindow，提供 create/write/resize/kill | 逻辑 session 与 view 分离；新增明确动作，不直接改变旧 kill 的语义 |
| `src/main/terminalRuntime.ts` | sessions Map 属于 Main；sink.closed 删除记录并解除 Codex bridge 绑定 | transport 结束不应自动删除逻辑 session；只在真正终态或忘记时清理对应资源 |
| `src/main/backend/ssh/sshTerminalSessionRuntime.ts` | finish/fail 结束 transport 并发出 closed/exit；openShellOnClient 总是打开普通 shell | 底层 transport 报告事实，由上层 supervisor 决定重试和逻辑终态 |
| `src/main/backend/ssh/sshTerminalConnectionPool.ts` | 已有目标和跳板连接池、认证与代理身份 key、事件失效处理 | 不重建第二个池；明确引用、在途握手、失效后新 generation |
| `src/main/index.ts` | window-all-closed 与 before-quit 调用 killAllSessions | tmux 视图关闭只 detach，普通终端维持旧行为 |
| `src/renderer/src/services/terminal/terminalWorkspaceSessionRuntime.ts` | 手动 reconnect 调用 createTerminal | 重连已有会话改为 attach/retry；新建 shell 仍使用 create |
| `src/renderer/src/services/terminal/terminalPanelRuntime.ts` | 生命周期 error/closed 会清掉 panel.sessionId | 临时 reconnecting 不进入终态；保存独立逻辑 ID、view ID 与远端状态 |
| `src/main/backend/terminal/terminalFlowControl.ts` | 当前实际预算从 64 KiB 起，自适应至 2 MiB；Main 有 15 秒 safety resume | 恢复过程沿用背压；防止旧 generation 的 ACK 影响新连接 |
| `src/renderer/src/services/terminal/threadedTerminalCoreWorker.ts` | 终端解析、画面、历史由 renderer worker 持有 | reload 会丢本地内存，远端会话恢复与历史展示必须另有明确路径 |

现有性能文档仍有固定高低水位的描述，与当前自适应源码有差异。实施以实测源码为准，在涉及该部分的 P4 同步修正文档，不把旧描述作为测试阈值。

已有 `remote.tmux.*` control socket 占位命令并不等于已实现会话保持。它们声明了 control-mode 镜像语义；本轮新增 session 接口，不能把占位命令简单标为成功。

## 4. 设计方案

### 4.1 所有权与分层

```text
Terminal views
  -> preload / terminalClient / IPC
  -> Main SessionRegistry + SessionSupervisor
     -> local PTY -> local tmux client -> local tmux server
     -> SSH connection pool
        -> SSH shell channel                    (plain mode)
        -> SSH PTY exec channel -> remote tmux  (persistent mode)
```

Main 保存逻辑身份、重试状态和视图授权。本地或远端 tmux server 保存对应机器的 shell、子进程、终端状态与有界历史。Renderer 保存显示投影，不管理 SSH 连接、不计算自动重试、不根据屏幕文本认定恢复成功。

优先在现有 SSH facade 之后增加一个 supervisor；现有 transport runtime 继续负责认证、代理、跳板和 channel。避免将计时器、注册表、tmux 协议和 UI 状态全部塞进现有长文件。

同一 Main 中，一个逻辑 session 只拥有一个活动数据 channel；多个视图订阅其输出。多视图独立维护解析状态，晚加入的视图通过有界屏幕快照加增量序列同步。不能把旧 ANSI 输出直接重放到一个已有活动屏幕上。

### 4.2 会话数据模型

字段名可随实现统一，但以下语义不可省略：

| 字段 | 所有者与用途 | 是否落盘 |
| --- | --- | --- |
| logicalSessionId | Main 生成随机 ID，跨重连保持；不使用 panel ID 作为全局身份 | 是 |
| targetRef / targetBinding | 资产 ID、账户、目标端点、代理/跳板身份及服务器身份绑定 | 是，敏感材料不落入该表 |
| persistenceMode | plain 或 tmux，创建时确定 | 是 |
| remoteServerLabel / remoteSessionName | 安装实例命名空间加随机会话名，Main 生成且严格校验 | tmux 模式保存 |
| remoteIdentity | tmux 会话创建信息、pane 身份、shell PID/启动身份；用于区分原会话与同名替代 | 是，按能力记录 |
| transportGeneration | 每次新 transport 单调增加，屏蔽旧回调与旧输出 | 否 |
| outputSequence / snapshotSequence | 同一 generation 的输出序列及晚加入视图快照边界 | 否 |
| state / lastDisconnect | 权威状态和结构化断开原因 | 最后状态可保存，但启动时重新核实 |
| attachedViews / controllerLease | view 身份、所属 window、输入与 resize 控制者 | 否 |
| retryAttempt / nextRetryAt | 当前重试周期的数据 | 否 |
| createdAt / lastAttachedAt / lastKnownRemoteState | 会话目录显示和排查 | 是 |

凭证仍由既有资产、密钥链和认证 runtime 提供。禁止将密码、私钥、MFA 应答、完整环境变量或终端正文写入会话目录与普通日志。

会话目录是新的终端运行时目录，不复用 AI Product Session Registry 来存储 shell 生命周期。两者通过 logicalSessionId 关联，避免终端重连产生新的 AI 对话或改变审批状态。

### 4.3 创建、恢复和远端 tmux

1. 建立并验证目标 SSH transport。通过受控 exec 探测 tmux 可用性和所需命令能力，设置超时与输出上限。当前源码中未确认统一 host-key 验证入口，P0 必须核实；持久恢复必须绑定已信任的服务器身份，不能仅靠资产名称。首次信任走明确的产品入口，指纹变化暂停恢复。
2. 使用 aiopsterm 专属 server label 和受控配置，隔离用户自己的 tmux server、全局 hooks、prefix 和窗口设置。稳定安装实例 ID 可持久化，不能每次启动变动；测试使用独立 runId label。
3. 新建动作先生成随机远端名称并保存 pending 记录，再创建 session。远端创建成功但本地丢失响应时，按原名称和所有权元数据查询，确认匹配后接回，不能生成第二个任务。原子创建优于先 has-session 后无条件 new 的竞态。
4. 恢复动作只连接已登记的确切 session，使用精确匹配；禁止 `new-session -A` 在恢复失败时偷偷创建新 shell。查不到或身份不匹配进入 missing，只有用户发起“新建终端”才建立新记录。
5. 用 PTY exec 通道启动 tmux attach，使正常终端输入直接到达 tmux。管理查询使用独立短寿命 exec channel，输出进入管理解析器，不能进入终端显示数据。
6. shell-ready 必须晚于“本次 client 已 attach 到目标 session”的正向确认。可采用绑定 attempt nonce 的启动标记记录 exec 后保持的远端 client PID，再通过 `list-clients` 查询确认对应 client 与 session；启动标记由 Main 消费，限制长度和超时。P3 必须验证实际 shell/exec 语义，不能把 `command -v tmux` 成功、PTY 分配成功或看见提示符当作 attach 成功。
7. 明确设置会话无人连接时继续存在；保留有界 history。用户执行 exit 后进程真实退出，不自动复活。配置变化只应用到本工具拥有的 server/session。
8. 支持能力取决于实际探测结果。固定参考版本不等于远端最低版本；P0 记录 ali 版本，P3 在可重现环境核实最低支持版本并写入使用文档。

### 4.4 重连状态机

逻辑状态至少区分：connecting、attached、reconnecting、detached、needs-auth、missing、exited、failed、terminated。Transport 的 connected 不等于逻辑 attached。

| 触发 | 转换与动作 |
| --- | --- |
| 网络超时、ECONNRESET、活动 transport end/close | attached 转 reconnecting，保留逻辑记录和视图，停止接受输入 |
| SSH channel 明确正常退出 | 转 exited，不重试；与 transport 错误先后到达的情况一起分类 |
| 重试成功，tmux 身份核验通过 | reconnecting 转 attached，generation 增加，恢复输入和最后有效尺寸 |
| 普通 SSH 重试成功 | 显示“已重连，已启动新 shell”，不宣称原任务恢复 |
| 凭证失效、MFA 需要交互、host-key 改变 | 转 needs-auth，暂停自动握手；同目标并发请求合并一个认证入口 |
| 用户取消认证 | 停止自动重试，保留可手动恢复入口 |
| 原远端会话不存在 | 转 missing，保留记录和历史提示，不自动新建 |
| 用户 detach / 关闭持久视图 | 取消该视图；无视图时停止重连并关闭 attach channel，远端继续运行 |
| 用户 terminate | 精确终止该远端 session，确认后转 terminated；网络失败时保留结果未知状态，不误报成功 |

默认重试间隔为 1、2、4、8、15、30 秒，再按 30 秒上限重试；加入百分之二十抖动并钳制最大等待为 30 秒。单次故障窗口最多自动重试 10 分钟，超时后转 failed，用户可手动重试。测试注入 clock 和随机源，不依靠真实等待测试退避。

同一连接池 key 最多一个在途握手；不同目标默认最多四个并发握手。网络恢复事件可以提前唤醒一次等待，但必须合并重复事件。连接稳定至少 30 秒后才重置连续失败计数，避免反复握手成功又立即断开形成重试风暴。

每次 attempt 使用 generation/取消令牌。旧 ready、error、close、认证 Promise、proxy Promise、计时器以及延迟的 shell callback 不得覆盖新状态。未建立成功的资源也必须能在取消后被关闭。

### 4.5 输入、输出和历史

未 attached 时 write、二进制 write、AI terminal tools、宏和快捷命令统一返回结构化不可写结果。不得静默吞掉输入后返回 ok，也不得补发已提交命令。首次连接前的输入也采用拒绝策略；resize 仅保存最新合法尺寸，attached 后发送一次。

网络中断可能造成“命令已执行但客户端未收到输出”，该状态不能靠自动重跑消除。UI 可提示结果未知；是否重试命令由用户或既有 Agent 审批流程决定。

恢复后的活动画面以 tmux 重绘为准。清理旧 transport 的半截 UTF-8/ANSI 解码状态，明确普通屏幕、alternate screen、鼠标模式、括号粘贴及光标模式的切换；不能无条件清空用户可查看的历史。

第一版使用普通 tmux PTY 接入，历史体验按以下契约实现：

- 当前视图保留断线前已有的本地历史，恢复活动屏幕不要求字节级重放全部输出。
- 提供“远端历史”只读查看/复制入口，通过受控 `capture-pane` 获取默认最多 5000 行、最多 1 MiB 的快照；截断必须可见。
- 远端历史快照单独显示，不能拼接进 live ANSI 流，也不能触发 OSC、链接执行或剪贴板控制。
- tmux 自身 copy-mode 可继续使用。普通 PTY 模式不承诺将 tmux 全部历史无缝映射到本地滚动条，也不承诺断网期间的无限日志保留。
- 只读旁观视图从同 Main 的活动 core 获取有序、有界快照再接增量；活动窗口销毁时可重新从 tmux 重绘建立新主视图，远端进程不受影响。

### 4.6 会话复用与操作入口

新建标签、复制连接、分屏默认创建独立 shell，仅复用 SSH transport。用户从会话目录选择“查看已有会话”才复用逻辑 session，避免两个人工视图意外同时输入。

同一应用只允许一个 view 持有输入与 resize 租约，其余为只读。接管通过 Main 原子转移租约；旧控制者后续 write/resize 被拒绝。最后一个 view 关闭后不继续在后台解析和缓存无限输出。

本轮租约只约束本应用视图；用户手工执行 tmux attach 或另一个应用进程不受该租约约束，文档必须明确这个范围。

操作语义：

| 操作 | 本地结果 | 远端结果 |
| --- | --- | --- |
| 新建终端 | 新 logicalSessionId | 新 shell/tmux session |
| 重新连接 | 原 logicalSessionId，新 generation | tmux 接原 session；plain 新 shell |
| 分离并关闭标签 | view 移除，目录记录保留 | tmux 任务继续 |
| 结束会话 | 精确终止并保留退出结果 | 仅结束目标 session，不能使用全局 kill-server |
| 忘记记录 | 移除本地目录，不发送远端终止 | 任务可能继续；入口明确说明 |
| 退出应用 | 释放本地连接，保存目录和视图恢复意图 | tmux session 继续，plain 按旧行为关闭 |
| 重启应用 | 目录先显示待核验；用户打开时认证并 attach | 仍存活则恢复，不存在则 missing |

首次交付采用“启动恢复目录，用户打开才连接”，不在启动时自动执行新命令。窗口 reload 应恢复原窗口的视图绑定；关闭视图、窗口 reload 和整个应用退出分别处理。

### 4.7 API、配置与兼容

通过现有 shared contracts、Main IPC、preload、terminalClient、backend guards 链路新增会话操作，不让 renderer 直接传任意 tmux 命令。

建议动作：session.list、session.create、session.attach、session.detach、session.terminate、session.forget、session.claimControl、session.readHistory。最终 IPC 名称在 P1 固定。write/resize 参数携带 view 身份和 generation；Main 根据 sender、view 绑定和租约授权。一次性迁移所有旧调用方，旧 terminal:kill 继续代表旧的明确结束行为，UI 的持久关闭改用 detach。

建议配置为 `terminal.sshAutoReconnect` 与 `terminal.sshSessionPersistence`：新配置默认前者开启、后者关闭；旧配置缺字段时按同样规则归一化。保持模式需要用户启用并完成远端能力检测；设置页说明需要目标服务器安装 tmux，关闭标签仍保留任务。变更只影响新会话，已有会话保持其创建时语义。所有语言有完整文案或项目规定的回退，不能只添加中文硬编码。

元数据采用 Main 所有、版本化 schema 和原子写入，新增/更新与去重集中在一个 registry。重启时一律核实远端状态，不以 persisted attached 直接显示 running；损坏记录隔离并可诊断，不损坏资产和 AI 会话库。

### 4.8 本地 tmux 适配

本地使用同一个 SessionRegistry、逻辑状态和 view 租约，增加 `targetKind=local` 及本地 tmux adapter，不经 SSH，也不实现第二套会话目录。前述第 4.3 至 4.7 节的 SSH 连接、认证和退避规则仅适用于 SSH；身份、精确恢复、关闭语义、历史和多视图规则由两个 adapter 共享。

本地 targetBinding 包括安装实例、本机账户和 shell profile。`remoteServerLabel`、`remoteSessionName`、`remoteIdentity` 在最终公共 schema 中统一为 provider 状态，避免本地字段假冒远端字段；若保留 SSH 专用 DTO，local 必须使用明确的独立分支。

本地实现入口为 `src/main/backend/terminal/localTerminal.ts`。普通本地模式继续 spawn shell；持久模式使用 node-pty 启动本机 tmux client，让独立 tmux server 拥有真正的 shell 和任务。管理命令用参数数组启动受控本机子进程，禁止通过拼接 shell 命令接受任意会话名。依赖探测、exec 超时、输出限制与取消均需覆盖。

创建时正确应用 shell profile、cwd 和该次启动环境，不能意外继承早先启动的 tmux server 的过期环境。通过受控启动协议传递必要环境，不能把密码或完整环境写入命令行、目录记录和日志；不复用用户正在使用的默认 tmux server 配置。

关闭持久标签、退出或崩溃清理时，只关闭本应用的 attach client；不得将 tmux server 或其 shell 子树纳入 killAllSessions 的递归终止。正常退出应用后用独立观察进程验证本地任务继续运行，不能只验证 Electron 留在托盘。应用重开后通过目录恢复原会话；tmux server/session 消失则 missing，不偷偷重建。

本地 client 非预期退出可重建 client 并精确 attach；用户 detach、正常 exit 或明确终止不自动接回。不存在本地网络故障，因此不套用 SSH keepalive/MFA 状态。验证原会话存在后才允许重试，沿用有界次数、generation 和取消规则。

配置增加 `terminal.localSessionPersistence`，默认关闭；与 SSH 保持开关独立，创建时固定模式。设置页和目录显示“本地”或目标服务器身份。缺少本机 tmux、tmux 不可执行或平台不支持时明确报能力不可用，不假称保持成功。代码集成后补充本地使用与架构文档，不能只写 SSH 说明。

## 5. 迭代方法与退出条件

每阶段执行同一循环：确认当前代码和用例范围，先写可失败的行为测试，实现最小闭环，运行关联回归，保存证据，更新本阶段涉及的文档，审查 diff，提交本地 Git。没有新变化或失败证据时不重复全量运行。任何阶段发现合同冲突，应先更新本计划和测试用例，不能删除用例来获得通过。

| 阶段 | 实现内容 | 必须运行的用例 | 阶段退出条件与提交 |
| --- | --- | --- | --- |
| P0 环境与基线 | 核实参考版本、当前状态、ali 资产和 tmux；实现隔离故障夹具、测试清单与性能采集入口；核实 host-key 路径 | E01-E06；现有 SSH/flow/renderer 关联基线；PF01 基线 | 生成环境指纹、运行清单、基线报告；缺实机凭证不阻止本地阶段，但实机未通过不能最终完成 |
| P1 身份与生命周期 | registry、contracts、view 绑定、generation、结构化错误；旧行为适配，暂不改变远端 shell | F01-F08、F33-F38、F43-F46 | create/attach/detach/terminate 定义可测试；类型检查和现有 IPC/AI 回归通过；提交会话边界 |
| P2 自动重连 | supervisor、错误分类、退避、取消、并发握手合并、输入拒绝、状态投影 | F09-F20、F39-F42；PF02、PF06 | 普通 SSH 网络故障可恢复且明确是新 shell；手动关闭与认证取消不重连；提交重连闭环 |
| P3 tmux 保持 | 能力探测、专属 namespace、幂等创建、精确恢复、attach 确认、远端终止 | F21-F32、F47-F50；A01、A02、A04 的 backend 验证 | ali 上同一进程通过断线测试；会话丢失不新建；提交远端保持 |
| P3L 本地 tmux 保持 | local adapter、shell profile/环境、client/server 生命周期、应用退出与精确恢复 | L01-L12；LP01 基线 | Linux 实际本地 shell/任务在独立应用退出后存活；共享 registry；提交本地保持 |
| P4 图形恢复与复用 | UI 目录、关闭语义、重启恢复、只读历史、租约、多视图快照和背压 | F33-F42、F51-F60；U01-U10；A03-A08；PF03-PF05 | 完整 UI 路径可用；真实 Electron 进程重启和 AI/文件回归通过；提交体验闭环 |
| P5 性能与故障收敛 | 重试风暴、资源释放、吞吐、公平性、长稳；修复测量发现的问题 | 全部 PF、A、故障相关 F；重复失败场景 | 达到固定门槛；没有以跳过或放宽门槛掩盖失败；提交性能与稳定性修复 |
| P6 发布验收与文档 | 全部必选用例、项目构建审计、打包边界、使用/运维/开发文档、最终报告 | 全部必选 E/F/U/A/PF；Linux 包验证与最终完成清单 | 每个目标有结果和证据；本地 Git 提交，无 push；标记本计划完成 |

执行顺序为 P0、P1、P2、P3、P3L、P4、P5、P6。P0 同时核实本机 tmux 与普通本地 PTY 基线；P4 的目录、关闭、重启和多视图用例在 local/SSH 两个 targetKind 参数化执行；P5 增加 LP01-LP03，P6 验收包括全部 L/LP。本地使用与架构文档在 P3L/P4 更新。

不得把 P1/P2 或单纯 tmux demo 作为整个 Goal 完成。P3/P3L 必须走 aiopsterm 的实际 backend，P4 必须走真实 Electron UI；只在命令行执行 tmux attach 成功不够。

分层用例在早期阶段先实现 Unit/Integration 断言，依赖 UI 或远端功能的变体在对应后续阶段补齐。manifest 分别记录每个变体状态；早期的部分通过不等于整个用例已经满足最终门槛。

## 6. ali 测试环境

用户已允许使用 ali 测试。2026-09-07 当前执行环境的 `ssh -G ali` 没有解析出实际目标，`ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=yes ali ...` 返回无法解析主机名。因此目前没有 ali 已登录、已安装 tmux 或性能已达标的证据。

P0 先从既有 aiopsterm 资产/连接入口定位名为 ali 的机器，读取非敏感连接元数据；凭证由现有密钥链和测试的私密环境提供，不写入文档。确认目标、账户、发行版、tmux/sshd 版本、shell、CPU/内存与可用目录。找不到唯一资产或凭证时只询问必要连接信息，不猜测其他机器。

实机测试使用随机 runId 命名的远端临时目录、tmux server label 和 session。通过本地用户态 TCP 故障代理仅中断被测连接，分别注入双向黑洞与强制断连；保留独立控制连接观察任务。不能通过重启 ali、关闭 sshd 或修改整机防火墙来模拟断网。硬故障和缺失能力优先在本地隔离 SSH fixture 覆盖。

普通测试无需修改全局 tmux 配置或安装软件。检测缺少 tmux 时记录为实机前置条件；安装是独立操作，不由测试偷偷执行。远端缺失能力分支在夹具中仍应可自动验证。

## 7. 测试与证据

完整场景、前置条件、步骤、断言、性能指标和测试入口见[配套测试计划](ssh-session-persistence-test-plan.md)。每个用例在执行清单中具有唯一 ID、实现位置、阶段、结果、耗时和 artifact 路径。

原始结果写入 Git 忽略的 `test-results/ssh-session-persistence/<runId>/`。摘要写入本阶段技术验证文档；不得上传密码、私钥、真实终端业务输出。测试输出使用合成数据、随机 nonce 和受控路径。

功能测试不以截图中的“已连接”作为唯一判据。性能结果必须区分 baseline、candidate、网络故障探测时间、故障解除后的恢复时间及远端执行时间。MFA 人工等待独立统计。

## 8. 文档交付

用户已明确要求本计划及后续实施文档。本文首次交付只新增计划与测试计划，不把未实现的配置写成已可用功能。

| 文档 | 更新阶段 | 内容边界 |
| --- | --- | --- |
| `docs/usage/ssh-session-persistence.md`，实施时新增 | P3-P4，P6 完成 | 启用、依赖、普通重连与保持差别、查看/分离/结束/忘记、远端历史、重启恢复、故障说明 |
| `docs/usage/local-session-persistence.md` 与 `docs/technical/local-terminal.md`，实施时新增 | P3L-P4，P6 完成 | 本地 tmux 依赖与平台边界、配置、client/server 所有权、profile/环境、关闭和恢复、进程退出边界 |
| `docs/technical/ssh-terminal.md` | P1-P4 | registry/supervisor/transport 所有权、状态机、协议、错误分类、支持矩阵 |
| `docs/technical/performance-resource-management.md` | P4-P5 | 实际背压算法、快照与历史上限、并发限制、资源生命周期 |
| `docs/technical/development.md` 与 `docs/usage/development-commands.md` | P0-P6 | fixture、测试命令、ali 私密配置方式、证据生成、打包验证 |
| `docs/technical/ssh-session-persistence-validation.md`，实施时新增 | P0-P6 累积 | 基线、每阶段用例结果、性能比较、实机证据、失败及修复、最终 Git 提交 |
| 本计划及配套测试计划 | 每阶段 | 阶段状态、经证据确认的设计调整、用例映射和验收进展 |

AGENTS.md 保持指向 `docs/index.md`；根索引指向 usage/technical 分类索引；新增文档必须进入对应分类索引。不为此功能创建无关 hook、安装框架或新文档工作流说明。

## 9. 最终完成清单

- [ ] G01-G10 都有实现和可复现证据。
- [ ] P0-P6 及 P3L 都有阶段提交和明确结果。
- [ ] 必选 E/F/U/A/PF/L/LP 用例全部通过，必选项 skip 数为零；未运行必须标为未验证。
- [ ] 本地 Linux tmux 在应用正常退出、Main 崩溃后保持任务，恢复与终止通过真实应用测试。
- [ ] ali 的断线保持、应用重启恢复、任务身份和资源清理完成实机验证。
- [ ] tmux 模式不在恢复失败后偷偷创建 shell，普通模式不宣称原进程保持。
- [ ] UI、IPC、AI 写入、文件功能、认证、连接池和 renderer 相关回归通过。
- [ ] 性能、背压、并发重连与长稳达到配套计划门槛。
- [ ] 参考源码未进入源码依赖图、构建输入、资源包或 app.asar。
- [ ] 使用、架构、开发、性能、测试报告及相关索引已更新。
- [ ] 最终提交仅包含本任务文件；用户的其他改动保留；不 push。

## 10. 后续 Goal 模式输入

以下文本用于以后启动实施，本次整理计划不自动创建 Goal：

> 按 docs/technical/ssh-session-persistence-plan.md 和配套 ssh-session-persistence-test-plan.md，实现 aiopsterm 的本地 Linux tmux 会话保持、SSH 自动重连、远端 tmux 会话保持、目录恢复和同应用多视图复用。按 P0、P1、P2、P3、P3L、P4、P5、P6 逐阶段推进，每阶段完成行为测试、必要的性能测试、文档更新和本地 Git commit，不 push。ali 可以用于隔离的实机测试，先通过已有资产配置核实连接；参考源码仅供阅读。用计划中的 G01-G10 与最终完成清单验收，禁止把 demo、遗漏本地保持、跳过实机测试或部分阶段通过当作 Goal 完成。自研本地 PTY 守护服务、Windows 原生/WSL 保持和机器重启后的进程复活不在本 Goal 范围。遵守仓库 AGENTS.md，并保留其他任务的未提交改动。
