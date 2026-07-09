import type { TerminalPanel } from '@/stores/workspace'
import { isTerminalWorkspacePanel } from '@/services/terminal/terminalPanelRuntime'
import {
  controlBool,
  controlFail,
  controlOk,
  controlText,
  isRecord,
  type ControlSurfaceResumeBindingState,
  type WorkspaceStore
} from '@/services/terminal/terminalControlSurfaceCore'
import type {
  ControlResponse,
  ControlSurfaceSummary,
  ControlTerminalSummary,
  ControlWorkspaceSnapshot
} from '@shared/contracts/control'

type TerminalControlSurfaceResumeDependencies = {
  workspace: WorkspaceStore
  controlSurfaceResumeBindings: { value: Record<string, ControlSurfaceResumeBindingState> }
  resolveControlSurfacePanel: (params?: Record<string, unknown>) => TerminalPanel | null
  surfaceSummaryForControl: (panel: TerminalPanel) => ControlSurfaceSummary
  terminalSummaryForControl: (panel: TerminalPanel) => ControlTerminalSummary
  workspaceSnapshotForControl: () => ControlWorkspaceSnapshot
}

export const createTerminalControlSurfaceResumeHandlers = ({
  workspace,
  controlSurfaceResumeBindings,
  resolveControlSurfacePanel,
  surfaceSummaryForControl,
  terminalSummaryForControl,
  workspaceSnapshotForControl
}: TerminalControlSurfaceResumeDependencies) => {
  const cleanSurfaceResumeEnvironment = (value: unknown) => {
    if (!isRecord(value)) return undefined
    const entries = Object.entries(value)
      .map(([key, entry]) => [key.trim(), typeof entry === 'string' ? entry.trim() : ''] as const)
      .filter(([key, entry]) => key && entry && !/(token|password|passwd|secret|api[_-]?key|credential|auth|bearer)/i.test(key))
    return entries.length ? Object.fromEntries(entries) : undefined
  }

  const surfaceResumeBindingPayload = (binding?: ControlSurfaceResumeBindingState | null) => {
    if (!binding) return null
    const trustedAt = typeof binding.trustedAt === 'number' ? binding.trustedAt : binding.trusted_at
    return {
      ...binding,
      checkpoint_id: binding.checkpointId || binding.checkpoint_id,
      auto_resume: binding.autoResume,
      approval_policy: binding.approvalPolicy || binding.approval_policy,
      approval_record_id: binding.approvalRecordId || binding.approval_record_id,
      ...(typeof trustedAt === 'number' ? { trustedAt, trusted_at: trustedAt } : {}),
      trust_reason: binding.trustReason || binding.trust_reason,
      updated_at: binding.updatedAt
    }
  }

  const surfaceResumeFingerprint = (panel: TerminalPanel, binding: ControlSurfaceResumeBindingState) =>
    [
      controlText(binding.kind) || 'surface-resume',
      controlText(binding.command),
      controlText(binding.cwd || panel.cwd),
      controlText(binding.checkpointId || binding.checkpoint_id),
      controlText(binding.source)
    ].join('\u001f')

  const surfaceResumeTrustId = (panel: TerminalPanel, binding: ControlSurfaceResumeBindingState) =>
    `surface-resume:${panel.id}:${surfaceResumeFingerprint(panel, binding)}`

  const isSurfaceResumeTrustedForAuto = (panel: TerminalPanel, binding?: ControlSurfaceResumeBindingState | null) => {
    if (!binding?.command.trim()) return false
    const trustedAt = typeof binding.trustedAt === 'number' ? binding.trustedAt : binding.trusted_at
    const approvalRecordId = binding.approvalRecordId || binding.approval_record_id
    return Boolean(
      binding.autoResume === true &&
        (binding.approvalPolicy || binding.approval_policy) === 'auto' &&
        approvalRecordId &&
        typeof trustedAt === 'number' &&
        approvalRecordId === surfaceResumeTrustId(panel, binding)
    )
  }

  const surfaceResumePayload = (panel: TerminalPanel, cleared = false) => {
    const binding = surfaceResumeBindingPayload(controlSurfaceResumeBindings.value[panel.id])
    return {
      surface: surfaceSummaryForControl(panel),
      terminal: isTerminalWorkspacePanel(panel) ? terminalSummaryForControl(panel) : null,
      surfaceId: panel.id,
      surface_id: panel.id,
      surface_ref: panel.id,
      workspaceId: 'main',
      workspace_id: 'main',
      workspace_ref: 'main',
      cleared,
      resumeBinding: binding,
      resume_binding: binding,
      trusted: isSurfaceResumeTrustedForAuto(panel, controlSurfaceResumeBindings.value[panel.id]),
      snapshot: workspaceSnapshotForControl()
    }
  }

  const surfaceResumePreviewItems = (params: Record<string, unknown> = {}) =>
    workspace.panels
      .filter((panel) => isTerminalWorkspacePanel(panel))
      .map((panel) => {
        const binding = controlSurfaceResumeBindings.value[panel.id]
        const trusted = isSurfaceResumeTrustedForAuto(panel, binding)
        const reason = !binding?.command.trim()
          ? 'missing-binding'
          : !panel.sessionId
              ? 'terminal-not-connected'
              : binding.autoResume !== true
                ? 'manual'
                : !trusted
                  ? 'untrusted'
                  : 'ready'
        return {
          panel,
          binding,
          trusted,
          reason,
          ready: reason === 'ready'
        }
      })
      .filter((item) => {
        const panelId = controlText(params.panelId || params.surfaceId)
        const sessionId = controlText(params.sessionId || params.terminalSessionId)
        if (panelId && item.panel.id !== panelId) return false
        if (sessionId && item.panel.sessionId !== sessionId) return false
        return item.binding || params.includeAll === true || params.include_all === true
      })

  const surfaceResumeAutoPayload = (items = surfaceResumePreviewItems()) => ({
    candidates: items.map((item) => ({
      surface: surfaceSummaryForControl(item.panel),
      terminal: terminalSummaryForControl(item.panel),
      resumeBinding: surfaceResumeBindingPayload(item.binding),
      resume_binding: surfaceResumeBindingPayload(item.binding),
      trusted: item.trusted,
      ready: item.ready,
      reason: item.reason
    })),
    count: items.length,
    readyCount: items.filter((item) => item.ready).length,
    trustedCount: items.filter((item) => item.trusted).length,
    snapshot: workspaceSnapshotForControl()
  })

  const handleSurfaceResumeControlRequest = async (method: string, params: Record<string, unknown>): Promise<ControlResponse> => {
    const panel = resolveControlSurfacePanel(params)
    if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
    if (method === 'surface.resume.set') {
      const command = controlText(params.command || params.shell || params.shellCommand)
      if (!command) return controlFail('SURFACE_RESUME_COMMAND_REQUIRED', 'Resume command is required.')
      const now = Date.now()
      const checkpointId = controlText(params.checkpointId || params.checkpoint_id || params.checkpoint)
      const approvalPolicy = controlText(params.approvalPolicy || params.approval_policy)
      const approvalRecordId = controlText(params.approvalRecordId || params.approval_record_id)
      const environment = cleanSurfaceResumeEnvironment(params.environment)
      const binding: ControlSurfaceResumeBindingState = {
        ...(controlText(params.name) ? { name: controlText(params.name) } : {}),
        ...(controlText(params.kind) ? { kind: controlText(params.kind) } : {}),
        command,
        ...(controlText(params.cwd) || panel.cwd ? { cwd: controlText(params.cwd) || panel.cwd } : {}),
        ...(checkpointId ? { checkpointId, checkpoint_id: checkpointId } : {}),
        ...(controlText(params.source) ? { source: controlText(params.source) } : {}),
        ...(environment ? { environment } : {}),
        autoResume: controlBool(params.autoResume ?? params.auto_resume, false),
        ...(approvalPolicy ? { approvalPolicy, approval_policy: approvalPolicy } : {}),
        ...(approvalRecordId ? { approvalRecordId, approval_record_id: approvalRecordId } : {}),
        ...(typeof params.trustedAt === 'number' ? { trustedAt: params.trustedAt, trusted_at: params.trustedAt } : {}),
        ...(controlText(params.trustReason || params.trust_reason)
          ? { trustReason: controlText(params.trustReason || params.trust_reason), trust_reason: controlText(params.trustReason || params.trust_reason) }
          : {}),
        updatedAt: now,
        updated_at: now
      }
      controlSurfaceResumeBindings.value = { ...controlSurfaceResumeBindings.value, [panel.id]: binding }
      return controlOk(surfaceResumePayload(panel))
    }
    if (method === 'surface.resume.get' || method === 'surface.resume.show') {
      return controlOk(surfaceResumePayload(panel))
    }
    if (method === 'surface.resume.clear') {
      const existing = controlSurfaceResumeBindings.value[panel.id]
      if (!existing) return controlOk(surfaceResumePayload(panel, false))
      const expectedCheckpoint = controlText(params.checkpointId || params.checkpoint_id || params.checkpoint)
      const expectedSource = controlText(params.source)
      if (expectedCheckpoint && existing.checkpointId !== expectedCheckpoint && existing.checkpoint_id !== expectedCheckpoint) {
        return controlFail('SURFACE_RESUME_CHECKPOINT_MISMATCH', 'Resume binding checkpoint does not match.', {
          resumeBinding: surfaceResumeBindingPayload(existing),
          resume_binding: surfaceResumeBindingPayload(existing)
        })
      }
      if (expectedSource && existing.source !== expectedSource) {
        return controlFail('SURFACE_RESUME_SOURCE_MISMATCH', 'Resume binding source does not match.', {
          resumeBinding: surfaceResumeBindingPayload(existing),
          resume_binding: surfaceResumeBindingPayload(existing)
        })
      }
      const next = { ...controlSurfaceResumeBindings.value }
      delete next[panel.id]
      controlSurfaceResumeBindings.value = next
      return controlOk(surfaceResumePayload(panel, true))
    }
    if (method === 'surface.resume.trust' || method === 'surface.resume.approve') {
      const existing = controlSurfaceResumeBindings.value[panel.id]
      if (!existing?.command.trim()) return controlFail('SURFACE_RESUME_BINDING_NOT_FOUND', 'Surface has no resume binding.')
      const policy = controlText(params.policy || params.approvalPolicy || params.approval_policy || 'auto').toLowerCase()
      if (policy !== 'auto' && policy !== 'manual') return controlFail('SURFACE_RESUME_POLICY_INVALID', 'Resume trust policy must be auto or manual.')
      const now = Date.now()
      const trusted: ControlSurfaceResumeBindingState = {
        ...existing,
        autoResume: policy === 'auto',
        auto_resume: policy === 'auto',
        approvalPolicy: policy,
        approval_policy: policy,
        approvalRecordId: policy === 'auto' ? surfaceResumeTrustId(panel, existing) : undefined,
        approval_record_id: policy === 'auto' ? surfaceResumeTrustId(panel, existing) : undefined,
        trustedAt: now,
        trusted_at: now,
        trustReason: controlText(params.reason || params.trustReason || params.trust_reason) || 'manual-trust',
        trust_reason: controlText(params.reason || params.trustReason || params.trust_reason) || 'manual-trust',
        updatedAt: now,
        updated_at: now
      }
      controlSurfaceResumeBindings.value = { ...controlSurfaceResumeBindings.value, [panel.id]: trusted }
      return controlOk(surfaceResumePayload(panel))
    }
    if (method === 'surface.resume.preview' || method === 'surface.resume.autorun.preview') {
      return controlOk(surfaceResumeAutoPayload(surfaceResumePreviewItems(params)))
    }
    if (method === 'surface.resume.autorun' || method === 'surface.resume.run_auto') {
      const items = surfaceResumePreviewItems(params)
      const ready = items.filter((item) => item.ready && item.binding?.command.trim())
      if (!ready.length) return controlOk({ ...surfaceResumeAutoPayload(items), ranCount: 0, decisions: [] })
      const decisions: Array<Record<string, unknown>> = []
      for (const item of ready) {
        const decision = await workspace.runTerminalCommand(item.panel.id, item.binding!.command, { source: 'agent', writeToShell: true })
        decisions.push({
          panelId: item.panel.id,
          sessionId: item.panel.sessionId,
          status: decision.status,
          decision
        })
      }
      return controlOk({ ...surfaceResumeAutoPayload(items), ranCount: decisions.length, decisions })
    }
    if (method === 'surface.resume.run') {
      if (!isTerminalWorkspacePanel(panel)) return controlFail('SURFACE_RESUME_TERMINAL_REQUIRED', 'Resume command can only run in a terminal surface.')
      const binding = controlSurfaceResumeBindings.value[panel.id]
      if (!binding?.command.trim()) return controlFail('SURFACE_RESUME_BINDING_NOT_FOUND', 'Surface has no resume binding.')
      const decision = await workspace.runTerminalCommand(panel.id, binding.command, { source: 'agent', writeToShell: true })
      return controlOk({ ...surfaceResumePayload(panel), decision })
    }
    return controlFail('UNKNOWN_CONTROL_RENDERER_METHOD', `Unknown renderer control method: ${method}`)
  }

  const handleSurfaceRespawnControlRequest = async (params: Record<string, unknown>): Promise<ControlResponse> => {
    const panel = resolveControlSurfacePanel(params)
    if (!panel) return controlFail('SURFACE_NOT_FOUND', 'Surface not found.')
    if (!isTerminalWorkspacePanel(panel)) return controlFail('SURFACE_RESPAWN_TERMINAL_REQUIRED', 'Respawn command can only run in a terminal surface.')
    const command = controlText(params.command || params.tmux_start_command || params.shell || params.shellCommand) || 'exec ${SHELL:-/bin/bash} -l'
    const decision = await workspace.runTerminalCommand(panel.id, command, { source: 'agent', writeToShell: true })
    return controlOk({
      surface: surfaceSummaryForControl(panel),
      terminal: terminalSummaryForControl(panel),
      surfaceId: panel.id,
      surface_id: panel.id,
      command,
      decision,
      snapshot: workspaceSnapshotForControl()
    })
  }

  return {
    handleSurfaceResumeControlRequest,
    handleSurfaceRespawnControlRequest
  }
}
