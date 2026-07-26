# 主机、跳板机与 JumpServer

本章从典型目标出发：把生产入口保存一次，以后通过名称连接；需要时经过代理或跳板机，并让 JumpServer 组织资产自动进入统一资源树。

![资产工作区](../images/assets-workspace.png)

资产工作区用 **① 主机管理**、**② 堡垒机管理**、**③ 密钥管理** 和 **④ 代理管理** 分开维护连接资源；**⑤** 是可连接的主机资产。

## 场景一：保存主机后免重复输入

在资产工作区的主机管理中创建主机，填写名称、地址、端口、用户名和认证方式。密码认证可以选择保存密码，密钥认证应引用 KeyChain 中的密钥记录。

保存后可以通过以下入口连接同一资产：

- 工作区资源树双击主机。
- 资产工作区双击主机。
- aiopsterm 本地终端运行 `aiossh <主机名>`。
- 外部 Agent 安装 `aiopsterm_hosts` 后调用主机工具。

未保存密码时，连接会弹出全局认证对话框。勾选 `记住密码并更新该主机` 后，只有 SSH 真正进入 ready 状态才会写入密码，失败的凭据不会覆盖原记录。

## 场景二：通过代理连接内网 SSH

主机表单可以选择已保存的代理：

- HTTP/HTTPS CONNECT。
- SOCKS4/SOCKS5。
- raw TCP，适用于已经把字节流映射到目标 SSH 服务的代理端点。

raw TCP 不会向代理发送目标地址元数据，也不支持代理账号协议。代理配置、主机认证和目标地址仍由主进程管理，不会作为普通资产列表字段暴露给渲染层或 AI。

## 场景三：通过跳板机二次 SSH

给目标主机选择跳板机后，aiopsterm 优先使用标准 SSH TCP 转发连接目标。跳板机或目标机要求密码、OTP 或 keyboard-interactive 时，统一认证对话框会显示当前认证请求。

当跳板机拒绝 TCP 转发时，终端连接可以回退到 relay-shell：

1. 本地 OpenSSH 先登录跳板机。
2. 等待可交互提示符。
3. 在该终端流中写入嵌套 `ssh <目标>`。

relay-shell 保留终端交互，但不是结构化 SSH 通道，因此不支持 SFTP 文件管理。需要文件传输时应使用允许 TCP 转发的跳板机，或在终端内运行 `scp`、`rsync`。

## 场景四：同步 JumpServer 组织资产

在堡垒机管理中创建 JumpServer 数据源：

1. 填写 JumpServer 根 URL，例如 `https://jumpserver.example.com`。
2. 填写 Private Token。
3. 按需填写 JumpServer 组织 ID。
4. 保存堡垒机自身的 SSH 地址和认证信息。
5. 运行 `刷新组织资产`。

同步成功后，JumpServer 主机会作为后端拥有的资产出现在堡垒机资源树中。刷新会更新已有同步项、创建新项，并只删除该组织中已经标记为 JumpServer 同步且远端不再存在的行；手工创建的资产不会被清理。

Private Token 通过凭据存储保存，普通资产快照和导出中只保留是否存在 Token 的标记。同步失败时旧资产保持不变，避免网络或认证故障把有效目录清空。

## JumpServer 与 Kubernetes

Kubernetes 工作区可以把已同步的 JumpServer 资产映射为集群目录项，但当前不提供 JumpServer 命令流。此类集群的 Connect、资源刷新和 K8s 终端会明确失败，不会伪造连接成功。需要真实 Kubernetes 操作时应导入本地 kubeconfig。

## 排错顺序

1. 在主机或堡垒机表单运行连接测试。
2. 区分网络失败、密码被拒、密钥被拒、服务器禁用密码和缺少认证方式。
3. JumpServer 同步失败时检查根 URL、Private Token、组织 ID 和服务端分页响应。
4. 二次 SSH 失败时确认跳板机是否允许 TCP 转发。
5. SFTP 不可用时确认当前是否为 relay-shell 路径。
