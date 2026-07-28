import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'

const backendMocks = vi.hoisted(() => ({
  prepareChatImageAttachment: vi.fn(),
  prepareChatImageAttachmentFromClipboard: vi.fn(),
  prepareChatImageAttachmentFromFile: vi.fn(),
  saveCustomBackgroundFile: vi.fn(),
  saveCustomNotificationSoundFile: vi.fn(),
  stageChatAttachment: vi.fn(),
  validateChatImageAttachment: vi.fn(),
  writeLocalTextFile: vi.fn()
}))

vi.mock('../src/main/backend/chat/chatAttachments', () => ({
  stageChatAttachment: backendMocks.stageChatAttachment
}))

vi.mock('../src/main/backend/chat/chatImageAttachment', () => ({
  prepareChatImageAttachment: backendMocks.prepareChatImageAttachment,
  prepareChatImageAttachmentFromClipboard: backendMocks.prepareChatImageAttachmentFromClipboard,
  prepareChatImageAttachmentFromFile: backendMocks.prepareChatImageAttachmentFromFile,
  validateChatImageAttachment: backendMocks.validateChatImageAttachment
}))

vi.mock('../src/main/backend/files/localFileWrites', () => ({
  saveCustomBackgroundFile: backendMocks.saveCustomBackgroundFile,
  saveCustomNotificationSoundFile: backendMocks.saveCustomNotificationSoundFile,
  writeLocalTextFile: backendMocks.writeLocalTextFile
}))

type IpcHandler = (event: unknown, ...args: any[]) => unknown

type LocalFilesIpcBackend = {
  registerLocalFilesIpc: (ipcMain: IpcMain, input: any) => void
}

const tempDirs: string[] = []

const loadBackend = async () => {
  const modulePath = '../src/main/ipc/localFiles'
  return (await import(modulePath)) as LocalFilesIpcBackend
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

const createRegistrationInput = (overrides: Record<string, unknown> = {}) => {
  const customBackgroundUrlForPath = vi.fn((filePath: string) => `aiopsterm-background://local/${encodeURIComponent(basename(filePath))}`)
  return {
    showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/tmp/from-open-dialog.md'] })),
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: '/tmp/from-save-dialog.md' })),
    shouldUseE2eDialogFixtures: vi.fn(() => false),
    getUserDataPath: vi.fn(() => '/tmp/aiopsterm-user-data'),
    getDownloadsPath: vi.fn(() => '/tmp/aiopsterm-downloads'),
    getChatAttachmentsPath: vi.fn(() => '/tmp/aiopsterm-user-data/chat-attachments'),
    getCustomBackgroundsPath: vi.fn(() => '/tmp/aiopsterm-user-data/backgrounds'),
    getCustomNotificationSoundsPath: vi.fn(() => '/tmp/aiopsterm-user-data/notification-sounds'),
    customBackgroundUrlForPath,
    writeFixtureFile: vi.fn(async () => undefined),
    ...overrides
  }
}

const createTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-local-files-ipc-'))
  tempDirs.push(dir)
  return dir
}

