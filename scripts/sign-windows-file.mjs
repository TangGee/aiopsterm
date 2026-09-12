import { open, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout } from 'node:timers/promises'
import { run } from './local-signing-common.mjs'

export const retryTimestampSigning = async (sign, wait = setTimeout) => {
  for (let attempt = 1; ; attempt++) {
    try { return await sign() }
    catch (error) {
      const diagnostic = `${error.stdout || ''}\n${error.stderr || ''}`
      if (attempt >= 3 || !/specified timestamp server either could not be reached|timestamp server.*returned an invalid response/i.test(diagnostic)) throw error
      console.log(`Timestamp service unavailable; retrying signing (${attempt}/2).`)
      await wait(attempt * 1000)
    }
  }
}

export const isWindowsSigningTarget = async (file) => {
  const handle = await open(file, 'r')
  try {
    const header = Buffer.alloc(4)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (bytesRead >= 2 && header.subarray(0, 2).toString('ascii') === 'MZ') return true
    // Native dependencies may ship other platforms' prebuilds beside PE files.
    // Preserve those bytes; SignTool only understands Windows executables.
    const foreign = ['7f454c46', 'feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']
    if (bytesRead === 4 && extname(file).toLowerCase() === '.node' && foreign.includes(header.toString('hex'))) return false
    throw new Error(`Unrecognized Windows signing target: ${file}`)
  } finally { await handle.close() }
}

export const findSignTool = async () => {
  if (process.env.AIOPSTERM_SIGNTOOL) return process.env.AIOPSTERM_SIGNTOOL
  const root = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin')
  const versions = (await readdir(root)).filter((name) => /^10\.[0-9.]+$/.test(name)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
  if (!versions.length) throw new Error('Install the Windows SDK SignTool or set AIOPSTERM_SIGNTOOL.')
  return join(root, versions[0], process.arch === 'arm64' ? 'arm64' : 'x64', 'signtool.exe')
}
export const signWindowsFile = async (file, { identity, tool, timestamp = 'http://timestamp.digicert.com' }) => {
  if (!/^[a-f0-9]{40}$/i.test(identity || '')) throw new Error('Windows signing requires a certificate SHA-1 thumbprint.')
  const result = await retryTimestampSigning(() => promisify(execFile)(tool, ['sign', '/sha1', identity, '/fd', 'SHA256', '/tr', timestamp, '/td', 'SHA256', file], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 }))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  await verifyWindowsFile(file, { identity, tool })
}
export const verifyWindowsFile = async (file, { identity, tool }) => {
  await run(tool, ['verify', '/pa', '/all', '/v', file])
  const script = '$ErrorActionPreference="Stop"; $s=Get-AuthenticodeSignature -LiteralPath $env:AIOPSTERM_VERIFY_FILE; if ($s.Status -ne "Valid" -or $s.SignerCertificate.Thumbprint -ne $env:AIOPSTERM_VERIFY_IDENTITY -or -not $s.TimeStamperCertificate) { throw "Unexpected publisher, invalid signature or missing timestamp" }'
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, AIOPSTERM_VERIFY_FILE: file, AIOPSTERM_VERIFY_IDENTITY: identity }
  })
}
