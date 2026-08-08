import { watch } from 'fs'

type NativeWatcher = {
  close: () => void
  on: (event: 'error', listener: (error: Error) => void) => unknown
}

type NativeWatchFactory = (
  parentPath: string,
  onChange: (filename: string) => void
) => NativeWatcher

type ResilientParentFileWatcherInput = {
  parentPath: string
  onChange: (filename: string) => void
  inspect: () => void | Promise<void>
  pollIntervalMs?: number
}

const nativeWatch: NativeWatchFactory = (parentPath, onChange) => {
  const watcher = watch(parentPath, { recursive: false }, (_event, filename) => {
    onChange(filename?.toString() || '')
  })
  return watcher
}

export const createResilientParentFileWatcher = (
  input: ResilientParentFileWatcherInput,
  watchFactory: NativeWatchFactory = nativeWatch
) => {
  let closed = false
  let nativeWatcher: NativeWatcher | null = null
  let pollTimer: NodeJS.Timeout | null = null

  const inspect = () => {
    if (closed) return
    void Promise.resolve(input.inspect()).catch(() => undefined)
  }
  const usePolling = () => {
    if (closed || pollTimer) return
    try {
      nativeWatcher?.close()
    } catch {
      // The native watcher may already be invalid after an asynchronous error.
    }
    nativeWatcher = null
    inspect()
    pollTimer = setInterval(inspect, Math.max(50, input.pollIntervalMs || 100))
    pollTimer.unref()
  }

  try {
    nativeWatcher = watchFactory(input.parentPath, input.onChange)
    nativeWatcher.on('error', usePolling)
  } catch {
    usePolling()
  }

  return {
    close: () => {
      if (closed) return
      closed = true
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
      try {
        nativeWatcher?.close()
      } catch {
        // Closing an invalid native watcher is best-effort during cleanup.
      }
      nativeWatcher = null
    }
  }
}
