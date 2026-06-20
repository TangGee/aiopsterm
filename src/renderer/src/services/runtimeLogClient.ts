import type { RuntimeLogLevel } from '@shared/contracts/appRuntime'
import { appRuntimeClient } from '@/services/appRuntimeClient'

export const writeRendererRuntimeLog = (level: RuntimeLogLevel, event: string, fields: Record<string, unknown> = {}) => {
  void appRuntimeClient.writeRuntimeLog()?.(level, event, fields)
}