describe('local files IPC registrar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    backendMocks.saveCustomBackgroundFile.mockResolvedValue({
      filePath: '/tmp/aiopsterm-user-data/backgrounds/custom.png',
      url: 'aiopsterm-background://local/custom.png',
      name: 'custom.png',
      size: 4,
      bytes: 4,
      mtimeMs: 1780490000000
    })
    backendMocks.saveCustomNotificationSoundFile.mockResolvedValue({
      filePath: '/tmp/aiopsterm-user-data/notification-sounds/notify.wav',
      url: 'file:///tmp/aiopsterm-user-data/notification-sounds/notify.wav',
      name: 'notify.wav',
      size: 4,
      bytes: 4,
      mtimeMs: 1780490000000
    })
    backendMocks.writeLocalTextFile.mockResolvedValue({ ok: true, data: { filePath: '/tmp/query.sql', bytes: 9, size: 9, mtimeMs: 1780490000000 } })
    backendMocks.stageChatAttachment.mockResolvedValue({
      mode: 'local',
      taskId: 'task-1',
      srcAbsPath: '/tmp/incident.log',
      refPath: 'aiopsterm://chat-attachment/task-1/incident.log',
      name: 'incident.log',
      size: 12,
      stagedPath: '/tmp/aiopsterm-user-data/chat-attachments/task-1/incident.log'
    })
    backendMocks.validateChatImageAttachment.mockReturnValue({ ok: true, data: { mediaType: 'image/png', name: 'diagram.png', size: 4 } })
    backendMocks.prepareChatImageAttachment.mockReturnValue({ ok: true, data: { type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'diagram.png', size: 4 } })
    backendMocks.prepareChatImageAttachmentFromFile.mockResolvedValue({
      ok: true,
      data: { type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'diagram.png', size: 4 }
    })
    backendMocks.prepareChatImageAttachmentFromClipboard.mockReturnValue({
      ok: true,
      data: { type: 'image', mediaType: 'image/png', data: 'BBBB', name: 'clipboard.png', size: 4 }
    })
  })

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('registers stable dialog, local file, background, and chat attachment channels', async () => {
    const { registerLocalFilesIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()

    registerLocalFilesIpc(ipcMain, createRegistrationInput())

    expect([...handlers.keys()]).toEqual([
      'dialog:open-file',
      'dialog:save-file',
      'settings:save-custom-background',
      'settings:save-custom-notification-sound',
      'files:read-local',
      'files:write-local',
      'local-editor-files:read',
      'local-editor-files:write',
      'local-editor-files:watch:start',
      'local-editor-files:watch:stop',
      'chat:stage-attachment',
      'chat:validate-image-attachment',
      'chat:prepare-image-attachment',
      'chat:prepare-image-attachment-from-file',
      'chat:prepare-image-attachment-from-clipboard'
    ])
  })

  it('serves E2E open-dialog fixtures without calling the native dialog adapter', async () => {
    const { registerLocalFilesIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput({ shouldUseE2eDialogFixtures: vi.fn(() => true) })

    registerLocalFilesIpc(ipcMain, input)

    const assetResult = await handlers.get('dialog:open-file')?.({}, {
      properties: ['openFile'],
      filters: [{ name: 'Asset Import Files', extensions: ['json'] }]
    })
    expect(assetResult).toEqual({ canceled: false, filePaths: ['/tmp/aiopsterm-user-data/e2e-external-reference-assets.json'] })
    expect(input.writeFixtureFile).toHaveBeenLastCalledWith(
      '/tmp/aiopsterm-user-data/e2e-external-reference-assets.json',
      expect.stringContaining('e2e-imported-json'),
      'utf-8'
    )

    const imageResult = await handlers.get('dialog:open-file')?.({}, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png'] }]
    })
    expect(imageResult).toEqual({ canceled: false, filePaths: ['/tmp/aiopsterm-user-data/e2e-background.png'] })
    expect(input.writeFixtureFile).toHaveBeenLastCalledWith('/tmp/aiopsterm-user-data/e2e-background.png', expect.any(Buffer))

    const yamlResult = await handlers.get('dialog:open-file')?.({}, {
      properties: ['openFile'],
      filters: [{ name: 'YAML Files', extensions: ['yaml'] }]
    })
    expect(yamlResult).toEqual({ canceled: false, filePaths: ['/tmp/aiopsterm-user-data/e2e-kubeconfig.yaml'] })
    expect(input.writeFixtureFile).toHaveBeenLastCalledWith(
      '/tmp/aiopsterm-user-data/e2e-kubeconfig.yaml',
      expect.stringContaining('current-context: e2e/admin'),
      'utf-8'
    )

    const directoryResult = await handlers.get('dialog:open-file')?.({}, { properties: ['openDirectory'] })
    expect(directoryResult).toEqual({ canceled: false, filePaths: ['/tmp/aiopsterm-user-data/e2e-imported-note.md'] })
    expect(input.showOpenDialog).not.toHaveBeenCalled()
  })

  it('passes invoke events to native dialog adapters and keeps save-file fixtures deterministic', async () => {
    const { registerLocalFilesIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const event = { sender: { id: 12 } }
    const input = createRegistrationInput()

    registerLocalFilesIpc(ipcMain, input)

    const openOptions = { properties: ['openFile'], filters: [{ name: 'Text', extensions: ['md'] }] }
    await expect(handlers.get('dialog:open-file')?.(event, openOptions)).resolves.toEqual({ canceled: false, filePaths: ['/tmp/from-open-dialog.md'] })
    expect(input.showOpenDialog).toHaveBeenCalledWith(event, openOptions)

    const saveOptions = { defaultPath: '/tmp/reports/query.sql', filters: [{ name: 'SQL', extensions: ['sql'] }] }
    await expect(handlers.get('dialog:save-file')?.(event, saveOptions)).resolves.toEqual({ canceled: false, filePath: '/tmp/from-save-dialog.md' })
    expect(input.showSaveDialog).toHaveBeenCalledWith(event, saveOptions)

    const fixtureInput = createRegistrationInput({ shouldUseE2eDialogFixtures: vi.fn(() => true) })
    const fixtureHarness = createIpcHarness()
    registerLocalFilesIpc(fixtureHarness.ipcMain, fixtureInput)
    await expect(fixtureHarness.handlers.get('dialog:save-file')?.(event, saveOptions)).resolves.toEqual({
      canceled: false,
      filePath: '/tmp/aiopsterm-downloads/query.sql'
    })
    expect(fixtureInput.showSaveDialog).not.toHaveBeenCalled()
  })

  it('reads absolute local text files with size and mtime metadata', async () => {
    const { registerLocalFilesIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const dir = await createTempDir()
    const filePath = join(dir, 'incident.md')
    const content = '# Incident\n\nPod restarted.\n'
    await writeFile(filePath, content, 'utf-8')

    registerLocalFilesIpc(ipcMain, createRegistrationInput())

    await expect(handlers.get('files:read-local')?.({}, filePath)).resolves.toEqual({
      content,
      mtimeMs: expect.any(Number),
      size: Buffer.byteLength(content, 'utf-8')
    })
    await expect(handlers.get('files:read-local')?.({}, 'relative.md')).rejects.toThrow('filePath must be absolute')
  })

  it('forwards background writes, local writes, and chat attachment requests to backend boundaries', async () => {
    const { registerLocalFilesIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput()

    registerLocalFilesIpc(ipcMain, input)

    await expect(handlers.get('settings:save-custom-background')?.({}, '/tmp/source/custom.png')).resolves.toMatchObject({
      filePath: '/tmp/aiopsterm-user-data/backgrounds/custom.png'
    })
    expect(backendMocks.saveCustomBackgroundFile).toHaveBeenCalledWith('/tmp/source/custom.png', {
      backgroundDir: '/tmp/aiopsterm-user-data/backgrounds',
      maxBytes: 20 * 1024 * 1024,
      allowedExtensions: new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']),
      toUrl: input.customBackgroundUrlForPath
    })

    await expect(handlers.get('settings:save-custom-notification-sound')?.({}, '/tmp/source/notify.wav')).resolves.toMatchObject({
      filePath: '/tmp/aiopsterm-user-data/notification-sounds/notify.wav'
    })
    expect(backendMocks.saveCustomNotificationSoundFile).toHaveBeenCalledWith('/tmp/source/notify.wav', {
      soundDir: '/tmp/aiopsterm-user-data/notification-sounds',
      maxBytes: 10 * 1024 * 1024,
      allowedExtensions: new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm'])
    })

    await expect(handlers.get('files:write-local')?.({}, '/tmp/query.sql', 'select 1;\n')).resolves.toMatchObject({ ok: true })
    expect(backendMocks.writeLocalTextFile).toHaveBeenCalledWith('/tmp/query.sql', 'select 1;\n')

    const attachmentPayload = { taskId: 'task-1', srcAbsPath: '/tmp/incident.log' }
    await expect(handlers.get('chat:stage-attachment')?.({}, attachmentPayload)).resolves.toMatchObject({ refPath: 'aiopsterm://chat-attachment/task-1/incident.log' })
    expect(backendMocks.stageChatAttachment).toHaveBeenCalledWith(attachmentPayload, '/tmp/aiopsterm-user-data/chat-attachments')

    expect(handlers.get('chat:validate-image-attachment')?.({}, { mediaType: 'image/png', name: 'diagram.png', size: 4 })).toMatchObject({ ok: true })
    expect(backendMocks.validateChatImageAttachment).toHaveBeenCalledWith({ mediaType: 'image/png', name: 'diagram.png', size: 4 })

    expect(handlers.get('chat:prepare-image-attachment')?.({}, { mediaType: 'image/png', data: 'AAAA', name: 'diagram.png', size: 4 })).toMatchObject({
      ok: true
    })
    expect(backendMocks.prepareChatImageAttachment).toHaveBeenCalledWith({ mediaType: 'image/png', data: 'AAAA', name: 'diagram.png', size: 4 })

    await expect(handlers.get('chat:prepare-image-attachment-from-file')?.({}, { filePath: '/tmp/diagram.png' })).resolves.toMatchObject({ ok: true })
    expect(backendMocks.prepareChatImageAttachmentFromFile).toHaveBeenCalledWith({ filePath: '/tmp/diagram.png' })

    expect(handlers.get('chat:prepare-image-attachment-from-clipboard')?.({}, { name: 'clipboard.png' })).toMatchObject({ ok: true })
    expect(backendMocks.prepareChatImageAttachmentFromClipboard).toHaveBeenCalledWith({ name: 'clipboard.png' })
  })
})
