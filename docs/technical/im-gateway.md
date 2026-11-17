# IM 网关架构

使用与飞书配置集中在 [IM 网关](../usage/im-gateway.md)。本实现属于 aiopsterm Electron 主进程，不是单独部署的无界面远程服务。当前注册飞书、Telegram、百度如流三个渠道；消息规范、策略和终端控制不依赖飞书协议。

## 分层与扩展

- `src/shared/contracts/imGateway.ts`：设置、连接状态、IPC DTO。渲染进程不能读取 Secret，只得到 `hasAppSecret`。
- `src/main/ipc/imGateway.ts`：组装独立配置存储、系统加密、状态文件、适配器注册表、终端端口和运行日志；注册 status/save/terminals IPC。
- `backend/imGateway/gatewayManager.ts`：配置校验、凭据更新、串行保存及连接生命周期。重新配置先停止旧适配器与队列，再应用新权限。异步加载完成和迟到的连接回调受版本号、关闭状态保护。
- `gatewayCore.ts`：统一消息校验、用户和主机授权、聊天绑定、消息去重、会话队列、命令解析、一次性卡片选择及输出订阅生命周期。
- `gatewayTypes.ts`：`GatewayMessage`、`GatewayAdapter`、`GatewayTerminalPort`。适配器只负责 start/stop/reply/send/sendScreen，不拥有执行权限。
- `feishuAdapter.ts`：官方 `@larksuiteoapi/node-sdk` 1.76.0 的长连接消息、卡片回调接收及消息回复/主动推送。延迟导入，默认关闭时不加载 SDK。获取当前机器人的 open_id 后才接受群聊 @；不把任意机器人提及当成本应用提及。
- `gatewayTerminalPort.ts`：复用现有 [Control Socket 内部调用边界](control-socket.md) 的 terminal.list/send_text/read_screen、asset.list/ssh.connect 和 surface.create，不监听新网络端口。新建时指定资产 ID、`exactAssetId: true` 且 `reuse: false`，防止资产删除后按名称匹配到另一主机，本机通过 `surface.create` 的 `autoConnect: true` 启动 PTY 后等待对应面板的会话就绪；失败保留 tab。写入仅使用精确 sessionId；读取同时指定 panelId 和 sessionId，并校验返回的会话身份。

- `gatewayOutputRelay.ts` 与 `terminal/terminalOutputEvents.ts`：主进程终端数据的内存订阅，普通输出批量发送，TUI 重绘读取精确面板屏幕。飞书发送不会阻塞 PTY 渲染；解除绑定、停用、权限撤销或会话变更停止订阅。

- `telegramAdapter.ts`：Bot API 长轮询、明确提及校验、inline keyboard 身份和卡片 ID 验证、PNG 文件发送和原消息编辑。固定 HTTPS API，不跟随重定向；请求有超时和停止信号，Token 从不进入日志。启动检查 getMe 身份与已有 webhook，不覆盖其他接收配置。只有处理完一条更新才推进 offset；重启积压消息仍由核心时间窗口和持久化凭据过滤。网络故障延迟重试接收；发送没有幂等键，不自动重试可能已经成功的发送。
- `infoflowSocket.ts`：为固定版本 SDK 的 EventDispatcher 补实例级 Node error listener，避免其第二次 error 分发造成未处理异常；不修改全局原型。用真实 SDK 回归该路径。每次建连设置 30 秒总期限并响应停止信号，迟到连接再次关闭。已连接后的端点重连失败由五秒状态检查补充重试，停用清理检查器。
- `infoflowAdapter.ts`：使用 `@core-workspace/infoflow-sdk-nodejs` 0.1.7 的 Client/WSClient。Agent ID 用于消息发送，App Key 作为 SDK appId 用于鉴权。显式关闭 SDK 日志；连接入口和所有回调检查停止状态，SDK 迟到连接完成后再次 disconnect。发送队列停止后拒绝新任务；已开始的 SDK 请求最多等待其超时，不保证撤回网络中已发出的请求。
- 如流私聊保留 FromUserId 授权身份与 FromUserName 回复目标；拒绝含竖线的目标以避免 SDK 多收件人语义。群聊仅接受 MESSAGE_RECEIVE、当前 agentid 和明确 AT robotid，不处理全量转发；私聊缺少 MsgId 时以 accountId、发送者、回复目标、创建时间和正文的 SHA-256 作为保守去重 ID，同秒同文可能合并，哈希不保存正文。大整数消息 ID 必须以字符串保持精度，不接受不安全的数值 ID。选择列表输出 `/select <令牌>`，适配器将其规范化为 actionToken，仍由核心验证原用户/聊天和一次性消费，不绕过授权。
- `adapterUtils.ts`：新适配器的发送队列、分段和 PNG 校验。Telegram 最小发送间隔一秒；如流私聊半秒，群消息发送后保留 3.1 秒间隔作为兼容旧接入的保守策略；新机器人平台限额与接口边界见下节。队列停止取消等待。图片发送排队后重新检查绑定授权；如流 PNG 上限小于 1 MiB，Telegram PNG 上限 8 MiB。
- 如流通过 `screenQuietMs: 4000` 让输出订阅等待重绘静止，不模拟可编辑卡片。初始读屏和最终屏幕仍从精确绑定读取；等待期间继续验证授权及断开状态。普通追加输出不受该等待影响。Telegram sendScreen 将长屏幕截断到消息长度限制，编辑失败不回退为新消息。

