declare module 'zmodem.js' {
  export type ZmodemBytes = Uint8Array | ArrayBuffer | number[]

  export type ZmodemDetection = {
    confirm(): ZmodemSession
  }

  export type ZmodemTransfer = {
    get_details?: () => { name?: string; size?: number; mtime?: Date }
    on?: (event: string, callback: (...args: unknown[]) => void) => void
    accept?: () => Promise<void> | void
    skip?: () => Promise<void> | void
    send?: (bytes: Uint8Array) => void
    end?: (bytes?: Uint8Array) => Promise<void> | void
  }

  export type ZmodemSession = {
    type: 'send' | 'receive'
    on?: (event: string, callback: (...args: unknown[]) => void) => void
    start?: () => void
    close?: () => Promise<void> | void
    abort?: () => Promise<void> | void
    send_offer?: (offer: { name: string; size: number; mtime: Date; mode: number }) => Promise<ZmodemTransfer | null>
    allow_missing_OO?: (allowed: boolean) => void
  }

  export type ZmodemSentryOptions = {
    to_terminal: (octets: Uint8Array) => void
    sender: (octets: Uint8Array) => void
    on_retract?: () => void
    on_detect: (detection: ZmodemDetection) => void | Promise<void>
  }

  export class Sentry {
    constructor(options: ZmodemSentryOptions)
    consume(octets: ZmodemBytes): void
  }

  const Zmodem: {
    Sentry: typeof Sentry
  }

  export default Zmodem
}
