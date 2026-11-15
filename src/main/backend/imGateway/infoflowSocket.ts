import { EventEmitter } from 'node:events'
import { WSClient, type WSClientOptions } from '@core-workspace/infoflow-sdk-nodejs'

// SDK 0.1.7 stores callbacks in its own map, then also emits Node events.
// Register a native listener on this instance only to absorb the second error
// emission. Normal SDK error handlers still update the gateway status.
export const guardInfoflowSocketErrors = (socket: WSClient) => {
  const dispatcher: unknown = Reflect.get(socket, 'eventDispatcher')
  if (!(dispatcher instanceof EventEmitter)) throw new Error('IM_GATEWAY_INFOFLOW_SDK_INCOMPATIBLE')
  EventEmitter.prototype.addListener.call(dispatcher, 'error', () => {})
}

export const createInfoflowSocket = (options: WSClientOptions, signal: AbortSignal): WSClient => {
  class StoppableClient extends WSClient {
    override async connect() {
      if (signal.aborted) return
      let timer: ReturnType<typeof setTimeout> | undefined
      let cancel: () => void = () => {}
      let expired = false
      const deadline = new Promise<never>((_resolve, reject) => {
        cancel = () => { expired = true; reject(new Error('IM_GATEWAY_INFOFLOW_CONNECTION_FAILED')) }
        timer = setTimeout(cancel, 30000)
        timer.unref?.()
        signal.addEventListener('abort', cancel, { once: true })
      })
      const connect = super.connect().finally(() => {
        if (signal.aborted || expired) this.disconnect()
      })
      try { await Promise.race([connect, deadline]) }
      catch { this.disconnect(); throw new Error('IM_GATEWAY_INFOFLOW_CONNECTION_FAILED') }
      finally {
        if (timer) clearTimeout(timer)
        signal.removeEventListener('abort', cancel)
      }
    }
  }
  const socket = new StoppableClient(options)
  guardInfoflowSocketErrors(socket)
  return socket
}
