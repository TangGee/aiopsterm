import type { CodexSessionTargetContext } from '@shared/contracts/codexSessions'

export type CodexTargetEventKind = 'bound' | 'changed' | 'unbound'

export const codexTargetSignature = (target: CodexSessionTargetContext) =>
  [
    target.panelId || '',
    target.sessionId || '',
    target.kind || '',
    target.label || '',
    target.host || '',
    target.port || '',
    target.username || '',
    target.assetId || '',
    target.assetName || '',
    target.cwd || ''
  ].join('\u001f')

export const formatCodexTargetEvent = (kind: CodexTargetEventKind, target?: CodexSessionTargetContext | null) => {
  if (kind === 'unbound') {
    return '\n[aiopsterm target unbound]\nThis AI session no longer has a managed terminal bound. Do not run host tools until the user binds a terminal again.\n'
  }
  const currentLabel = target?.label || target?.assetName || target?.host || target?.sessionId || 'unknown'
  return [
    '',
    kind === 'changed' ? '[aiopsterm target changed]' : '[aiopsterm target bound]',
    `Current target: ${currentLabel}`,
    target?.host ? `Endpoint: ${target.username ? `${target.username}@` : ''}${target.host}${target.port ? `:${target.port}` : ''}` : '',
    target?.cwd ? `CWD: ${target.cwd}` : '',
    'Before host-specific actions, call target_context and verify hostname/whoami/pwd.',
    ''
  ]
    .filter((line) => line !== '')
    .join('\n')
}
