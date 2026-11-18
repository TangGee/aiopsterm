import { readdir } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { join } from 'node:path'

export const defaultExecutablePath = () => {
  if (process.platform === 'win32') return 'dist/win-unpacked/aiopsterm.exe'
  if (process.platform === 'darwin') {
    return `dist/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/aiopsterm.app/Contents/MacOS/aiopsterm`
  }
  return 'dist/linux-unpacked/aiopsterm'
}

export const controlSocketPath = async (userDataDir: string, pid: number) => {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\aiopsterm-control-${pid}`
  }
  const controlDir = join(userDataDir, 'control')
  const entries = await readdir(controlDir)
  const socket = entries.find((entry) => entry.endsWith('.sock'))
  if (!socket) throw new Error(`Control socket was not created under ${controlDir}`)
  return join(controlDir, socket)
}

export const socketJsonRequest = <T extends Record<string, any> = Record<string, any>>(socketPath: string, request: Record<string, any>) =>
  new Promise<T>((resolveRequest, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(10_000)
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', (chunk) => {
      buffer += chunk
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return
      socket.end()
      try {
        resolveRequest(JSON.parse(buffer.slice(0, newlineIndex).trim()) as T)
      } catch (error) {
        reject(error)
      }
    })
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error(`socket request timed out: ${socketPath}`))
    })
    socket.on('error', reject)
  })

