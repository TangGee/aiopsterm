# Kubernetes 日常操作

本章从一个常见任务开始：导入现有 kubeconfig，查看目标 namespace 的工作负载，读取 Pod 日志，并在需要时打开真实 kubectl 终端。

![Kubernetes 工作区](../images/kubernetes-workspace.png)

**①** 切换 context，**②** 是 kubectl 终端，**③** 管理集群配置，**④** 浏览和操作资源。

## 场景一：导入 kubeconfig

在 Kubernetes 工作区选择 `导入 Kubeconfig`：

1. 选择 kubectl 或 client-go 格式的 kubeconfig 文件。
2. 从解析出的 contexts 中选择目标。
3. 检查自动填充的集群名称、server、context 和默认 namespace。
4. 运行 Test Connection。
5. 保存并连接。

也可以使用手动配置粘贴 kubeconfig 内容。空配置和旧的占位地址会被拒绝。证书轮换后可以更新已保存集群的路径或内容，连接状态会重置，下一次 Connect 使用新凭据探测。

## 场景二：查看资源和日志

连接后，从资源视图选择 namespace 和资源类型。典型排查顺序：

1. 查看 Deployment、StatefulSet 和 Pod 状态。
2. 对异常资源执行 Describe。
3. 读取 Pod Logs。
4. 需要持续观察时打开 Kubernetes Terminal，运行 `kubectl logs -f`。

资源动作由后端根据当前集群、context 和 namespace 生成真实 kubectl 调用。连接失败不会被界面标记为成功。

## 场景三：打开隔离的 kubectl 终端

每个 Kubernetes 终端使用会话级 kubeconfig 副本，并将 current-context 固定到选择的集群。终端内运行 `kubectl config use-context` 不会修改用户原始 kubeconfig。

流式日志和 `kubectl exec` 可以工作。该终端是普通 PTY 文本视图，不适合依赖完整屏幕控制的 TUI。kubectl 单次输出上限为 10 MiB，终端状态只保留最新 1 MiB；长期日志应依赖可见终端 scrollback 或外部日志系统。

## JumpServer 来源集群

JumpServer 组织资产可以同步到 Kubernetes 目录，但当前没有 JumpServer 命令流。此类集群的 Connect、资源刷新、终端创建和资源动作会失败关闭。需要执行真实 kubectl 时，请导入可以直接访问集群的 kubeconfig。

## 安全与排错

- kubeconfig 内容和会话副本以仅当前用户可读写的权限保存。
- 连接测试和 Connect 需要本机可用的 kubectl，或配置 `AIOPSTERM_KUBECTL_PATH`。
- Test Connection 默认在 15 秒后超时，普通资源刷新默认 30 秒。
- 连接后看不到资源时，检查 context、namespace 和 Kubernetes RBAC。
- 证书、Token 或 server 变化后，更新配置并重新 Connect。
- 输出被截断时缩小 label selector、namespace 或资源范围。
