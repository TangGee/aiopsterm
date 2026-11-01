import { stripVTControlCharacters } from 'util'
import type { ControlTerminalSummary } from '@shared/contracts/control'
import { gatewayConversationKey, GatewayStateStore } from './gatewayState'
import type { GatewayMessage, GatewayPolicy, GatewayTerminalPort } from './gatewayTypes'

const gatewayActions = new Set(['/help', '/sessions', '/bind', '/unbind', '/run', '/send', '/read', '/interrupt', '/status'])
export const gatewayHelp = '/sessions 查看授权终端\n/bind <sessionId> 绑定终端\n/unbind 解除绑定\n/run <单行命令> 输入并回车\n/send <文字> 仅输入\n/read 查看最近屏幕\n/interrupt 发送 Ctrl+C\n/status 查看绑定\n/help 查看帮助'
export const gatewayOutput = (text: string) => {
  const clean = stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(/<at\b/gi, '< at')
  return clean.length > 6000 ? `[仅显示末尾内容]\n${clean.slice(-6000)}` : clean
}
export class GatewayCore {
  private active = true
  private queues = new Map<string, Promise<void>>()
  private terminalLocks = new Set<string>()
  private count = 0
  private lastMessageAt?: number
  constructor(private options: {
    policy: () => GatewayPolicy
    state: GatewayStateStore
    terminal: GatewayTerminalPort
    reply: (message: GatewayMessage, text: string) => Promise<void>
    audit: (event: string, message: GatewayMessage, action?: string) => void
    now?: () => number
  }) {}
  get status() { return { pending: this.count, bindings: this.options.state.bindingCount, lastMessageAt: this.lastMessageAt } }
  stop() { this.active = false }
  async drain() { await Promise.all([...this.queues.values()]) }
  private authorized(message: GatewayMessage) {
    const policy = this.options.policy()
    return policy.allowedUserIds.includes(message.senderId) && (message.conversationType === 'direct' || policy.allowedGroupIds.includes(message.conversationId))
  }
  private allowed(terminal: ControlTerminalSummary) {
    const policy = this.options.policy()
    return terminal.connected && Boolean(terminal.sessionId) && (terminal.kind === 'local' ? policy.allowLocalTerminal : terminal.kind === 'ssh' && Boolean(terminal.assetId && policy.allowedAssetIds.includes(terminal.assetId)))
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
      let reply: string
      try { reply = await this.handle(message, key) } catch { reply = '操作失败或终端已断开，请在桌面检查连接，再用 /sessions 和 /bind 重新绑定。'; this.options.audit('operation_failed', message) }
      if (!this.active) return
      try { await this.options.reply(message, gatewayOutput(reply)); this.options.audit('replied', message) }
      catch { this.options.audit('reply_failed', message) }
    }).finally(() => {
      this.count -= 1
      if (this.queues.get(key) === pending) this.queues.delete(key)
    })
    this.queues.set(key, pending)
    // Acknowledge transport delivery after the durable receipt, before slow terminal work.
    void pending.catch(() => {})
  }
  private async handle(message: GatewayMessage, key: string): Promise<string> {
    const match = message.text.trim().match(/^(\/\w+)(?:\s+([\s\S]*))?$/)
    const action = match?.[1] || ''; const argument = match?.[2] || ''
    if (action === '/help' || !gatewayActions.has(action)) return gatewayHelp
    if (action === '/unbind') { this.options.state.bind(key); return '已解除绑定。' }
    const terminals = (await this.options.terminal.list()).filter(item => this.allowed(item))
    if (!this.active || !this.authorized(message)) throw new Error('IM_GATEWAY_STOPPED')
    if (action === '/sessions') return terminals.length ? terminals.slice(0, 40).map(item => `${item.sessionId} | ${item.title} | ${item.host || 'Local'}`).join('\n') : '没有已连接的授权终端。请先在桌面打开主机，并在 IM 网关设置中授权。'
    if (action === '/bind') {
      const terminal = terminals.find(item => item.sessionId === argument)
      if (!terminal?.sessionId) return '终端不存在、未授权或已断开，请用 /sessions 查看。'
      this.options.state.bind(key, { sessionId: terminal.sessionId, panelId: terminal.panelId })
      return `已绑定 ${terminal.title}。使用 /run 输入命令并回车，/read 查看屏幕。`
    }
    const binding = this.options.state.binding(key)
    const terminal = binding && terminals.find(item => item.sessionId === binding.sessionId && item.panelId === binding.panelId)
    if (!terminal || !binding) return '没有可用的绑定，请用 /sessions 查看终端，再发送 /bind <sessionId>。'
    if (action === '/status') return `当前绑定：${terminal.title}\n${binding.sessionId}`
    if (this.terminalLocks.has(binding.sessionId)) return '该终端正在处理另一条网关请求，请稍后重试。'
    this.terminalLocks.add(binding.sessionId)
    try {
      if (action === '/read') return (await this.options.terminal.read(binding)) || '终端屏幕为空。'
      if (action === '/interrupt') { await this.options.terminal.write(binding, '\x03'); return '已发送 Ctrl+C。使用 /read 查看当前屏幕。' }
      if (!argument || argument.length > 2048 || /[\x00-\x1f\x7f]/.test(argument)) return '请输入不超过 2048 字符的单行文字，不支持换行或控制字符。'
      await this.options.terminal.write(binding, argument + (action === '/run' ? '\r' : ''))
      return action === '/run' ? '已输入并回车，不代表命令执行完成。使用 /read 查看输出。' : '已输入文字，尚未回车。'
    } finally { this.terminalLocks.delete(binding.sessionId) }
  }
}
