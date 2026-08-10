# Kubernetes

For the operator workflow from kubeconfig import through logs and terminal access, start with [Kubernetes Daily Operations](best-practices/en-US/14-kubernetes.md).

Kubernetes clusters are added from a real kubeconfig source.

- Use **导入 Kubeconfig** to choose a kubeconfig file. aiopsterm reads the file in the main process, parses it with a real YAML parser (canonical kubectl/client-go layouts and JSON kubeconfigs are supported), lists discovered contexts, and fills the cluster name, context, server URL, and default namespace from the selected context.
- Use **手动配置** only when you paste kubeconfig content. aiopsterm parses that content through the backend before testing or saving, then fills the context metadata from the parsed result.
- Saving a local kubeconfig cluster requires kubeconfig path or kubeconfig content. Empty local clusters and the old `new-cluster` / `new/context` / `https://new.k8s.local:6443` placeholder values are rejected before they can be written to the catalog.
- Cluster settings can update the kubeconfig path or pasted kubeconfig content in place (for example after certificate rotation). A kubeconfig change resets the cluster to `disconnected` so the next Connect re-probes with the new credentials.
- Test Connection and saved-cluster Connect run `kubectl get namespaces` through the backend using an asynchronous `kubectl` subprocess and the selected context/namespace. The connection probe times out after 15 seconds, normal command/resource refreshes use a 30-second default, failures keep the cluster disconnected or in error state instead of marking it connected locally, and clusters without kubeconfig path/content cannot open K8s terminal sessions.
- Kubernetes terminals for kubeconfig-backed clusters are real PTY shell sessions (node-pty). Each session gets a private, session-scoped copy of the kubeconfig with `current-context` pinned to the cluster's context (0600, cleaned up on close), so in-session `kubectl config use-context` never mutates the user's real kubeconfig. Streaming commands such as `kubectl logs -f` and `kubectl exec` work; full-screen TUI programs (vim, top) are not supported by the plain-text terminal view. Terminal sessions created before Connect stay in `connecting` and the shell starts once the cluster connects.
- Local `kubectl` output is capped at 10 MiB. If a command exceeds that limit, aiopsterm returns the captured prefix plus an `[aiopsterm] kubectl output truncated at 10MB.` notice instead of retaining unbounded output in the main process.
- Kubernetes terminal sessions keep only the newest 1 MiB of accumulated terminal output in session state. Long-running sessions should rely on the visible terminal scrollback or external logs for older output.
- Kubernetes state files that may contain credentials (`kubernetes/catalog.json` with kubeconfig content, `kubernetes/agent-proxy.json` with proxy passwords, and session kubeconfig copies) are written with 0600 permissions.
- JumpServer bastion sync refreshes the matching organization asset through the backend asset boundary, converts backend-owned synced assets into JumpServer-sourced Kubernetes clusters, and upserts them by bastion, asset address, and asset name. JumpServer command streaming is still not available, so Connect, terminal creation/writes, resource actions, and resource refreshes for JumpServer clusters fail closed until that stream is wired.

Development seed clusters are available only when `AIOPSTERM_KUBERNETES_ENABLE_SEED=1` is set. Seed cluster terminals stay in the simulated command mode (no PTY).

## Live integration tests

- `AIOPSTERM_LIVE_K8S_PTY=1 npm run test:live:k8s:pty` runs the full backend flow (import → connect → refresh → terminal) against a real node-pty shell with a high-fidelity kubectl double. No cluster required; works in any Linux/macOS environment.
- `AIOPSTERM_LIVE_K8S_KUBECONFIG=~/.kube/config npm run test:live:k8s` runs the same flow against a real cluster (kind/minikube/k3s). Optional `AIOPSTERM_LIVE_K8S_CONTEXT` selects a context; the test is read-only (`get`/`version`) and asserts the user kubeconfig is never mutated. Requires `kubectl` on PATH or `AIOPSTERM_KUBECTL_PATH`.

Both suites are skipped unless their environment switch is set.
