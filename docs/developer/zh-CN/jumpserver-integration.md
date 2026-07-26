# 接入 JumpServer

本文面向 JumpServer 管理员和集成开发者，说明如何让 aiopsterm 同步一个组织的主机目录，同时把 API 数据源和堡垒机 SSH 登录作为两个独立边界管理。

## 场景：统一同步组织资产

在 aiopsterm 中，一个 JumpServer 堡垒机记录同时包含两组配置：

| 配置 | 用途 |
| --- | --- |
| JumpServer 根 URL、Private Token、组织 ID | 调用资产 API，刷新组织目录 |
| 堡垒机地址、SSH 端口、用户名和密码或密钥 | 登录堡垒机以及作为目标主机的跳板入口 |

API Token 不能替代 SSH 凭据，SSH 凭据也不能访问资产 API。部署时应分别授予最小权限。

## JumpServer API 契约

aiopsterm 从根 URL 构造以下请求：

```http
GET /api/v1/assets/hosts/?limit=100&offset=0
Authorization: PrivateToken <token>
X-JMS-ORG: <organization-id>
```

`X-JMS-ORG` 只在配置了组织 ID 时发送。根 URL 应类似 `https://jumpserver.example.com`，不要把具体 hosts API 路径填进根 URL。

客户端行为：

- 每页超时 30 秒。
- 最多读取 100 页。
- 只跟随与根 URL 同源的下一页地址。
- 接受 JumpServer 列表或带 `results` 和 `next` 的分页响应。
- 网络、认证、非成功 HTTP、非 JSON、跨源分页和畸形主机记录都会让本次刷新失败。

建议为 Token 账号授予目标组织的主机资产只读权限。可以先在管理环境验证：

```sh
curl \
  -H "Authorization: PrivateToken $JMS_PRIVATE_TOKEN" \
  -H "X-JMS-ORG: $JMS_ORG_ID" \
  "https://jumpserver.example.com/api/v1/assets/hosts/?limit=100&offset=0"
```

不要把 Token 写入脚本、日志或问题截图。

## 字段映射与稳定更新

有效远端主机会映射以下信息：

- JumpServer 主机 ID。
- 名称和地址。
- SSH 端口。
- 节点路径。
- 状态、类型和分类。
- 备注。

本地记录以所选堡垒机和组织范围内的远端身份稳定更新。一次成功刷新会：

1. 更新已存在的同步资产。
2. 创建新增资产。
3. 删除远端已消失、且明确标记为该组织 JumpServer 同步来源的旧记录。
4. 保留手工创建的主机和其他组织的同步资产。

只有远端结果完整通过验证后才应用更新。认证失败、分页失败或响应畸形时，现有同步目录保持不变，避免暂时故障造成批量误删。

## 凭据和数据保护

Private Token 通过后端凭据存储加密后写入 SQLite 或备用存储。普通资产快照只暴露 `hasJumpserverToken`，资产导出不包含 Token。编辑时，明文只通过专用 editable-secret 边界返回。

集成方还应遵守：

- 为每个环境使用独立 Token。
- 定期轮换，并在轮换后立即运行刷新测试。
- 反向代理不得把 `Authorization` 或 `X-JMS-ORG` 写入访问日志。
- TLS 证书必须覆盖根 URL；不要为了测试长期关闭验证。

## SSH、二次登录和文件管理

同步目录只负责发现资产。真正连接目标主机时仍使用 aiopsterm 的 SSH 运行时：

- 优先通过堡垒机的标准 SSH TCP 转发建立二次 SSH。
- 密码、OTP 和 keyboard-interactive 请求在 aiopsterm 认证对话框中处理。
- 若堡垒机拒绝 TCP 转发，可见终端可能回退到 relay-shell，再执行嵌套 SSH。
- relay-shell 不是结构化 SSH 通道，不支持 SFTP。文件管理应使用允许 TCP 转发的路径，或在终端中运行 `scp` 或 `rsync`。

## Kubernetes 能力边界

同步资产可以映射进 Kubernetes 目录，但当前没有 JumpServer Kubernetes 命令流。此来源的 Connect、资源刷新、终端和资源动作会失败关闭。真实集群操作应导入可直接使用的 kubeconfig。

## 联调清单

1. 用 curl 验证 Token、组织头和第一页响应。
2. 检查所有分页 `next` 都与根 URL 同源。
3. 在 aiopsterm 保存数据源，确认普通资产快照和导出不含 Token。
4. 首次刷新后核对创建数量、名称、地址、端口和节点路径。
5. 修改一个远端资产并刷新，确认本地稳定更新而不是重复创建。
6. 删除一个远端同步资产并创建一个本地手工资产，确认只清理同步项。
7. 使用错误 Token 测试，确认已有目录不被清空。
8. 分别测试堡垒机 SSH、目标二次 SSH、OTP 和 SFTP 能力边界。

用户操作见[主机、跳板机与 JumpServer](../../usage/best-practices/zh-CN/10-host-management-jumpserver.md)，实现说明见[资产与工作区资源](../../usage/assets-workspace.md)和[SSH 终端运行时](../../technical/ssh-terminal.md)。
