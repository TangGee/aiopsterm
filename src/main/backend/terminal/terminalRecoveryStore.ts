import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TerminalRecoverySnapshot, TerminalRecoveryTab } from '@shared/contracts/terminalRecovery'

export const terminalRecoveryLimits = { tabs: 32, historyChars: 128 * 1024, fileBytes: 16 * 1024 * 1024 }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown, limit = 4096) => typeof value === 'string' ? value.slice(0, limit) : ''
const identifier = (value: unknown) => text(value, 256).replace(/[\x00-\x1f\x7f]/g, '')
const cwd = (value: unknown) => typeof value === 'string' && !/[\x00-\x1f\x7f-\x9f]/.test(value) ? text(value) : ''
// Snapshots are display text, never terminal input. Strip control sequences even
// when an untrusted renderer supplies raw data instead of a buffer snapshot.
export const recoveryHistoryText = (value: unknown) => text(value, terminalRecoveryLimits.historyChars * 2)
  .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
  .slice(-terminalRecoveryLimits.historyChars)

export const normalizeTerminalRecovery = (input: unknown): TerminalRecoverySnapshot => {
  const source = record(input)
  if (source.version !== 1 || !Array.isArray(source.tabs) || source.tabs.length > terminalRecoveryLimits.tabs) throw new Error('Invalid terminal recovery snapshot.')
  const ids = new Set<string>()
  const tabs = source.tabs.map((value): TerminalRecoveryTab => {
    const tab = record(value)
    const id = identifier(tab.id)
    if (!id || ids.has(id)) throw new Error('Invalid terminal recovery tab ID.')
    ids.add(id)
    const ssh = record(tab.ssh)
    const host = identifier(ssh.host)
    const username = identifier(ssh.username)
    if (tab.ssh && (!host || !username || !Number.isInteger(ssh.port) || Number(ssh.port) < 1 || Number(ssh.port) > 65535)) throw new Error('Invalid SSH recovery target.')
    return {
      id, title: identifier(tab.title), cwd: cwd(tab.cwd), history: recoveryHistoryText(tab.history), cwdVerified: tab.cwdVerified === true, resume: tab.resume === true,
      ...(identifier(tab.sessionId) ? { sessionId: identifier(tab.sessionId) } : {}),
      ...(tab.split === 'right' || tab.split === 'below' ? { split: tab.split } : {}),
      ...(identifier(tab.splitSourceId) ? { splitSourceId: identifier(tab.splitSourceId) } : {}),
      ...(identifier(tab.splitGroupId) ? { splitGroupId: identifier(tab.splitGroupId) } : {}),
      ...(typeof tab.splitOrder === 'number' && Number.isFinite(tab.splitOrder) ? { splitOrder: tab.splitOrder } : {}),
      ...(tab.ssh ? { ssh: {
        host, username, port: Number(ssh.port), assetName: identifier(ssh.assetName),
        ...(identifier(ssh.assetId) ? { assetId: identifier(ssh.assetId) } : {}),
        needProxy: ssh.needProxy === true,
        proxyName: identifier(ssh.proxyName),
        ...(identifier(ssh.jumpHostId) ? { jumpHostId: identifier(ssh.jumpHostId) } : {})
      } } : {})
    }
  })
  for (const tab of tabs) {
    if (tab.splitSourceId && !ids.has(tab.splitSourceId)) delete tab.splitSourceId
  }
  return { version: 1, activePanelId: ids.has(identifier(source.activePanelId)) ? identifier(source.activePanelId) : tabs[0]?.id || '', tabs }
}

export const createTerminalRecoveryStore = (getPath: () => string) => {
  let pending = Promise.resolve()
  const save = (input: unknown) => {
    const snapshot = normalizeTerminalRecovery(input)
    const payload = JSON.stringify(snapshot)
    if (Buffer.byteLength(payload) > terminalRecoveryLimits.fileBytes) return Promise.reject(new Error('Terminal recovery snapshot is too large.'))
    const operation = pending.catch(() => {}).then(async () => {
      const file = getPath()
      await mkdir(dirname(file), { recursive: true, mode: 0o700 })
      await writeFile(file + '.tmp', payload, { mode: 0o600 })
      await rename(file + '.tmp', file)
    })
    pending = operation
    return operation
  }
  const load = async (): Promise<TerminalRecoverySnapshot | null> => {
    await pending.catch(() => {})
    try {
      const file = getPath()
      if ((await stat(file)).size > terminalRecoveryLimits.fileBytes) return null
      return normalizeTerminalRecovery(JSON.parse(await readFile(file, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError || error instanceof Error && error.message.startsWith('Invalid')) return null
      throw error
    }
  }
  return { save, load }
}
