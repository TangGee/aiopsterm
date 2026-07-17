# 故障排查速查

遇到问题先拿日志，再按症状对表。本文是[完整故障排查文档](../../troubleshooting.md)的实战速查版。

## 第一步：找到日志

运行诊断写在：

```text
<userData>/logs/aiopsterm-runtime.log
```

Linux 下 `<userData>` 通常是 `~/.config/aiopsterm`。最快的入口是 **设置 -> 关于 -> Open Log Dir**（见[设置要点](07-settings.md)）。

![关于页](../images/settings-about.png)

终端写入日志只记录字节数与会话元数据，**不含命令文本与密钥**，可放心随报告提交。

## 症状对表

| 症状 | 先看什么 |
| --- | --- |
| 终端输入没反应 | 日志中最近的 `terminal.*` 与 `renderer.terminal-*` 条目 |
| 跑 TUI 程序（codex 等）卡顿 | `terminal.data.summary`、`renderer.terminal-output.slow-write` 的 `writeMs/queueMs/maxPendingBytes` |
| 打开 AI 会话模块变慢 | `ai-agent.managed-event` 里的 `managed_ai.sessions.imported`，对照 `agent-sessions/managed-ai-sessions.audit.jsonl` |
| 会话行双击跳终端慢 | `renderer.managed-ai-session.terminal-switch.*` 五阶段耗时（requested → target-resolved → panel-activated → ui-frame-ready → terminal-frame-ready） |
| 打开会话内容慢 | 后端 `managed_ai.content.list.durationMs` 低而渲染 `renderSettleMs` 高 → 瓶颈在卡片渲染而非磁盘 IO |
| SSH 连不上 | 见下节跳板机诊断 |
| 右侧 Codex 报 `ETIMEDOUT` | 健康检查超时，`AIOPSTERM_CODEX_HEALTH_CHECK_TIMEOUT_MS=60000` 加大；再用报错路径直接跑 `codex --version` 验证 |

判读输出类问题的经验法则：`terminal.data.summary` 高但渲染耗时低 → 程序本身输出量大；`terminal.data.coalesced` 频繁合并 → 后端正常降 IPC 压力；`slow-write` 的 `writeMs/queueMs` 高 → 瓶颈在 xterm 渲染吞吐。批量合并是背压不丢数据，受回滚行数上限约束。

## SSH 与跳板机诊断

SSH 生命周期日志带结构化元数据（不含密码/私钥/OTP/命令文本），关键字段：

- `authScope`: `jump`（跳板机侧）/ `target`（目标机侧）——先分清是哪一跳出的问题。
- `sshTransport`: `direct` / `proxy` / `jump` / `relay-shell`。
- `connectionReuse`: `created` 新建认证连接 / `reused` 复用既有连接。
- `remoteHop` + `endpointConfidence`: relay-shell 模式下判断当前到底在跳板机还是目标机。

跳板机失败按顺序读：① `terminal.keyboard-interactive.request`（`authScope:"jump"`，跳板机要动态口令）→ ② `stage:"proxy-opening"`（隧道参数）→ ③ `Opening SSH jump tunnel ...`（跳板机已认证，开始 forwardOut）→ ④ `authScope:"target"`（目标机握手）。到 ③ 被拒即 TCP 转发被禁，aiopsterm 会自动回退 relay-shell 模式——认证提示会出现在终端流里而不是全局对话框。

其他要点：

- 首次连接不再预弹密码框：真实服务器拒绝认证且资产支持密码时才弹，成功重试后可记住密码。
- SSH ready 超时默认 120 秒，适配交互式跳板机/动态口令流程。
- relay/跳板机主机不支持 SFTP 文件管理是**明确的不支持状态**，用 `scp`/`rsync` 替代。

## 崩溃与安全模式

启用崩溃诊断（`npm run build:start` 自动带 `AIOPSTERM_CRASH_DIAGNOSTICS=1`；正式包默认关闭）后：

- 崩溃转储本地存于 `<userData>/crashes/`，不上传。
- 日志关注 `electron.render-process-gone`、`electron.child-process-gone`、`process.uncaught-exception`、`crash-diagnostics.ready`。
- 上次未正常退出时，下次启动自动进入一次**崩溃安全模式**：禁用线程化终端渲染、强制 worker 2D、关闭硬件加速；正常退出后自动解除。`AIOPSTERM_CRASH_SAFE_MODE=0` 可禁用该行为。

## 渲染后端排查

- 线程化终端不可用时日志出现 `renderer.threaded-terminal.unavailable` 并回退普通 xterm；`AIOPSTERM_THREADED_TERMINAL=0` 可强制回退做对照。
- 验证 WebGL2 是否真跑在硬件 GPU：`npm run build && npm run probe:terminal-gpu`，看 `terminalBackend` 与 `hardwareLikely`。
- 通知路径疑似导致卡顿时，到 设置 -> AI 通知 暂时关闭桌面通知做隔离测试。

## 报障清单

提交问题时附上：复现步骤、`aiopsterm-runtime.log` 中相关时间段（含上文提到的事件条目）、设置 -> 关于 的版本号、以及 `Feedback` 生成的诊断报告。
