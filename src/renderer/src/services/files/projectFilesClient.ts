import { createBridgeMethod } from '@/services/common/preloadBridgeClient'
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type ProjectFilesBridge = Pick<
  AiopsPreloadApi,
  | 'getProjectFileContext'
  | 'listProjectDirectory'
  | 'readProjectFile'
  | 'writeProjectFile'
  | 'startProjectFileWatch'
  | 'stopProjectFileWatch'
  | 'onProjectFileWatchEvent'
  | 'onProjectFilesChanged'
>

const bridgeMethod = createBridgeMethod<ProjectFilesBridge>()

export const projectFilesClient = {
  getContext: () => bridgeMethod('getProjectFileContext'),
  listDirectory: () => bridgeMethod('listProjectDirectory'),
  readFile: () => bridgeMethod('readProjectFile'),
  writeFile: () => bridgeMethod('writeProjectFile'),
  startWatch: () => bridgeMethod('startProjectFileWatch'),
  stopWatch: () => bridgeMethod('stopProjectFileWatch'),
  onWatchEvent: () => bridgeMethod('onProjectFileWatchEvent'),
  onChanged: () => bridgeMethod('onProjectFilesChanged')
}