增加渠道时，实现适配器、把厂商事件规范化为统一消息、在注册表添加 provider，并增加配置界面和厂商协议用例。必须保留核心授权与去重检查，不能让适配器直接调用终端。当前配置只启用一个 provider/account，并未实现多渠道同时连接。

## 如流 OpenHub 接口边界

来源为用户在会话中提供的 [OpenHub](https://openhub.baidu-int.com/web/)《以机器人身份发送消息到群聊》《机器人向群聊发送可交互消息》《机器人交互消息更新方案》等文档正文。当前环境无法解析该站域名，以下按所提供正文核对，并未完成内网在线验证。公开 SDK 0.1.7 不覆盖全部 OpenHub 能力。

### 已确认的平台能力

- 普通群消息：`POST /robot/msg/groupmsgsend`，文档线上地址为 `https://open-ruliu.baidu-int.com/open-plat/api/v1/robot/msg/groupmsgsend`；需管理员开通“以机器人身份发送消息到群聊”。新机器人限流为每机器人 10 QPS；旧的每群 20 条/分钟规则仅适用于历史自定义机器人。
- 鉴权：获取 app_access_token 时提交小写 MD5 后的 App Secret；消息请求头为 `Authorization: Bearer-at_xxxxxx`，不是空格分隔的标准 Bearer 写法。文档 token 有效期为 7200 秒，应提前刷新。设置页仍填写原始 Secret，由 SDK 计算摘要，不应让用户预先 MD5 后再填入。
- 群消息 `clientmsgid` 用于去重，必须唯一；`clienttime` 的参数表标为必填，但正文允许缺省由服务端填当前毫秒时间，不能传 0。当前 SDK 使用 `Date.now()` 生成 clientmsgid、未发送 clienttime；适配器串行限速，不做发送重试。后续若加入重试，应复用同次操作的标识，不能生成新标识重复发送。
- 交互卡片发送：`POST /robot/group/sendInteractionMsg`，请求头包含 `X-OP-CORP-ID`、`X-OP-AGENT-ID` 和上述 Authorization；返回 receivers 中包含 msg_id、card_id、modify_token。文档给出的线上基址是 `http://apiin.im.baidu.com/api/v1`，与当前 SDK 的 HTTPS 公开域名不同，尚未确认安全可达的部署地址。不能直接替换公开接入地址或发送凭据探测。
- 卡片刷新：点击 `callBack` 按钮后，平台向已注册 URL 发 POST，携带 userId、toId、toType、eventKey、appContext 等。回调返回 code=200 和新的卡片数据时刷新原卡片，非 200 仅显示 msg。data 的说明先写 string，后又要求完整卡片请求体，实际序列化形态需联调确认。onlyChangePersonal 控制只刷新点击者或所有用户。
- 图片格式不同：普通 IMAGE 消息使用小于 1 MiB 的原始图片 Base64；交互卡片 IMAGE 使用图片 URL。当前终端截图走普通图片消息，不能将现有 Base64 直接塞入交互卡片图片字段。
- getSingleMsg 是读取原消息的接口，不是更新接口。返回 modify_token 或 card_id 也不能单独证明存在何种主动更新请求，不能据此猜测更新路径或参数。

### 当前实现及待接入部分

现有实现使用公开 SDK 的 `api.im.baidu.com` REST 与长连接入口，已核对 SDK 的 MD5 Secret 和 `Bearer-` 请求头行为与上述鉴权描述一致。SDK 长连接收消息与文档的 HTTP 回调收消息不是同一部署方式；没有证据表明卡片回调能直接进入现有长连接处理器。

交互卡片发送、按钮回调刷新以及无需点击的主动更新均未实现。当前防刷屏策略仍为静止后发送纯文本，不具备原卡片刷新能力。接入回调前需要完整签名校验、解密与防重放约定，并提供平台可达的回调地址；当前所贴正文仅引用这些算法，未提供算法详情。主动更新仍缺接口路径、方法、鉴权、请求体、有效期和限流约定。暂保留现有公开 SDK 接入及 3.1 秒群发送间隔，不宣称已切换 OpenHub API。

后续卡片验收需要覆盖：合法按钮更新同一卡片、code 非 200 不更新、点击者与会话/卡片绑定校验、无效签名/过期回调/重复事件不执行终端操作、onlyChangePersonal 的隔离效果、超过 JavaScript 安全整数范围的消息和卡片 ID 保持字符串、图片 URL 与 Base64 的差异。若取得主动更新协议，还需验证无需点击即可更新原卡片，更新失败不新增消息刷屏。这些是待实现部分的验收条件，不是已通过的测试。

## 身份、命令和并发边界

绑定键由 provider、accountId、tenantId、conversationId、senderId 的 JSON 数组 SHA-256 构成。每次操作重新列出终端并检查主机资产授权、连接状态和原 sessionId/panelId；主机重连不能自动继承旧绑定。本地终端默认不授权。`allowedAssetIds` 含保留值 `all` 时允许本机和全部保存的 SSH 资产，包括后来新增的资产；用户和群聊权限仍是精确白名单，`*` 无特殊语义。

单聊检查用户允许列表；群聊还要检查聊天允许列表及当前机器人的精确 @。仅精确匹配网关内置斜杠命令；`/model` 等非内置命令连同命令名、参数和首尾空格按普通输入转发，不降级为帮助或只发送参数。普通聊天和非内置斜杠命令在已绑定后输入终端并回车，未绑定时提示选择卡片，仍执行授权、去重、长度、控制字符及延迟提交检查。与网关重名的终端命令使用 `/run` 显式转发，如 `/run /help`。`/sessions` 和 `/new` 卡片每页 8 项，以名称和主机展示。新建调用已有桌面本机/SSH 流程，不调用 LLM。`/run` 表示写入并回车，不跟踪退出码或声明完成。`/key` 复用 `src/shared/terminalKeys.ts` 与 Control Socket 共用的纯按键映射，解析 Ctrl/Alt/Shift 修饰键（空格、加号或连字符分隔，大小写及顺序无关）后写入精确绑定，不额外回车；拒绝原文控制字符、未知键名、多键序列，仍经过身份/资产/会话检查、消息去重与终端锁。导航键和功能键使用 xterm 修饰参数；Ctrl+Alt 字符保留 ESC 加控制字符的兼容形式，Ctrl+Shift 字符以 CSI-u 保留 Shift 位，不降级成中断字符。此入口不模拟桌面键盘事件或系统快捷键，不协商/修改目标程序的键盘模式，扩展键需要接收程序支持。编码参考 [xterm 控制序列](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html) 与 [kitty 键盘协议](https://sw.kovidgoyal.net/kitty/keyboard-protocol/#key-codes)。`/binding` 和 `/status` 共用绑定查询；`/interrupt` 是固定 Ctrl+C；普通消息最多 4096 字符，多行和制表符用 bracketed paste；拒绝其余控制字符。`/run`、`/send` 保持单行 2048 字符上限。

普通消息和 `/run` 将文字与提交分两次写入：文字写入成功后等待 200 ms，再独立发送一次 CR，避免 Codex 等交互程序将同批回车识别为粘贴换行。多行 bracketed paste 在第一次写入内闭合。等待期间持续持有终端锁，提交前重新检查网关启用状态、用户与资产权限、绑定及连接；失效时保留已输入文字但不回车。任一写入失败都不自动重试。`/send`、`/key`、`/interrupt` 不经过延迟提交路径。该行为由共享网关核心负责，适用于各 IM 渠道；正在运行的旧进程需更新并重启后生效。

每个聊天身份串行处理，独立聊天可以并行。全局最多 32 条已接受且未完成的消息。对同一终端的重叠操作返回忙，不自动重复执行。停用、更新权限或应用退出后不执行排队中的操作；已经送出的输入无法撤回。

## 持久化与重试语义

统一消息要求非空身份字段（最多 512 字符）、有效时间和已知聊天类型。消息正文最多 4096 字符，忽略超过 5 分钟或来自未来超过 60 秒的消息。允许列表每项最多 100 个 ID。

卡片不携带可直接执行的命令或 sessionId，只携带随机令牌。核心保存令牌与请求身份、操作的映射，10 分钟失效，最多 2000 个；执行前消费令牌并重新鉴权。飞书适配器也核对回调操作人与原聊天，重建源消息身份；不会信任按钮传回的用户或授权范围。卡片回调按 `card:<令牌>` 去重并快速确认接收，终端创建在队列中执行。重启后旧卡片失效。

消息去重键包含 provider、accountId、tenantId 和 **messageId**，不能使用飞书 event_id 作为业务去重依据。接收事件先将去重凭据写入磁盘，再确认接收并排队。状态采用临时文件加原子重命名；文件损坏或写盘失败时拒绝执行。新消息到达时清理 24 小时之前的凭据，上限 10000 条；绑定上限 1000 条，状态读取上限 4 MiB。

这是“同一消息至多尝试执行一次”，不是事务性恰好执行一次。若进程在记录凭据后、写入终端前崩溃，该消息可能未执行，但不会因投递重试自动再执行。原子重命名也不保证断电后的磁盘持久性。需要人工先查看终端，确认后再发送一条新消息。

飞书回复和输出推送独立重试最多 3 次，重复请求使用同一个 UUID，总回复请求间隔至少 250 ms。回复失败不重发终端输入。HTTP 超时 15 秒，关闭适配器会取消请求、等待和 WebSocket 重连。手动 `/read` 使用纯文本回复，去除 ANSI/控制字符并中和提及标记，最多保留末尾 6000 字符。主动输出使用 `im.message.create` 发送到原 chat_id，每批单独 UUID，重试保持该 UUID，避免相同输出被去重。

输出订阅只保存在内存，不持久化聊天正文。新绑定先完成绑定回执，再发送最近屏幕并每秒合并原会话的数据；跨数据块的 ANSI 状态机过滤 CSI/OSC。光标重绘程序通过 `sendScreen` 创建纯文本内容的交互卡片，保存返回的 message_id，后续以 `im.message.patch` 更新原卡片（`update_multi: true`），最多约 3 秒一次。比较截断后的屏幕，忽略行尾空格；读取和发送串行，慢请求期间的新数据留待下次处理，避免并发新建重复消息。每个通过鉴权与去重的交互开始处理时暂停对应订阅、推进版本并清空卡片 ID；TUI 同时清空屏幕去重状态，使未变化的最新屏幕也能出现在新回复之后。只等待已经开始的输出发送完成，不等待慢读屏；旧读屏的版本失效后丢弃。命令处理和回执发送结束后在 finally 中恢复当前绑定的订阅，新绑定在创建时即暂停，因此首屏不会抢在绑定成功回执前发送。回执失败仍恢复订阅，但停止或撤权不会恢复发送；输出发送失败保持原有停止策略。没有新交互时，动画继续更新同一卡片。卡片 ID 只存内存，更新失败停止订阅，不回退为新发消息。无 sendScreen 能力的渠道保留文本输出。普通流每批最多 6000 字符，缓冲上限 64000 字符，超限有提示。每次发出前重新验证授权、sessionId/panelId 和绑定身份，慢读屏完成后也验证；发送失败停止订阅并记录 `output_failed`，下一次 `/status`、输入或重新绑定可恢复。重启/重新配置后不立即恢复输出，待该身份发来下一条消息。

输出轮询发现绑定的精确会话断开、消失或替换时，停止订阅并向原聊天发送一次通用断开通知。通知前重新检查用户、群聊、原终端资产权限和绑定对象身份；解绑、停用、权限撤销及旧订阅迟到不触发通知。读屏失败也重新检查断开状态。消息到达时无绑定与绑定失效分别回复；写入失败走错误回执，不自动重试输入，不宣称先前输入未执行。通知失败记录 `reply_failed`，不能因此重启订阅。

## 凭据、状态与日志

配置单独存储在 userData 下的 `im-gateway.json`；Secret 仅经 Electron safeStorage 加密后写入。Linux basic_text 和不可用的系统加密均拒绝保存新凭据。账号、provider 或如流 App Key 改变不能复用旧 Secret。旧飞书配置无需迁移；一次只保存一个活动渠道配置，切换不保留多账号档案。详细接入步骤见 [平台指南](../usage/im-platforms.md)。

`im-gateway-state.json` 只存哈希消息凭据与终端绑定，不保存消息内容、屏幕或凭据。UI 通过 renderer service/preload 调用 IPC；不直接访问文件、网络和系统密钥环。

如流 SDK 在处理器异常后仍可能确认投递；本地持久化失败时网关拒绝操作并显示 `IM_GATEWAY_INFOFLOW_RECEIVE_FAILED`，不能保证平台重投。应先检查终端，再发送新消息，不能自动重放输入。

SDK 日志关闭，避免请求对象、token 和消息正文进入日志。应用运行日志仅记录 `im.gateway.accepted/replied/operation_failed/reply_failed/output_failed` 的必要标识和操作名，初始化失败只记录固定原因。消息回执不回显原始异常。

## 验证

核心测试使用真实临时状态文件；终端端口测试验证精确会话寻址；适配器测试使用模拟 SDK，不会向真实聊天发送消息。

| 测试文件 | 验收边界 |
| --- | --- |
| `tests/terminal-keys-backend.test.ts` | 单键/双键/三键精确编码、修饰键顺序/分隔符、Ctrl+Shift 不降级成 Ctrl、无效组合拒绝 |
| `tests/im-gateway-core-backend.test.ts` | 用户/群/主机权限、绑定隔离、断线失效、跨重启去重、队列、限流、停用、损坏/不可写状态、输入与输出边界、/binding 与 /status 查询、断开/关闭/替换会话及写入期间断开的明确回执、控制按键精确字节/不追加回车/无效键/权限/去重、all、卡片翻页/隔离/一次性选择、新建自动绑定、普通消息输入 |
| `tests/im-gateway-telegram-backend.test.ts`、`tests/im-gateway-infoflow-backend.test.ts` | 平台事件与身份校验、明确提及、选择命令/按钮、图片有效性与撤权、长消息、编辑失败、SDK 日志抑制、握手超时和停止后迟到回调 |
| `tests/im-gateway-platforms-backend.test.ts` | 真实 SDK 错误分发兼容保护、平台事件到核心绑定/输入去重/控制键/断开拒绝写入 |
| `tests/im-gateway-manager-backend.test.ts` | 默认关闭、加密、换账号/适配器、权限校验、生命周期和迟到回调、停止后不再启动 |
| `tests/im-gateway-terminal-backend.test.ts` | 写入精确 sessionId、面板复用时拒绝读屏、控制接口异常、本机/SSH 新建与失败保留 tab |
| `tests/im-gateway-feishu-backend.test.ts` | 事件筛选、精确机器人 @、连接状态、关闭取消、回复 UUID 与重试、不泄漏 SDK 日志、交互卡片、回调身份校验、主动输出 UUID、纯文本卡片创建与同 ID 更新/失败重试不新建 |
| `tests/im-gateway-host-creation.test.ts` | 按精确资产 ID 创建、同名冲突/资产删除不回退、新建失败保留面板 |
| `tests/im-gateway-output-backend.test.ts` | 输出分批、ANSI 跨块过滤、TUI 屏幕、缓冲超限、权限撤销、断线/解除绑定、断开单次通知/停止与撤权不通知/读屏中途断开、慢读屏和发送失败、动画合并为同一卡片/尾空格去重/最终屏幕、输入/帮助/按键等回执后新卡片、相同屏幕刷新、慢发送排序与迟到读屏隔离、直接/卡片/新建绑定回执先于首屏、回执失败/停止/撤权 |
| `tests/im-gateway-ipc.test.ts` | IPC 到配置/加密/管理器组装、不可用密钥环、退出停止 |
| `tests/im-gateway-settings.test.ts` | all/指定范围授权设置、保存后清空 Secret、轮询保留草稿、卸载停止轮询、错误提示、本页帮助入口不触发保存 |
| `tests/settings-external-actions-backend.test.ts`、`tests/app-runtime-ipc.test.ts` | IM 网关帮助页路由、中英文文档与繁体回退、相对链接仍在项目文档目录内 |
| `tests/app-shell.test.ts` | surface.create 显式启动本机 PTY，同时保留原面板创建与 SSH 连接回归 |
| `tests/main-terminal-shutdown-backend.test.ts` | 真实主进程 PTY 数据路径同时投递到渲染器和内存订阅，订阅异常不影响终端 |

运行相关测试和构建：

```bash
npx vitest run tests/im-gateway-*.test.ts tests/terminal-keys-backend.test.ts tests/control-socket-backend.test.ts tests/i18n-runtime.test.ts
npm run build
```

真实平台验收需要使用者配置自己的应用和授权身份，Telegram/如流步骤与尚未联调的边界见 [平台指南](../usage/im-platforms.md)。飞书验收包括：单聊卡片查询、翻页、绑定、本机/SSH 新建、普通消息输入/持续输出/读屏/中断/解除绑定；Codex 持续动画仅更新同一卡片、停止后的最终屏幕、下一轮输入另起卡片、`/key esc` 关闭菜单、`/key ctrl c` 中断及 `/key enter` 提交；all 和指定资产范围；群聊有无正确 @；非授权用户/主机拒绝；网络重连与终端 sessionId 变化；关闭网关后不再接受新操作。自动化模拟测试不能代替企业应用权限发布、真实消息投递和系统密钥环验收。

## 读屏与截图边界

`terminal.read_screen` 和移动端 replay 优先调用线程终端 `readScreen`，不能把绝对 scrollback 行号用于只有视口行的渲染缓存。核心 worker 在响应前提交已接收的数据并等待 xterm 解析回调，因此静态菜单无需下一次输出才能读取。控制端使用严格超时，不以旧缓存替代读取失败；传统终端仍读真实 buffer。面板与会话 ID 同时指定时必须同时匹配，异步读取完成后再次检查面板、会话和 view 身份。

输出事件与 renderer 交付存在短暂时差，初始读屏和重绘事件保留两次有界稳定读取机会；没有新事件后停止读屏，相同内容不发送，继续保留三秒卡片更新上限。避免一次空缓存读取把静态菜单永久吞掉。

`terminal.screenshot` 从同一核心获取当前底部屏幕的普通字符及样式 runs，在 renderer 独立 canvas 生成 PNG，不抓桌面或强制切换面板；图片尺寸和载荷均有限制。网关复核绑定后由平台适配器发送。飞书通过 image.create 上传并使用 image_key 回复，重试复用 UUID；Telegram 发送 PNG document；如流使用 SDK 图片消息。发送失败回复固定文字。图片仅在内存中处理；发送排队、上传前后和重试前重新核验授权。`/keymap` 和 `/help key` 在无绑定或绑定断开时也可查看，不产生终端读写；`/keymap` 忽略参数并返回完整映射，仍检查用户及群聊授权。帮助使用纯文本分组、空行分段和一行一条 `/key ... - 说明`，不依赖 Markdown 表格或空格对齐；保留别名、组合键限制及键盘协议说明。

补充回归：`tests/terminal-control-screen.test.ts` 覆盖历史滚动、后台面板、传统 buffer、身份冲突及异步替换；`tests/threaded-terminal-core-worker.test.ts` 使用真实 xterm 核心验证待解析数据和一次性更新菜单及反色行；`tests/terminal-screenshot.test.ts` 验证字符布局和颜色绘制、隐藏文字及尺寸限制。网关核心和适配器测试覆盖按键帮助、截图授权、上传失败与消息去重；输出测试保留动画防刷屏并覆盖静态菜单迟到。

打包回归 `tests/packaged-e2e/terminal-screen.spec.ts` 在独立用户目录启动真实软件，通过本机控制接口执行 shell 滚动输出，再生成一次性反色菜单并切换到其他面板，验证后台读屏和 PNG 截图；不连接真实飞书账号。

## 输入提交验证

`tests/im-gateway-input-backend.test.ts` 覆盖独立提交时序、4096 字符边界、多行粘贴、按键与仅输入语义、权限撤销/断连/绑定变化、消息顺序、重复投递及写入失败。核心、IPC、终端端口和输出回传测试保留完整输入字节及目标会话检查。

2026-11-15 在本机 Codex CLI 0.167.0 的真实 PTY 中复现了同批文字与 CR 不提交、间隔 200 ms 分开发送后提交的差异。此验证不代表所有交互程序或所有远程网络条件均已覆盖。
