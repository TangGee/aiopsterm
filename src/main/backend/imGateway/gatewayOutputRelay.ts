import { stripVTControlCharacters } from 'util'
import type { GatewayBinding, GatewayMessage, GatewayScreenSender, GatewayTerminalPort } from './gatewayTypes'

// Keep escape sequences between chunks so a split OSC/CSI cannot leak control payloads.
export class GatewayTextDecoder {
  private mode: 'text' | 'escape' | 'escapeIntermediate' | 'csi' | 'string' | 'stringEscape' = 'text'
  redraw = false
  push(data: string) {
    let text = ''
    for (const ch of data) {
      if (this.mode === 'stringEscape') { this.mode = ch === '\\' ? 'text' : 'string'; continue }
      if (this.mode === 'string') { if (ch === '\x07' || ch === '\x9c') this.mode = 'text'; else if (ch === '\x1b') this.mode = 'stringEscape'; continue }
      if (this.mode === 'csi') {
        if (ch >= '@' && ch <= '~') { if ('ABCDEFGHJKSTf'.includes(ch)) this.redraw = true; this.mode = 'text' }
        continue
      }
      if (this.mode === 'escapeIntermediate') { if (ch >= '0' && ch <= '~') this.mode = 'text'; continue }
      if (this.mode === 'escape') {
        this.mode = ch === '[' ? 'csi' : ']P_^X'.includes(ch) ? 'string' : ch >= ' ' && ch <= '/' ? 'escapeIntermediate' : 'text'
        continue
      }
      if (ch === '\x1b') { this.mode = 'escape'; continue }
      if ('\x90\x98\x9d\x9e\x9f'.includes(ch)) { this.mode = 'string'; continue }
      if (ch === '\x9b') { this.mode = 'csi'; continue }
      if (ch === '\r') continue
      if (ch === '\n' || ch === '\t' || ch >= ' ' && ch !== '\x7f' && !(ch >= '\x80' && ch <= '\x9f')) text += ch
    }
    return text.replace(/<at\b/gi, '< at')
  }
}
export class GatewayOutputRelay {
  private stopped = false
  private initial = true
  private pending = ''
  private truncated = false
  private dirty = false
  private decoder = new GatewayTextDecoder()
  private lastScreen = ''
  private screenMessageId?: string
  private lastScreenAt = -Infinity
  private revision = 0
  private flushing = false
  private timer?: ReturnType<typeof setTimeout>
  private unsubscribe?: () => void
  private running: Promise<void> = Promise.resolve()
  constructor(private options: {
    terminal: GatewayTerminalPort
    binding: GatewayBinding
    message: GatewayMessage
    valid: () => Promise<boolean>
    send: (message: GatewayMessage, text: string) => Promise<void>
    sendScreen?: GatewayScreenSender
    failed: () => void | Promise<void>
    stopped?: () => void
  }) {
    this.unsubscribe = options.terminal.subscribe?.(options.binding, data => {
      if (this.stopped) return
      this.dirty = true
      this.pending += this.decoder.push(data)
      if (this.pending.length > 64000) { this.pending = this.pending.slice(-64000); this.truncated = true }
      this.schedule()
    })
    // Periodically detect closed sessions even when there is no further output.
    this.schedule()
  }
  stop() { if (this.stopped) return; this.stopped = true; this.options.stopped?.(); this.unsubscribe?.(); if (this.timer) clearTimeout(this.timer) }
  beginInput() { this.revision++; this.screenMessageId = undefined }
  async drain() { await this.running }
  private schedule() {
    if (this.stopped || this.timer || this.flushing) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flushing = true
      this.running = this.flush().finally(() => { this.flushing = false; this.schedule() })
    }, 1000)
    this.timer.unref?.()
  }
  private async flush() {
    try {
      if (this.stopped) return
      if (!await this.options.valid()) { this.stop(); return }
      if (!this.initial && !this.dirty && !this.pending) return
      const screenOutput = this.decoder.redraw && Boolean(this.options.sendScreen)
      if (screenOutput && Date.now() - this.lastScreenAt < 3000) return
      const revision = this.revision
      this.dirty = false
      let text: string
      if (this.initial || this.decoder.redraw) {
        this.initial = false
        // Cursor-addressed programs redraw a screen rather than append a transcript.
        this.pending = ''
        text = stripVTControlCharacters(await this.options.terminal.read(this.options.binding)).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(/<at\b/gi, '< at')
        // Compare exactly what the recipient sees, ignoring terminal cell padding.
        text = text.split('\n').map(line => line.trimEnd()).join('\n').trimEnd().slice(-6000)
        if (revision !== this.revision) { this.dirty = true; return }
        if (text === this.lastScreen) return
        this.lastScreen = text
      } else {
        text = this.pending.slice(0, 6000)
        this.pending = this.pending.slice(6000)
      }
      if (this.truncated) { text = '[输出过快，部分内容已省略，请在桌面查看完整输出]\n' + text; this.truncated = false }
      if (!text.trim() || this.stopped || !await this.options.valid()) return
      if (revision !== this.revision) { this.dirty = true; return }
      if (screenOutput) {
        const messageId = await this.options.sendScreen!(this.options.message, text, this.screenMessageId)
        if (revision === this.revision) this.screenMessageId = messageId
        this.lastScreenAt = Date.now()
      } else {
        await this.options.send(this.options.message, text)
      }
    } catch {
      if (!this.stopped) {
        try { await this.options.failed() } catch { /* Failure reporting must not restart the relay. */ }
      }
      this.stop()
    }
  }
}
