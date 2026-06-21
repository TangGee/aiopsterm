import { BrowserWindow, app, net, protocol, shell } from 'electron'
import { existsSync } from 'fs'
import { stat } from 'fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'path'
import { pathToFileURL } from 'url'
import {
  aiopstermProtocolPrefix,
  aiopstermProtocolScheme,
  parseAiopstermDeepLink,
  type AiopstermDeepLinkPayload
} from '@shared/deepLink'
import { normalizeExternalHttpUrl } from '@shared/externalUrl'
import { sendWindowEvent } from '@shared/windowEvents'

type AppBootstrapRuntimeInput = {
  getMainWindow: () => BrowserWindow | null
  setMainWindow: (window: BrowserWindow | null) => void
  resolveUserAvatarAssetPath: (url: string) => string
  getCustomBackgroundsPath: () => string
  preloadPath: string
  rendererUrl?: string
  rendererIndexPath: string
}

const userAvatarProtocolScheme = 'aiopsterm-user-avatar'
const backgroundProtocolScheme = 'aiopsterm-background'

protocol.registerSchemesAsPrivileged([
  {
    scheme: userAvatarProtocolScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  },
  {
    scheme: backgroundProtocolScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
])

export const findDeepLinkArg = (argv: string[]) => argv.find((arg) => typeof arg === 'string' && arg.startsWith(aiopstermProtocolPrefix))

const resolveAppIconPath = () => {
  if (process.platform === 'darwin') return ''
  const candidates = [
    join(process.resourcesPath || '', 'icons', '256x256.png'),
    join(process.resourcesPath || '', 'resources', 'icons', '256x256.png'),
    join(__dirname, '../../resources/icons/256x256.png'),
    resolve('resources/icons/256x256.png')
  ]
  return candidates.find((candidate) => candidate && existsSync(candidate)) || ''
}

export const createAppBootstrapRuntime = (input: AppBootstrapRuntimeInput) => {
  const pendingDeepLinks: AiopstermDeepLinkPayload[] = []

  const focusWindow = (targetWindow = input.getMainWindow() || BrowserWindow.getAllWindows()[0]) => {
    if (!targetWindow || targetWindow.isDestroyed()) return null
    if (targetWindow.isMinimized()) targetWindow.restore()
    targetWindow.focus()
    return targetWindow
  }

  const dispatchDeepLinkToRenderer = (payload: AiopstermDeepLinkPayload) => {
    const targetWindow = focusWindow()
    if (!targetWindow) return false
    sendWindowEvent(targetWindow, 'app:deep-link', payload)
    return true
  }

  const handleDeepLinkUrl = (rawUrl: string) => {
    const parsed = parseAiopstermDeepLink(rawUrl)
    if (!parsed.valid) {
      return { success: false, reason: parsed.reason }
    }

    const payload = {
      ...parsed.payload,
      acceptedAt: Date.now()
    }
    pendingDeepLinks.push(payload)
    dispatchDeepLinkToRenderer(payload)
    return { success: true, payload }
  }

  const consumeDeepLinks = () => {
    const queue = [...pendingDeepLinks]
    pendingDeepLinks.length = 0
    return queue
  }

  const registerDeepLinkProtocol = () => {
    if (!app.isDefaultProtocolClient(aiopstermProtocolScheme)) {
      app.setAsDefaultProtocolClient(aiopstermProtocolScheme)
    }
  }

  const registerUserAvatarProtocol = () => {
    protocol.handle(userAvatarProtocolScheme, async (request) => {
      const assetPath = input.resolveUserAvatarAssetPath(request.url)
      if (!assetPath) return new Response('Avatar not found', { status: 404 })
      try {
        const metadata = await stat(assetPath)
        if (!metadata.isFile()) return new Response('Avatar not found', { status: 404 })
        return net.fetch(pathToFileURL(assetPath).href)
      } catch {
        return new Response('Avatar not found', { status: 404 })
      }
    })
  }

  const customBackgroundUrlForPath = (filePath: string) => `${backgroundProtocolScheme}://local/${encodeURIComponent(basename(filePath))}`

  const resolveCustomBackgroundAssetPath = (rawUrl: string) => {
    try {
      const parsed = new URL(rawUrl)
      if (parsed.protocol !== `${backgroundProtocolScheme}:` || parsed.hostname !== 'local') return ''
      const fileName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
      if (!fileName || fileName !== basename(fileName)) return ''
      const backgroundRoot = resolve(input.getCustomBackgroundsPath())
      const assetPath = resolve(backgroundRoot, fileName)
      const rel = relative(backgroundRoot, assetPath)
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) return ''
      return assetPath
    } catch {
      return ''
    }
  }

  const registerCustomBackgroundProtocol = () => {
    protocol.handle(backgroundProtocolScheme, async (request) => {
      const assetPath = resolveCustomBackgroundAssetPath(request.url)
      if (!assetPath) return new Response('Background not found', { status: 404 })
      try {
        const metadata = await stat(assetPath)
        if (!metadata.isFile()) return new Response('Background not found', { status: 404 })
        return net.fetch(pathToFileURL(assetPath).href)
      } catch {
        return new Response('Background not found', { status: 404 })
      }
    })
  }

  const createWindow = () => {
    const appIcon = resolveAppIconPath()
    const mainWindow = new BrowserWindow({
      width: 1344,
      height: 756,
      minWidth: 1024,
      minHeight: 680,
      title: 'aiopsterm',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      backgroundColor: '#0f1117',
      ...(appIcon ? { icon: appIcon } : {}),
      webPreferences: {
        preload: input.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    input.setMainWindow(mainWindow)

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      const normalized = normalizeExternalHttpUrl(url)
      if (normalized.valid) void shell.openExternal(normalized.url)
      return { action: 'deny' }
    })

    if (!app.isPackaged && input.rendererUrl) {
      mainWindow.loadURL(input.rendererUrl)
    } else {
      mainWindow.loadFile(input.rendererIndexPath)
    }

    mainWindow.on('maximize', () => {
      sendWindowEvent(mainWindow, 'window:maximized')
    })
    mainWindow.on('unmaximize', () => {
      sendWindowEvent(mainWindow, 'window:unmaximized')
    })

    return mainWindow
  }

  const registerSingleInstanceDeepLinkHandling = () => {
    const gotSingleInstanceLock = app.requestSingleInstanceLock()
    registerDeepLinkProtocol()
    if (!gotSingleInstanceLock) {
      const deepLinkArg = findDeepLinkArg(process.argv)
      if (deepLinkArg) handleDeepLinkUrl(deepLinkArg)
      app.quit()
      return false
    }
    app.on('second-instance', (_event, commandLine) => {
      focusWindow()
      const deepLinkArg = findDeepLinkArg(commandLine)
      if (deepLinkArg) handleDeepLinkUrl(deepLinkArg)
    })
    return true
  }

  const registerOpenUrlDeepLinkHandling = () => {
    app.on('open-url', (event, url) => {
      if (!url.startsWith(aiopstermProtocolPrefix)) return
      event.preventDefault()
      handleDeepLinkUrl(url)
    })
  }

  const registerAssetProtocols = () => {
    registerUserAvatarProtocol()
    registerCustomBackgroundProtocol()
  }

  const handleStartupDeepLink = () => {
    const deepLinkArg = findDeepLinkArg(process.argv)
    if (deepLinkArg) handleDeepLinkUrl(deepLinkArg)
  }

  return {
    focusWindow,
    handleDeepLinkUrl,
    consumeDeepLinks,
    customBackgroundUrlForPath,
    createWindow,
    registerSingleInstanceDeepLinkHandling,
    registerOpenUrlDeepLinkHandling,
    registerAssetProtocols,
    handleStartupDeepLink
  }
}
