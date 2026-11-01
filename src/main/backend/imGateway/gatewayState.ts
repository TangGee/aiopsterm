import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { GatewayBinding, GatewayMessage } from './gatewayTypes'

type State = { version: 1; receipts: Record<string, number>; bindings: Record<string, GatewayBinding> }
const digest = (parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex')
export const gatewayConversationKey = (message: GatewayMessage) => digest([message.provider, message.accountId, message.tenantId, message.conversationId, message.senderId])
const receiptKey = (message: GatewayMessage) => digest([message.provider, message.accountId, message.tenantId, message.messageId])
const validKey = (key: string) => /^[a-f0-9]{64}$/.test(key)
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f]/.test(value)
export class GatewayStateStore {
  private state: State = { version: 1, receipts: {}, bindings: {} }
  constructor(private path?: string) {
    if (!path || !existsSync(path)) return
    if (statSync(path).size > 4 * 1024 * 1024) throw new Error('IM_GATEWAY_STATE_INVALID')
    const value = JSON.parse(readFileSync(path, 'utf8')) as State
    if (value?.version !== 1 || !value.receipts || !value.bindings || typeof value.receipts !== 'object' || typeof value.bindings !== 'object' || Array.isArray(value.receipts) || Array.isArray(value.bindings) ||
      Object.keys(value.receipts).length > 10000 || Object.keys(value.bindings).length > 1000 ||
      !Object.entries(value.receipts).every(([key, time]) => validKey(key) && Number.isFinite(time)) ||
      !Object.entries(value.bindings).every(([key, binding]) => validKey(key) && validId(binding?.sessionId) && validId(binding?.panelId))) throw new Error('IM_GATEWAY_STATE_INVALID')
    this.state = value
  }
  private replace(next: State) {
    if (this.path) {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
      writeFileSync(`${this.path}.tmp`, JSON.stringify(next), { mode: 0o600 })
      renameSync(`${this.path}.tmp`, this.path)
    }
    this.state = next
  }
  claim(message: GatewayMessage, now: number) {
    const key = receiptKey(message)
    if (this.state.receipts[key] !== undefined) return false
    const receipts = Object.fromEntries(Object.entries(this.state.receipts).filter(([, time]) => now - time < 86400000))
    if (Object.keys(receipts).length >= 10000) throw new Error('IM_GATEWAY_RECEIPT_LIMIT')
    receipts[key] = now
    this.replace({ ...this.state, receipts })
    return true
  }
  binding(key: string) { return this.state.bindings[key] }
  get bindingCount() { return Object.keys(this.state.bindings).length }
  bind(key: string, binding?: GatewayBinding) {
    const bindings = { ...this.state.bindings }
    if (binding) {
      if (!bindings[key] && Object.keys(bindings).length >= 1000) throw new Error('IM_GATEWAY_BINDING_LIMIT')
      bindings[key] = binding
    } else delete bindings[key]
    this.replace({ ...this.state, bindings })
  }
}
