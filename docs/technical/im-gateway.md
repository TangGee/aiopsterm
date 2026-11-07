# IM 网关架构

使用与飞书配置集中在 [飞书 IM 网关](../usage/im-gateway.md)。本实现属于 aiopsterm Electron 主进程，不是单独部署的无界面远程服务。当前注册飞书一个渠道；消息规范、策略和终端控制不依赖飞书协议。

## 分层与扩展

- `src/shared/contracts/imGateway.ts`：设置、连接状态、IPC DTO。渲染进程不能读取 Secret，只得到 `hasAppSecret`。
- `src/main/ipc/imGateway.ts`：组装独立配置存储、系统加密、状态文件、适配器注册表、终端端口和运行日志；注册 status/save/terminals IPC。
- `backend/imGateway/gatewayManager.ts`：配置校验、凭据更新、串行保存及连接生命周期。重新配置先停止旧适配器与队列，再应用新权限。异步加载完成和迟到的连接回调受版本号、关闭状态保护。
- `gatewayCore.ts`：统一消息校验、用户和主机授权、聊天绑定、消息去重、会话队列、命令解析、一次性卡片选择及输出订阅生命周期。
- `gatewayTypes.ts`：`GatewayMessage`、`GatewayAdapter`、`GatewayTerminalPort`。适配器只负责 start/stop/reply/send，不拥有执行权限。
- `feishuAdapter.ts`：官方 `@larksuiteoapi/node-sdk` 1.76.0 的长连接消息、卡片回调接收及消息回复/主动推送。延迟导入，默认关闭时不加载 SDK。获取当前机器人的 open_id 后才接受群聊 @；不把任意机器人提及当成本应用提及。
- `gatewayTerminalPort.ts`：复用现有 [Control Socket 内部调用边界](control-socket.md) 的 terminal.list/send_text/read_screen、asset.list/ssh.connect 和 surface.create，不监听新网络端口。新建时指定资产 ID、`exactAssetId: true` 且 `reuse: false`，防止资产删除后按名称匹配到另一主机，本机通过 `surface.create` 的 `autoConnect: true` 启动 PTY 后等待对应面板的会话就绪；失败保留 tab。写入仅使用精确 sessionId；读取同时指定 panelId 和 sessionId，并校验返回的会话身份。

- `gatewayOutputRelay.ts` 与 `terminal/terminalOutputEvents.ts`：主进程终端数据的内存订阅，普通输出批量发送，TUI 重绘读取精确面板屏幕。飞书发送不会阻塞 PTY 渲染；解除绑定、停用、权限撤销或会话变更停止订阅。

增加渠道时，实现适配器、把厂商事件规范化为统一消息、在注册表添加 provider，并增加配置界面和厂商协议用例。必须保留核心授权与去重检查，不能让适配器直接调用终端。当前配置只启用一个 provider/account，并未实现多渠道同时连接。

## 身份、命令和并发边界

绑定键由 provider、accountId、tenantId、conversationId、senderId 的 JSON 数组 SHA-256 构成。每次操作重新列出终端并检查主机资产授权、连接状态和原 sessionId/panelId；主机重连不能自动继承旧绑定。本地终端默认不授权。`allowedAssetIds` 含保留值 `all` 时允许本机和全部保存的 SSH 资产，包括后来新增的资产；用户和群聊权限仍是精确白名单，`*` 无特殊语义。

单聊检查用户允许列表；群聊还要检查聊天允许列表及当前机器人的精确 @。未知斜杠指令回复帮助。普通聊天在已绑定后输入终端并回车，未绑定时提示选择卡片。`/sessions` 和 `/new` 卡片每页 8 项，以名称和主机展示。新建调用已有桌面本机/SSH 流程，不调用 LLM。`/run` 表示写入并回车，不跟踪退出码或声明完成。`/interrupt` 是固定 Ctrl+C；普通消息最多 4096 字符，多行和制表符用 bracketed paste；拒绝其余控制字符。`/run`、`/send` 保持单行 2048 字符上限。

每个聊天身份串行处理，独立聊天可以并行。全局最多 32 条已接受且未完成的消息。对同一终端的重叠操作返回忙，不自动重复执行。停用、更新权限或应用退出后不执行排队中的操作；已经送出的输入无法撤回。

## 持久化与重试语义

统一消息要求非空身份字段（最多 512 字符）、有效时间和已知聊天类型。消息正文最多 4096 字符，忽略超过 5 分钟或来自未来超过 60 秒的消息。允许列表每项最多 100 个 ID。

卡片不携带可直接执行的命令或 sessionId，只携带随机令牌。核心保存令牌与请求身份、操作的映射，10 分钟失效，最多 2000 个；执行前消费令牌并重新鉴权。飞书适配器也核对回调操作人与原聊天，重建源消息身份；不会信任按钮传回的用户或授权范围。卡片回调按 `card:<令牌>` 去重并快速确认接收，终端创建在队列中执行。重启后旧卡片失效。

消息去重键包含 provider、accountId、tenantId 和 **messageId**，不能使用飞书 event_id 作为业务去重依据。接收事件先将去重凭据写入磁盘，再确认接收并排队。状态采用临时文件加原子重命名；文件损坏或写盘失败时拒绝执行。新消息到达时清理 24 小时之前的凭据，上限 10000 条；绑定上限 1000 条，状态读取上限 4 MiB。

