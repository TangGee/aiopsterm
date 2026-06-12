# Kubernetes

Kubernetes clusters are added from a real kubeconfig source.

- Use **导入 Kubeconfig** to choose a kubeconfig file. aiopsterm reads the file in the main process, lists discovered contexts, and fills the cluster name, context, server URL, and default namespace from the selected context.
- Use **手动配置** only when you paste kubeconfig content. aiopsterm parses that content through the backend before testing or saving, then fills the context metadata from the parsed result.
- Saving a local kubeconfig cluster requires kubeconfig path or kubeconfig content. Empty local clusters and the old `new-cluster` / `new/context` / `https://new.k8s.local:6443` placeholder values are rejected before they can be written to the catalog.
- Test Connection and saved-cluster Connect run `kubectl get namespaces` through the backend using the selected context and namespace. Failures keep the cluster disconnected or in error state instead of marking it connected locally.

Development seed clusters are available only when `AIOPSTERM_KUBERNETES_ENABLE_SEED=1` is set.
