import { type Ref } from 'vue'
import {
  appRuntimeClient,
  appUpdateStatusMessage,
  hasAvailableAppUpdate,
  isAppUpdateCheckResult,
  isAppUpdateDownloadData,
  isAppUpdateInstallData,
  isAppUpdateProgressEvent,
  resolveUpdateVersion
} from '@/services/app/appRuntimeClient'
import type { AppUpdateProgressEvent } from '@shared/contracts/appRuntime'

type WorkspaceTopUpdateState = 'idle' | 'checking' | 'local' | 'available' | 'install-requested'
type WorkspaceAboutSettings = {
  version: string
  updateStatus: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'downloaded' | 'install-requested' | 'error'
  newVersion: string
  progress: number
}

type WorkspaceAppUpdateControllerState = {
  topUpdateState: Ref<WorkspaceTopUpdateState>
  aboutSettings: Ref<WorkspaceAboutSettings>
  settingsNotice: Ref<string>
}

type WorkspaceAppUpdateControllerDeps = {
  setSettingsNotice: (message: string) => void
  setTopNotice: (message: string) => void
}

export const createWorkspaceAppUpdateController = (
  state: WorkspaceAppUpdateControllerState,
  deps: WorkspaceAppUpdateControllerDeps
) => {
  const { topUpdateState, aboutSettings, settingsNotice } = state
  const { setSettingsNotice, setTopNotice } = deps

  let removeAppUpdateProgressListener: (() => void) | null = null

  const handleAppUpdateProgress = (event: AppUpdateProgressEvent) => {
    if (!isAppUpdateProgressEvent(event)) {
      aboutSettings.value = {
        ...aboutSettings.value,
        updateStatus: 'error',
        progress: 0
      }
      setSettingsNotice(appUpdateStatusMessage)
      return
    }
    aboutSettings.value = {
      ...aboutSettings.value,
      updateStatus: event.status === 'downloaded' ? 'downloaded' : event.status,
      newVersion: event.version || aboutSettings.value.newVersion,
      progress: Math.max(0, Math.min(100, Math.round(event.percent)))
    }
    if (event.status === 'downloaded') setSettingsNotice('更新已下载，可执行安装')
    if (event.status === 'error') setSettingsNotice(event.message || '更新下载失败')
  }

  const installAppUpdateProgressListener = () => {
    const onAppUpdateProgress = appRuntimeClient.onAppUpdateProgress()
    if (removeAppUpdateProgressListener || !onAppUpdateProgress) return
    removeAppUpdateProgressListener = onAppUpdateProgress(handleAppUpdateProgress)
  }

  const applyRequestedAppUpdateInstall = (version: string) => {
    aboutSettings.value = {
      ...aboutSettings.value,
      updateStatus: 'install-requested',
      newVersion: version,
      progress: 100
    }
  }

  const startAboutDownload = async () => {
    const version = aboutSettings.value.newVersion || aboutSettings.value.version
    const downloadAppUpdateBridge = appRuntimeClient.downloadAppUpdate()
    if (typeof downloadAppUpdateBridge !== 'function') {
      aboutSettings.value = { ...aboutSettings.value, updateStatus: 'error', progress: 0 }
      setSettingsNotice('更新下载服务不可用')
      return false
    }
    installAppUpdateProgressListener()
    aboutSettings.value.updateStatus = 'downloading'
    aboutSettings.value.progress = 0
    setSettingsNotice('正在下载更新')
    try {
      const result = await downloadAppUpdateBridge(version)
      if (!result?.ok || !result.data) {
        aboutSettings.value = { ...aboutSettings.value, updateStatus: 'error', progress: 0 }
        setSettingsNotice(result?.errorMessage || '更新下载失败')
        return false
      }
      if (!isAppUpdateDownloadData(result.data, version)) {
        aboutSettings.value = { ...aboutSettings.value, updateStatus: 'error', progress: 0 }
        setSettingsNotice(appUpdateStatusMessage)
        return false
      }
      aboutSettings.value = {
        ...aboutSettings.value,
        updateStatus: 'downloaded',
        newVersion: result.data.version,
        progress: result.data.percent
      }
      setSettingsNotice('更新已下载，可执行安装')
      return true
    } catch (error) {
      aboutSettings.value = { ...aboutSettings.value, updateStatus: 'error', progress: 0 }
      setSettingsNotice(error instanceof Error ? error.message : '更新下载失败')
      return false
    }
  }

  const requestAppUpdateInstall = async (version: string, setNotice: (message: string) => void) => {
    const installAppUpdateBridge = appRuntimeClient.installAppUpdate()
    if (typeof installAppUpdateBridge !== 'function') {
      setNotice('更新安装服务不可用')
      return false
    }
    try {
      const result = await installAppUpdateBridge(version)
      if (!result?.ok || !result.data) {
        setNotice(result?.errorMessage || '更新安装失败')
        return false
      }
      if (!isAppUpdateInstallData(result.data, version)) {
        setNotice(appUpdateStatusMessage)
        return false
      }
      applyRequestedAppUpdateInstall(result.data.version)
      setNotice('更新安装请求已提交')
      return true
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '更新安装失败')
      return false
    }
  }

  const checkAboutUpdate = async () => {
    if (aboutSettings.value.updateStatus === 'available') {
      return startAboutDownload()
    }
    if (aboutSettings.value.updateStatus === 'downloaded') {
      const installed = await requestAppUpdateInstall(aboutSettings.value.newVersion || aboutSettings.value.version, setSettingsNotice)
      if (!installed) aboutSettings.value.updateStatus = 'error'
      return installed
    }
    const checkUpdateBridge = appRuntimeClient.checkUpdate()
    if (typeof checkUpdateBridge !== 'function') {
      aboutSettings.value = {
        ...aboutSettings.value,
        updateStatus: 'error',
        progress: 0
      }
      setSettingsNotice('更新检查服务不可用')
      return false
    }
    aboutSettings.value = {
      ...aboutSettings.value,
      updateStatus: 'checking',
      progress: 0
    }
    setSettingsNotice('正在检查更新')
    try {
      const result = await checkUpdateBridge()
      if (!isAppUpdateCheckResult(result)) {
        aboutSettings.value = {
          ...aboutSettings.value,
          updateStatus: 'error',
          progress: 0
        }
        setSettingsNotice(appUpdateStatusMessage)
        return false
      }
      const detectedVersion = resolveUpdateVersion(result)
      if (hasAvailableAppUpdate(result)) {
        if (!detectedVersion) {
          aboutSettings.value = {
            ...aboutSettings.value,
            updateStatus: 'error',
            progress: 0
          }
          setSettingsNotice(appUpdateStatusMessage)
          return false
        }
        aboutSettings.value = {
          ...aboutSettings.value,
          updateStatus: 'available',
          newVersion: detectedVersion
        }
        setSettingsNotice(`检测到可用更新 ${aboutSettings.value.newVersion}`)
        return true
      }
      aboutSettings.value = {
        ...aboutSettings.value,
        updateStatus: 'latest',
        newVersion: detectedVersion || aboutSettings.value.version,
        progress: 0
      }
      setSettingsNotice('当前已是最新版本')
      return true
    } catch {
      aboutSettings.value = {
        ...aboutSettings.value,
        updateStatus: 'error',
        progress: 0
      }
      setSettingsNotice('更新检查失败')
      return false
    }
  }

  const checkTopUpdate = async () => {
    const checkUpdateBridge = appRuntimeClient.checkUpdate()
    if (typeof checkUpdateBridge !== 'function') {
      topUpdateState.value = 'local'
      setTopNotice('更新检查服务不可用')
      return false
    }
    topUpdateState.value = 'checking'
    try {
      const result = await checkUpdateBridge()
      if (!isAppUpdateCheckResult(result)) {
        topUpdateState.value = 'local'
        setTopNotice(appUpdateStatusMessage)
        return false
      }
      const available = hasAvailableAppUpdate(result)
      const detectedVersion = resolveUpdateVersion(result)
      if (available && !detectedVersion) {
        topUpdateState.value = 'local'
        setTopNotice(appUpdateStatusMessage)
        return false
      }
      topUpdateState.value = available ? 'available' : 'local'
      if (available) {
        aboutSettings.value.newVersion = detectedVersion
        setTopNotice(detectedVersion ? `检测到可用更新 ${detectedVersion}` : '检测到可用更新')
      }
      return true
    } catch {
      topUpdateState.value = 'local'
      setTopNotice('更新检查不可用')
      return false
    }
  }

  const handleTopUpdateClick = async () => {
    if (topUpdateState.value === 'available') {
      const version = aboutSettings.value.newVersion || aboutSettings.value.version
      topUpdateState.value = 'checking'
      const downloaded = await startAboutDownload()
      if (!downloaded || aboutSettings.value.updateStatus !== 'downloaded') {
        topUpdateState.value = 'available'
        setTopNotice(settingsNotice.value || '更新下载失败')
        return
      }
      const installed = await requestAppUpdateInstall(version, setTopNotice)
      if (!installed) {
        topUpdateState.value = 'available'
        return
      }
      topUpdateState.value = 'install-requested'
      return
    }
    await checkTopUpdate()
  }

  return {
    checkAboutUpdate,
    checkTopUpdate,
    handleTopUpdateClick
  }
}
