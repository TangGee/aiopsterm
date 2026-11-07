import { keyDataForTerminal } from '@shared/terminalKeys'
import { randomBytes } from 'crypto'
import { GatewayOutputRelay } from './gatewayOutputRelay'
import { stripVTControlCharacters } from 'util'
import type { ControlTerminalSummary } from '@shared/contracts/control'
import { gatewayConversationKey, GatewayStateStore } from './gatewayState'
import type { GatewayBinding, GatewayCard, GatewayMessage, GatewayPolicy, GatewayReply, GatewayScreenSender, GatewayTerminalPort } from './gatewayTypes'

const gatewayActions = new Set(['/help', '/sessions', '/new', '/bind', '/unbind', '/run', '/send', '/key', '/read', '/interrupt', '/status', '/binding'])
export const gatewayHelp = '/sessions 选择终端卡片\n/new 新建终端卡片\n/unbind 解除绑定\n/run <单行命令> 输入并回车\n/send <文字> 仅输入\n/read 查看最近屏幕\n/key <按键> 发送 esc、ctrl c、ctrl shift c 等按键\n/interrupt 发送 Ctrl+C\n/binding 查看当前绑定（/status 也可）\n/help 查看帮助\n绑定后普通消息直接输入并回车，输出自动回传。终端中的斜杠命令可用 /run 发送。'
export const gatewayOutput = (text: string) => {
  const clean = stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(/<at\b/gi, '< at')
  return clean.length > 6000 ? `[仅显示末尾内容]\n${clean.slice(-6000)}` : clean
}
export class GatewayCore {
  private active = true
  private queues = new Map<string, Promise<void>>()
  private terminalLocks = new Set<string>()
  private choices = new Map<string, { key: string; command: string; expires: number }>()
  private disconnected = new WeakSet<GatewayBinding>()
  private relays = new Map<string, GatewayOutputRelay>()
  private count = 0
  private lastMessageAt?: number
  constructor(private options: {
    policy: () => GatewayPolicy
    state: GatewayStateStore
    terminal: GatewayTerminalPort
    reply: (message: GatewayMessage, text: GatewayReply) => Promise<void>
    send?: (message: GatewayMessage, text: string) => Promise<void>
    sendScreen?: GatewayScreenSender
    audit: (event: string, message: GatewayMessage, action?: string) => void
    now?: () => number
  }) {}
  get status() { return { pending: this.count, bindings: this.options.state.bindingCount, lastMessageAt: this.lastMessageAt } }
  stop() { this.active = false; for (const relay of this.relays.values()) relay.stop(); this.choices.clear() }
  async drain() { await Promise.all([...this.queues.values(), ...[...this.relays.values()].map(relay => relay.drain())]) }
  private authorized(message: GatewayMessage) {
    const policy = this.options.policy()
    return policy.allowedUserIds.includes(message.senderId) && (message.conversationType === 'direct' || policy.allowedGroupIds.includes(message.conversationId))
  }
  private allowed(terminal: ControlTerminalSummary) {
    return terminal.connected && Boolean(terminal.sessionId) && this.assetAllowed(terminal)
  }
  private assetAllowed(terminal: ControlTerminalSummary) {
    const policy = this.options.policy()
    return (terminal.kind === 'local' ? this.localAllowed() : terminal.kind === 'ssh' && Boolean(terminal.assetId && (policy.allowedAssetIds.includes('all') || policy.allowedAssetIds.includes(terminal.assetId))))
  }
  private localAllowed() { const policy = this.options.policy(); return policy.allowLocalTerminal || policy.allowedAssetIds.includes('all') }
  private async bindingValid(message: GatewayMessage, key: string, binding: GatewayBinding, knownTerminal: ControlTerminalSummary) {
    if (!this.active || !this.authorized(message)) return false
    const current = this.options.state.binding(key)
    if (current?.sessionId !== binding.sessionId || current.panelId !== binding.panelId) return false
    const terminals = await this.options.terminal.list()
    if (!this.active || !this.authorized(message) || this.options.state.binding(key) !== current || !this.assetAllowed(knownTerminal)) return false
    const terminal = terminals.find(item => item.sessionId === binding.sessionId && item.panelId === binding.panelId)
    if ((!terminal || !terminal.connected) && !this.disconnected.has(current)) {
      this.disconnected.add(current)
      this.relays.get(key)?.stop()
      try {
        await this.options.send?.(message, '绑定的终端已断开或关闭，输出回传已停止。请用 /sessions 重新选择或 /new 新建终端。此前输入是否执行完成，请在桌面确认，不会自动重发。')
      } catch { this.options.audit('reply_failed', message) }
      return false
    }
    return Boolean(terminal && this.allowed(terminal))
  }
  private follow(message: GatewayMessage, key: string, binding: GatewayBinding, terminal: ControlTerminalSummary) {
    if (this.relays.has(key) || !this.options.send || !this.options.terminal.subscribe) return
    this.disconnected.delete(binding)
    this.relays.set(key, new GatewayOutputRelay({ terminal: this.options.terminal, binding, message,
      valid: () => this.bindingValid(message, key, binding, terminal), send: this.options.send, sendScreen: this.options.sendScreen,
      failed: async () => {
        this.options.audit('output_failed', message)
        // A session may disappear while an asynchronous screen read is pending.
        await this.bindingValid(message, key, binding, terminal)
      }, stopped: () => this.relays.delete(key)
    }))
  }
  private bind(message: GatewayMessage, key: string, terminal: ControlTerminalSummary) {
    const binding = { sessionId: terminal.sessionId!, panelId: terminal.panelId }
    this.options.state.bind(key, binding)
    this.relays.get(key)?.stop(); this.relays.delete(key)
    this.follow(message, key, binding, terminal)
    return `已绑定 ${terminal.title}。直接发送文字即可输入并回车，输出会自动回传。/sessions 切换终端，/unbind 解除绑定。`
  }
  private card(key: string, title: string, text: string, buttons: { label: string; command: string }[]): GatewayCard {
    const now = this.options.now?.() ?? Date.now()
    for (const [token, entry] of this.choices) if (entry.expires < now) this.choices.delete(token)
    while (this.choices.size + buttons.length > 2000) this.choices.delete(this.choices.keys().next().value!)
    return { title, text, buttons: buttons.map(button => {
      const token = randomBytes(18).toString('hex')
      this.choices.set(token, { key, command: button.command, expires: now + 600000 })
      return { label: gatewayOutput(button.label).slice(0, 100), token }
    }) }
  }
  async receive(message: GatewayMessage): Promise<void> {
    const now = this.options.now?.() ?? Date.now()
    if (!message || !['provider', 'accountId', 'tenantId', 'conversationId', 'senderId', 'messageId'].every(field => {
      const value = message[field as keyof GatewayMessage]
      return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f]/.test(value)
    }) || typeof message.text !== 'string' || !['direct', 'group'].includes(message.conversationType)) return
    if (!this.active || !this.authorized(message)) return
    if (!Number.isFinite(message.createdAt) || now - message.createdAt > 300000 || message.createdAt > now + 60000 || message.text.length > 4096) return
    if (this.count >= 32) throw new Error('IM_GATEWAY_BUSY')
    if (!this.options.state.claim(message, now)) return
    const key = gatewayConversationKey(message)
    this.lastMessageAt = now
    this.count += 1
    const pending = (this.queues.get(key) || Promise.resolve()).then(async () => {
      if (!this.active || !this.authorized(message)) return
      const action = message.text.trim().split(/\s/, 1)[0]
      this.options.audit('accepted', message, gatewayActions.has(action) ? action : 'unknown')
      let reply: GatewayReply | null
      try { reply = await this.handle(message, key) } catch { reply = '操作失败或终端已断开，请在桌面检查连接，再用 /sessions 重新选择。新建的 tab 会保留在桌面。'; this.options.audit('operation_failed', message) }
      if (!this.active || reply === null || !this.authorized(message)) return
      try { await this.options.reply(message, typeof reply === 'string' ? gatewayOutput(reply) : reply); this.options.audit('replied', message) }
      catch { this.options.audit('reply_failed', message) }
    }).finally(() => {
      this.count -= 1
      if (this.queues.get(key) === pending) this.queues.delete(key)
    })
    this.queues.set(key, pending)
    // Acknowledge transport delivery after the durable receipt, before slow terminal work.
    void pending.catch(() => {})
  }
  private async handle(message: GatewayMessage, key: string): Promise<GatewayReply | null> {
    let text = message.text
    if (message.actionToken) {
      const choice = this.choices.get(message.actionToken)
      if (!choice || choice.key !== key || choice.expires < (this.options.now?.() ?? Date.now())) return '卡片已过期，请重新发送 /sessions。'
      this.choices.delete(message.actionToken)
      text = choice.command
    }
    const match = text.trim().match(/^(\/\w+)(?:\s+([\s\S]*))?$/)
    const action = match?.[1] || ''; const argument = match?.[2] || ''
    if (action === '/help' || text.trimStart().startsWith('/') && !gatewayActions.has(action)) return gatewayHelp
    if (action === '/unbind') { this.options.state.bind(key); this.relays.get(key)?.stop(); this.relays.delete(key); return '已解除绑定。' }
    const terminals = (await this.options.terminal.list()).filter(item => this.allowed(item))
    if (!this.active || !this.authorized(message)) throw new Error('IM_GATEWAY_STOPPED')
    if (action === '/sessions' || action === '/new' && !argument.startsWith('open:')) {
      const entries: { label: string; command: string }[] = []
      if (action === '/sessions') {
        for (const item of terminals) entries.push({ label: `${item.title} (${item.host || 'Local'})`, command: `/bind ${item.sessionId}` })
      } else {
        if (this.localAllowed()) entries.push({ label: '新建本机终端', command: '/new open:local' })
        for (const host of await this.options.terminal.hosts?.() || []) {
          const allowed = this.options.policy().allowedAssetIds
          if (allowed.includes('all') || allowed.includes(host.id)) entries.push({ label: `${host.name} (${host.host})`, command: `/new open:asset:${host.id}` })
        }
      }
      const page = Math.max(0, Math.min(Math.floor(Number(argument)) || 0, Math.max(0, Math.ceil(entries.length / 8) - 1)))
      const start = Math.floor(page) * 8
      const buttons = entries.slice(start, start + 8)
      if (start > 0) buttons.push({ label: '上一页', command: `${action} ${page - 1}` })
      if (start + 8 < entries.length) buttons.push({ label: '下一页', command: `${action} ${page + 1}` })
      buttons.push({ label: action === '/sessions' ? '新建终端' : '已打开的终端', command: action === '/sessions' ? '/new' : '/sessions' })
      return this.card(key, action === '/sessions' ? '选择终端' : '新建终端', entries.length ? `点击即可绑定并开始对话。第 ${page + 1} 页` : '暂无可用终端，可新建或在桌面检查授权和连接。', buttons)
    }
    if (action === '/new') {
      const assetId = argument.startsWith('open:asset:') ? argument.slice(11) : undefined
      const allowed = this.options.policy().allowedAssetIds
      if (assetId ? !allowed.includes('all') && !allowed.includes(assetId) : argument !== 'open:local' || !this.localAllowed()) return '此终端未授权。'
      if (!this.options.terminal.create) return '当前终端服务不支持创建。'
      const terminal = await this.options.terminal.create(assetId, () => this.active && this.authorized(message) && (assetId ? this.options.policy().allowedAssetIds.some(id => id === 'all' || id === assetId) : this.localAllowed()))
      if (!this.active || !this.authorized(message) || !this.allowed(terminal)) throw new Error('IM_GATEWAY_STOPPED')
      return this.bind(message, key, terminal)
    }
    if (action === '/bind') {
      const terminal = terminals.find(item => item.sessionId === argument)
      if (!terminal?.sessionId) return '终端不存在、未授权或已断开，请用 /sessions 重新选择。'
      return this.bind(message, key, terminal)
    }
    const binding = this.options.state.binding(key)
    const terminal = binding && terminals.find(item => item.sessionId === binding.sessionId && item.panelId === binding.panelId)
    if (!binding) return '没有可用的绑定，请发送 /sessions 并点击卡片选择终端。'
    if (!terminal) {
      this.relays.get(key)?.stop()
      return '绑定的终端已断开、关闭或不再授权，本条消息未写入终端。请发送 /sessions 重新选择，或 /new 新建终端。'
    }
    this.follow(message, key, binding, terminal)
    if (action === '/status' || action === '/binding') return `当前绑定：${terminal.title}。${terminal.kind === 'local' ? '本机终端' : `SSH 主机：${terminal.host || terminal.title}`}，已连接。普通消息会输入此终端，/unbind 解除绑定。`
    if (this.terminalLocks.has(binding.sessionId)) return '该终端正在处理另一条网关请求，请稍后重试。'
    this.terminalLocks.add(binding.sessionId)
    try {
      if (action === '/read') return (await this.options.terminal.read(binding)) || '终端屏幕为空。'
      if (action === '/key') {
        const name = argument.trim()
        const keyData = name.length <= 40 && !/[\x00-\x1f\x7f]/.test(argument) ? keyDataForTerminal(name) : null
        if (!keyData) return '无效按键。示例：/key esc、/key ctrl c、/key ctrl shift c、/key enter、/key tab、/key up；每条消息只发送一个按键。'
        if (keyData.data === '\r') this.relays.get(key)?.beginInput()
        await this.options.terminal.write(binding, keyData.data)
        return `已发送按键 ${name}，不额外回车。`
      }
      if (action === '/interrupt') { await this.options.terminal.write(binding, '\x03'); return '已发送 Ctrl+C。使用 /read 查看当前屏幕。' }
      const input = action ? argument : text.replace(/\r\n?/g, '\n')
      const invalid = action ? /[\x00-\x1f\x7f]/.test(input) : /[\x00-\x08\x0b-\x1f\x7f]/.test(input)
      if (!input || input.length > (action ? 2048 : 4096) || invalid) return '输入过长或含控制字符；普通消息最多 4096 字符，/run 和 /send 只接受最多 2048 字符的单行文字。'
      const data = !action && /[\n\t]/.test(input) ? `\x1b[200~${input}\x1b[201~\r` : input + (action === '/send' ? '' : '\r')
      if (action !== '/send') this.relays.get(key)?.beginInput()
      await this.options.terminal.write(binding, data)
      if (!action) return null
      return action === '/run' ? '已输入并回车，不代表命令执行完成。使用 /read 查看输出。' : '已输入文字，尚未回车。'
    } finally { this.terminalLocks.delete(binding.sessionId) }
  }
}
