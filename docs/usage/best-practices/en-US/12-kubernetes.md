# Everyday Kubernetes Operations

This guide starts with a common task: import a kubeconfig, inspect workloads in one namespace, read Pod logs, and open a real kubectl terminal when needed.

![Kubernetes workspace](../images/kubernetes-workspace.png)

Use **①** to switch context, **②** for the kubectl terminal, **③** for cluster configuration, and **④** to browse and operate resources.

## Scenario 1: Import A Kubeconfig

Choose Import Kubeconfig:

1. Select a kubectl or client-go style kubeconfig.
2. Choose one discovered context.
3. Verify the cluster name, server, context, and default namespace.
4. Run Test Connection.
5. Save and connect.

Manual configuration accepts pasted kubeconfig content. Empty and historical placeholder configurations are rejected. Updating a saved path or content after credential rotation resets the connection so the next Connect uses the new credentials.

## Scenario 2: Inspect Resources And Logs

After connecting, choose a namespace and resource kind:

1. Inspect Deployment, StatefulSet, and Pod status.
2. Run Describe on abnormal resources.
3. Read Pod Logs.
4. Open a Kubernetes Terminal for `kubectl logs -f`.

The backend builds real kubectl operations from the selected cluster, context, and namespace. A failed probe never becomes a locally fabricated connected state.

## Scenario 3: Use An Isolated kubectl Terminal

Each Kubernetes terminal receives a private session kubeconfig with current-context pinned to the selected cluster. Running `kubectl config use-context` in that shell does not modify the user's original file.

Streaming logs and `kubectl exec` work. Full-screen TUI programs are not supported by the plain terminal view. kubectl output is capped at 10 MiB and terminal session state retains the newest 1 MiB.

## JumpServer-Sourced Clusters

JumpServer organization assets can appear in the Kubernetes catalog, but JumpServer command streaming is not implemented. Connect, refresh, terminal, and resource actions fail closed. Import a directly usable kubeconfig for real kubectl work.

## Security And Troubleshooting

- Kubeconfig content and session copies use current-user-only file permissions.
- Test and Connect require kubectl or `AIOPSTERM_KUBECTL_PATH`.
- Test Connection times out after 15 seconds; ordinary refresh uses 30 seconds by default.
- Missing resources usually indicate context, namespace, or RBAC issues.
- Update and reconnect after server, certificate, or token rotation.
- Narrow namespace, resource, or label filters when output is truncated.