这是“同一消息至多尝试执行一次”，不是事务性恰好执行一次。若进程在记录凭据后、写入终端前崩溃，该消息可能未执行，但不会因投递重试自动再执行。原子重命名也不保证断电后的磁盘持久性。需要人工先查看终端，确认后再发送一条新消息。

飞书回复和输出推送独立重试最多 3 次，重复请求使用同一个 UUID，总回复请求间隔至少 250 ms。回复失败不重发终端输入。HTTP 超时 15 秒，关闭适配器会取消请求、等待和 WebSocket 重连。终端屏幕使用纯文本回复，去除 ANSI/控制字符并中和提及标记，最多保留末尾 6000 字符。主动输出使用 `im.message.create` 发送到原 chat_id，每批单独 UUID，重试保持该 UUID，避免相同输出被去重。

输出订阅只保存在内存，不持久化聊天正文。新绑定先发送最近屏幕，再每秒合并原会话的数据；跨数据块的 ANSI 状态机过滤 CSI/OSC。光标重绘程序改为推送变化的屏幕，避免把绘制指令当正文；普通流每批最多 6000 字符，缓冲上限 64000 字符，超限有提示。每次发出前重新验证授权、sessionId/panelId 和绑定身份，慢读屏完成后也验证；发送失败停止订阅并记录 `output_failed`，下一次 `/status`、输入或重新绑定可恢复。重启/重新配置后不立即恢复输出，待该身份发来下一条消息。

## 凭据、状态与日志

配置单独存储在 userData 下的 `im-gateway.json`；Secret 仅经 Electron safeStorage 加密后写入。Linux basic_text 和不可用的系统加密均拒绝保存新凭据。账号或 provider 改变不能复用旧 Secret。

`im-gateway-state.json` 只存哈希消息凭据与终端绑定，不保存消息内容、屏幕或凭据。UI 通过 renderer service/preload 调用 IPC；不直接访问文件、网络和系统密钥环。

SDK 日志关闭，避免请求对象、token 和消息正文进入日志。应用运行日志仅记录 `im.gateway.accepted/replied/operation_failed/reply_failed/output_failed` 的必要标识和操作名，初始化失败只记录固定原因。消息回执不回显原始异常。

## 验证

核心测试使用真实临时状态文件；终端端口测试验证精确会话寻址；适配器测试使用模拟 SDK，不会向真实聊天发送消息。

| 测试文件 | 验收边界 |
| --- | --- |
| `tests/im-gateway-core-backend.test.ts` | 用户/群/主机权限、绑定隔离、断线失效、跨重启去重、队列、限流、停用、损坏/不可写状态、输入与输出边界、all、卡片翻页/隔离/一次性选择、新建自动绑定、普通消息输入 |
| `tests/im-gateway-manager-backend.test.ts` | 默认关闭、加密、换账号/适配器、权限校验、生命周期和迟到回调、停止后不再启动 |
| `tests/im-gateway-terminal-backend.test.ts` | 写入精确 sessionId、面板复用时拒绝读屏、控制接口异常、本机/SSH 新建与失败保留 tab |
| `tests/im-gateway-feishu-backend.test.ts` | 事件筛选、精确机器人 @、连接状态、关闭取消、回复 UUID 与重试、不泄漏 SDK 日志、交互卡片、回调身份校验、主动输出 UUID |
| `tests/im-gateway-host-creation.test.ts` | 按精确资产 ID 创建、同名冲突/资产删除不回退、新建失败保留面板 |
| `tests/im-gateway-output-backend.test.ts` | 输出分批、ANSI 跨块过滤、TUI 屏幕、缓冲超限、权限撤销、断线/解除绑定、慢读屏和发送失败 |
| `tests/im-gateway-ipc.test.ts` | IPC 到配置/加密/管理器组装、不可用密钥环、退出停止 |
| `tests/im-gateway-settings.test.ts` | all/指定范围授权设置、保存后清空 Secret、轮询保留草稿、卸载停止轮询、错误提示、本页帮助入口不触发保存 |
| `tests/settings-external-actions-backend.test.ts`、`tests/app-runtime-ipc.test.ts` | IM 网关帮助页路由、中英文文档与繁体回退、相对链接仍在项目文档目录内 |
| `tests/app-shell.test.ts` | surface.create 显式启动本机 PTY，同时保留原面板创建与 SSH 连接回归 |
| `tests/main-terminal-shutdown-backend.test.ts` | 真实主进程 PTY 数据路径同时投递到渲染器和内存订阅，订阅异常不影响终端 |

运行相关测试和构建：

```bash
npx vitest run tests/im-gateway-*.test.ts tests/control-socket-backend.test.ts tests/i18n-runtime.test.ts
npm run build
```

真实飞书验收需要使用者配置自己的应用和授权身份：单聊卡片查询、翻页、绑定、本机/SSH 新建、普通消息输入/持续输出/读屏/中断/解除绑定；all 和指定资产范围；群聊有无正确 @；非授权用户/主机拒绝；网络重连与终端 sessionId 变化；关闭网关后不再接受新操作。自动化模拟测试不能代替企业应用权限发布、真实消息投递和系统密钥环验收。
