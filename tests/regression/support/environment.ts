import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'

export async function isolatedEnvironment(root: string): Promise<NodeJS.ProcessEnv> {
  const home = join(root, 'home')
  await mkdir(home, { recursive: true })
  const clean: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL']) {
    if (process.env[key]) clean[key] = process.env[key]
  }
  return { ...clean, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, '.config'),
    AIOPSTERM_TELEMETRY_ENDPOINT: 'http://127.0.0.1:0/regression-telemetry-disabled',
    APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'),
    CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude') }
}
