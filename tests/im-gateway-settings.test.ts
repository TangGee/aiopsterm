import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ status: vi.fn(), save: vi.fn(), terminals: vi.fn() }))
vi.mock('@/services/imGateway/imGatewayClient', () => ({ imGatewayClient: { status: () => api.status, save: () => api.save, terminals: () => api.terminals } }))
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
import ImGatewaySettings from '@/components/settings/ImGatewaySettings.vue'
import { defaultImGatewayConfig } from '../src/shared/contracts/imGateway'
let wrapper: ReturnType<typeof mount>
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  api.status.mockResolvedValue({ config: { ...defaultImGatewayConfig }, hasAppSecret: false, connection: 'disabled', error: '', pending: 0, bindings: 0 })
  api.save.mockImplementation(async (input: any) => ({ ok: true, status: { config: input.config, hasAppSecret: true, connection: 'connecting', error: '', pending: 0, bindings: 0 } }))
  api.terminals.mockResolvedValue({ ok: true, terminals: [{ title: 'Server', panelId: 'p', sessionId: 's', assetId: 'asset' }] })
})
afterEach(() => { wrapper?.unmount(); vi.useRealTimers() })
describe('IM gateway settings', () => {
  it('saves explicit permissions and new credentials, then clears the secret field', async () => {
    wrapper = mount(ImGatewaySettings); await flushPromises()
    await wrapper.get('[data-testid="gateway-app-id"]').setValue('cli_1234567890abcdef')
    await wrapper.get('[data-testid="gateway-secret"]').setValue('secret')
    await wrapper.get('[data-testid="gateway-users"]').setValue('ou_a\nou_a,ou_b')
    await wrapper.get('[data-testid="gateway-assets"]').setValue('asset')
    await wrapper.get('[data-testid="gateway-enabled"]').setValue(true)
    await wrapper.findAll('button').find(button => button.text() === 'imGateway.save')!.trigger('click'); await flushPromises()
    expect(api.save).toHaveBeenCalledWith({ config: { ...defaultImGatewayConfig, enabled: true, accountId: 'cli_1234567890abcdef', allowedUserIds: ['ou_a', 'ou_b'], allowedAssetIds: ['asset'] }, appSecret: 'secret' })
    expect((wrapper.get('[data-testid="gateway-secret"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.text()).toContain('imGateway.saved')
  })
  it('polls status without overwriting edits and stops polling after unmount', async () => {
    wrapper = mount(ImGatewaySettings); await flushPromises()
    await wrapper.get('[data-testid="gateway-users"]').setValue('ou_draft')
    await vi.advanceTimersByTimeAsync(2000); await flushPromises()
    expect((wrapper.get('[data-testid="gateway-users"]').element as HTMLTextAreaElement).value).toBe('ou_draft')
    wrapper.unmount(); const calls = api.status.mock.calls.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(api.status).toHaveBeenCalledTimes(calls)
  })
  it('shows rejected configuration and lists local terminal identities for host authorization', async () => {
    wrapper = mount(ImGatewaySettings); await flushPromises()
    api.save.mockResolvedValue({ ok: false, error: 'IM_GATEWAY_AUTHORIZATION_REQUIRED' })
    await wrapper.findAll('button').find(button => button.text() === 'imGateway.save')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('imGateway.authorizationError')
    await wrapper.findAll('button').find(button => button.text() === 'imGateway.refreshTerminals')!.trigger('click'); await flushPromises()
    expect(wrapper.get('table').text()).toContain('Server'); expect(wrapper.get('table').text()).toContain('asset')
  })
})
