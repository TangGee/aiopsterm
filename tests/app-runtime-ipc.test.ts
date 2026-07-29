import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import type { UserConfig } from '@shared/contracts/userConfig'

const backendMocks = vi.hoisted(() => ({
  applyKnowledgeSearchRuntimeSetting: vi.fn(),
  applyPrivacyRuntimeSettings: vi.fn(),
  openSettingsDocumentation: vi.fn(),
  submitSettingsFeedbackReport: vi.fn(),
  writeRuntimeLog: vi.fn()
}))

vi.mock('../src/main/backend/knowledge/knowledgeSearchRuntime', () => ({
  applyKnowledgeSearchRuntimeSetting: backendMocks.applyKnowledgeSearchRuntimeSetting
}))

vi.mock('../src/main/backend/app/privacyRuntime', () => ({
  applyPrivacyRuntimeSettings: backendMocks.applyPrivacyRuntimeSettings
}))

vi.mock('../src/main/backend/app/runtimeLog', () => ({
  writeRuntimeLog: backendMocks.writeRuntimeLog
}))

vi.mock('../src/main/backend/settings/settingsExternalActions', () => ({
  openSettingsDocumentation: backendMocks.openSettingsDocumentation,
  submitSettingsFeedbackReport: backendMocks.submitSettingsFeedbackReport
}))

type IpcHandler = (event: unknown, ...args: any[]) => unknown

type AppRuntimeIpcBackend = {
  registerAppRuntimeIpc: (ipcMain: IpcMain, input: any) => void
}

const loadBackend = async () => {
  const modulePath = '../src/main/ipc/appRuntime'
  return (await import(modulePath)) as AppRuntimeIpcBackend
}

const createIpcHarness = () => {
  const handlers = new Map<string, IpcHandler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    })
  } as unknown as IpcMain
  return { ipcMain, handlers }
}

const runtime = { userDataPath: '/tmp/aiopsterm', version: '0.1.0', platform: 'linux', arch: 'x64', openPath: vi.fn() }

const createRegistrationInput = () => {
  let config: UserConfig = { theme: 'dark' } as UserConfig
  return {
    getPlatform: vi.fn(() => 'linux'),
    getDefaultShell: vi.fn(() => '/bin/bash'),
    getGpuFeatureStatus: vi.fn(() => ({ webgl: 'enabled', webgl2: 'enabled' })),
    handleProtocolUrl: vi.fn((rawUrl: string) => ({ success: true, url: rawUrl })),
    consumeDeepLinks: vi.fn(() => [{ url: 'aiopsterm://open/files', action: 'open' as const, target: 'files' as const, module: 'files' as const, acceptedAt: 1780490000000 }]),
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ''),
    getLogDirPath: vi.fn(() => '/tmp/aiopsterm/logs'),
    createSettingsExternalActionRuntime: vi.fn(() => runtime),
    getConfig: vi.fn(() => config),
    saveConfigPatch: vi.fn((patch: Partial<UserConfig>) => {
      config = { ...config, ...patch }
      return config
    }),
    shouldSkipOpenPath: vi.fn(() => false),
    mkdir: vi.fn(async () => undefined)
  }
}

