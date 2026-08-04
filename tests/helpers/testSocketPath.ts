import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const testSocketPath = (namespace: string, root = tmpdir()) => {
  const uniqueName = `${namespace}-${process.pid}-${randomUUID()}`
  return process.platform === 'win32' ? `\\\\.\\pipe\\${uniqueName}` : join(root, `${uniqueName}.sock`)
}

export const removeTestSocketPath = async (socketPath: string) => {
  if (process.platform === 'win32') return
  const { rm } = await import('node:fs/promises')
  await rm(socketPath, { force: true })
}