describe('app runtime IPC registrar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    backendMocks.openSettingsDocumentation.mockResolvedValue({ path: '/docs/index.md', title: 'Docs', content: '# Docs' })
    backendMocks.submitSettingsFeedbackReport.mockResolvedValue({ path: '/tmp/aiopsterm/feedback/report.md' })
    backendMocks.writeRuntimeLog.mockResolvedValue(undefined)
    backendMocks.applyPrivacyRuntimeSettings.mockReturnValue({ ok: true, data: { telemetry: 'disabled' } })
    backendMocks.applyKnowledgeSearchRuntimeSetting.mockReturnValue({ ok: true, data: { enabled: true } })
  })

  it('registers app shell, protocol, config, and runtime channels with injected dependencies', async () => {
    const { registerAppRuntimeIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput()

    registerAppRuntimeIpc(ipcMain, input)

    expect([...handlers.keys()]).toEqual([
      'app:platform',
      'app:shell',
      'app:gpu-feature-status',
      'app:get-protocol-prefix',
      'app:handle-protocol-url',
      'app:consume-deep-links',
      'app:open-external-url',
      'settings:open-documentation',
      'settings:submit-feedback-report',
      'app:open-log-dir',
      'app:runtime-log',
      'config:get',
      'config:save',
      'privacy:runtime:apply',
      'knowledge-search:runtime:apply'
    ])
    expect(await handlers.get('app:platform')?.({})).toBe('linux')
    expect(await handlers.get('app:shell')?.({})).toBe('/bin/bash')
    expect(await handlers.get('app:gpu-feature-status')?.({})).toEqual({ webgl: 'enabled', webgl2: 'enabled' })
    expect(await handlers.get('app:get-protocol-prefix')?.({})).toBe('aiopsterm://')
    expect(await handlers.get('app:handle-protocol-url')?.({}, 'aiopsterm://open/settings?section=mcp')).toEqual({
      success: true,
      url: 'aiopsterm://open/settings?section=mcp'
    })
    expect(await handlers.get('app:consume-deep-links')?.({})).toEqual([
      { url: 'aiopsterm://open/files', action: 'open', target: 'files', module: 'files', acceptedAt: 1780490000000 }
    ])

    expect(await handlers.get('config:get')?.({})).toEqual({ theme: 'dark' })
    expect(await handlers.get('config:save')?.({}, { theme: 'light' })).toEqual({ theme: 'light' })
    expect(input.saveConfigPatch).toHaveBeenCalledWith({ theme: 'light' })
  })

  it('normalizes external actions and rejects non-http external URLs', async () => {
    const { registerAppRuntimeIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput()

    registerAppRuntimeIpc(ipcMain, input)

    await handlers.get('app:open-external-url')?.({}, 'https://example.com/docs')
    await expect(handlers.get('app:open-external-url')?.({}, 'file:///etc/passwd')).rejects.toThrow('Only http and https URLs can be opened')
    expect(input.openExternal).toHaveBeenCalledWith('https://example.com/docs')
    expect(input.openExternal).toHaveBeenCalledTimes(1)

    await handlers.get('settings:open-documentation')?.({}, { page: 'general', locale: 'zh-CN', documentPath: 'usage/index.md', basePath: '/docs/index.md' })
    expect(backendMocks.openSettingsDocumentation).toHaveBeenCalledWith(runtime, {
      page: 'general',
      locale: 'zh-CN',
      documentPath: 'usage/index.md',
      basePath: '/docs/index.md'
    })

    backendMocks.openSettingsDocumentation.mockClear()
    await handlers.get('settings:open-documentation')?.({}, { page: 'aiRemoteHostManagement', locale: 'en-US' })
    expect(backendMocks.openSettingsDocumentation).toHaveBeenCalledWith(runtime, {
      page: 'aiRemoteHostManagement',
      locale: 'en-US'
    })

    backendMocks.openSettingsDocumentation.mockClear()
    await handlers.get('settings:open-documentation')?.({}, { page: 'commandSecurity', locale: 'zh-CN' })
    expect(backendMocks.openSettingsDocumentation).toHaveBeenCalledWith(runtime, {
      page: 'commandSecurity',
      locale: 'zh-CN'
    })

    backendMocks.openSettingsDocumentation.mockClear()
    await handlers.get('settings:open-documentation')?.({}, { page: '../general', locale: 1, documentPath: 2, basePath: null })
    expect(backendMocks.openSettingsDocumentation).toHaveBeenCalledWith(runtime, {})

    await handlers.get('settings:submit-feedback-report')?.({})
    expect(backendMocks.submitSettingsFeedbackReport).toHaveBeenCalledWith(runtime)
  })

  it('opens the log directory through injected filesystem and opener adapters', async () => {
    const { registerAppRuntimeIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput()

    registerAppRuntimeIpc(ipcMain, input)

    expect(await handlers.get('app:open-log-dir')?.({})).toEqual({ path: '/tmp/aiopsterm/logs' })
    expect(input.mkdir).toHaveBeenCalledWith('/tmp/aiopsterm/logs', { recursive: true })
    expect(input.openPath).toHaveBeenCalledWith('/tmp/aiopsterm/logs')

    input.openPath.mockResolvedValueOnce('cannot open')
    await expect(handlers.get('app:open-log-dir')?.({})).rejects.toThrow('cannot open')

    input.shouldSkipOpenPath.mockReturnValueOnce(true)
    expect(await handlers.get('app:open-log-dir')?.({})).toEqual({ path: '/tmp/aiopsterm/logs' })
    expect(input.openPath).toHaveBeenCalledTimes(2)
  })

  it('forwards sanitized runtime settings and renderer log inputs to backend boundaries', async () => {
    const { registerAppRuntimeIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput()

    registerAppRuntimeIpc(ipcMain, input)

    expect(await handlers.get('app:runtime-log')?.({}, 'verbose', '  renderer.button.click  ', ['ignored'])).toEqual({
      ok: true,
      data: { event: 'renderer.button.click' }
    })
    expect(backendMocks.writeRuntimeLog).toHaveBeenCalledWith('info', 'renderer.button.click', {})

    expect(await handlers.get('privacy:runtime:apply')?.({}, { nextPrivacy: { telemetry: 'disabled' } })).toEqual({
      ok: true,
      data: { telemetry: 'disabled' }
    })
    expect(backendMocks.applyPrivacyRuntimeSettings).toHaveBeenCalledWith({ nextPrivacy: { telemetry: 'disabled' } })

    expect(await handlers.get('knowledge-search:runtime:apply')?.({}, { nextEnabled: true })).toEqual({
      ok: true,
      data: { enabled: true }
    })
    expect(backendMocks.applyKnowledgeSearchRuntimeSetting).toHaveBeenCalledWith({ nextEnabled: true })
  })
})
