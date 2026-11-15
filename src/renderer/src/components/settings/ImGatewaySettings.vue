<template>
  <div class="im-gateway-settings">
    <div class="settings-page-title-row">
      <h3>{{ t('imGateway.title') }}</h3>
      <div class="settings-page-help">
        <button type="button" class="settings-page-help-button" :title="t('settings.help.open')" :aria-label="t('settings.help.open')" @click="emit('open-documentation')"><CircleHelp /></button>
      </div>
    </div>
    <p>{{ t('imGateway.description') }}</p>
    <div role="status" class="gateway-status">{{ t('imGateway.connection') }}: {{ connectionLabel }} | {{ t('imGateway.pending') }}: {{ status?.pending || 0 }}</div>
    <p v-if="notice" role="alert">{{ notice }}</p>
    <fieldset :disabled="busy || !loaded">
      <label>{{ t('imGateway.provider') }}<select v-model="draft.provider" data-testid="gateway-provider" @change="changeProvider"><option value="feishu">{{ t('imGateway.feishu') }}</option><option value="telegram">Telegram</option><option value="infoflow">{{ t('imGateway.infoflow') }}</option></select></label>
      <p>{{ t('imGateway.channelSwitch') }}</p>
      <label><input v-model="draft.enabled" type="checkbox" data-testid="gateway-enabled">{{ t('imGateway.enabled') }}</label>
      <label>{{ draft.provider === 'telegram' ? 'Bot ID' : draft.provider === 'infoflow' ? 'Agent ID' : 'App ID' }}<input v-model="draft.accountId" autocomplete="off" :placeholder="draft.provider === 'feishu' ? 'cli_...' : '123456789'" data-testid="gateway-app-id"></label>
      <label v-if="draft.provider === 'infoflow'">App Key<input v-model="draft.appKey" autocomplete="off" data-testid="gateway-app-key"></label>
      <label>{{ draft.provider === 'telegram' ? 'Bot Token' : 'App Secret' }}<input v-model="secret" type="password" autocomplete="new-password" :placeholder="sameAccount && status?.hasAppSecret ? t('imGateway.secretSaved') : t('imGateway.secretPlaceholder')" data-testid="gateway-secret"></label>
      <label><input v-model="clearSecret" type="checkbox" data-testid="gateway-clear-secret">{{ t('imGateway.clearSecret') }}</label>
      <label>{{ t('imGateway.users') }}<textarea v-model="users" rows="3" :placeholder="draft.provider === 'feishu' ? 'ou_...' : t('imGateway.userIdHint')" data-testid="gateway-users"></textarea></label>
      <label>{{ t('imGateway.groups') }}<textarea v-model="groups" rows="2" :placeholder="draft.provider === 'feishu' ? 'oc_...' : t('imGateway.groupIdHint')"></textarea></label>
      <p>{{ t('imGateway.groupHelp') }}</p>
      <label><input v-model="allTerminals" type="checkbox" data-testid="gateway-all">{{ t('imGateway.allTerminals') }}</label>
      <label>{{ t('imGateway.assets') }}<textarea v-model="assets" :disabled="allTerminals" rows="3" data-testid="gateway-assets"></textarea></label>
      <label><input v-model="draft.allowLocalTerminal" :disabled="allTerminals" type="checkbox" data-testid="gateway-local">{{ t('imGateway.allowLocal') }}</label>
      <div class="gateway-buttons">
        <button @click="save">{{ t('imGateway.save') }}</button>
        <button @click="refreshTerminals">{{ t('imGateway.refreshTerminals') }}</button>
      </div>
    </fieldset>
    <table v-if="terminals.length">
      <thead><tr><th>{{ t('imGateway.terminal') }}</th><th>{{ t('imGateway.assetId') }}</th><th>sessionId</th></tr></thead>
      <tbody><tr v-for="terminal in terminals" :key="terminal.panelId"><td>{{ terminal.title }}</td><td>{{ terminal.assetId || 'Local' }}</td><td><code>{{ terminal.sessionId }}</code></td></tr></tbody>
    </table>
    <details open>
      <summary>{{ t('imGateway.help') }}</summary>
      <ol v-if="draft.provider === 'feishu'"><li>{{ t('imGateway.setup1') }}</li><li>{{ t('imGateway.setup2') }}</li><li>{{ t('imGateway.setup3') }}</li><li>{{ t('imGateway.setup4') }}</li></ol>
      <p v-else>{{ t(draft.provider === 'telegram' ? 'imGateway.telegramSetup' : 'imGateway.infoflowSetup') }}</p>
      <pre>/sessions
/new
pwd
/run /model
/read
/send text
/keymap
/help key
/screenshot
/key ctrl c
/key ctrl shift c
/key ctrl alt c
/key ctrl shift up
/key esc
/key enter
/interrupt
/binding
/status
/unbind
/help</pre>
      <p v-if="draft.provider === 'feishu'">{{ t('imGateway.behavior') }}</p>
    </details>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { CircleHelp } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import { imGatewayClient } from '@/services/imGateway/imGatewayClient'
import { defaultImGatewayConfig, type ImGatewayStatus } from '@shared/contracts/imGateway'
import type { ControlTerminalSummary } from '@shared/contracts/control'
const { t } = useI18n()
const emit = defineEmits<{ 'open-documentation': [] }>()
const status = ref<ImGatewayStatus>()
const draft = ref(structuredClone(defaultImGatewayConfig))
const users = ref(''); const groups = ref(''); const assets = ref(''); const secret = ref(''); const clearSecret = ref(false)
const allTerminals = computed({ get: () => assets.value.split(/[\s,]+/).includes('all'), set: (value: boolean) => { assets.value = value ? 'all' : '' } })
const loaded = ref(false); const busy = ref(false); const notice = ref(''); const terminals = ref<ControlTerminalSummary[]>([])
let disposed = false; let polling = false; let timer: ReturnType<typeof setInterval> | undefined
const sameAccount = computed(() => draft.value.provider === status.value?.config.provider && draft.value.accountId === status.value?.config.accountId && draft.value.appKey === status.value?.config.appKey)
const changeProvider = () => {
  draft.value.enabled = false; draft.value.accountId = ''; delete draft.value.appKey
  users.value = ''; groups.value = ''; secret.value = ''; clearSecret.value = false; notice.value = ''
}
const connectionLabel = computed(() => t(`imGateway.state.${status.value?.connection || 'disabled'}`))
const errorText = (code = '') => {
  if (code === 'IM_GATEWAY_KEYCHAIN_UNAVAILABLE') return t('imGateway.keychainError')
  if (code === 'IM_GATEWAY_AUTHORIZATION_REQUIRED') return t('imGateway.authorizationError')
  if (code === 'IM_GATEWAY_SECRET_REQUIRED') return t('imGateway.secretError')
  if (code === 'FEISHU_CONNECTION_FAILED' || code === 'IM_GATEWAY_START_FAILED' || code.endsWith('_CONNECTION_FAILED')) return t('imGateway.connectionError')
  return `${t('imGateway.error')} (${/^IM_GATEWAY_[A-Z_]+$/.test(code) ? code : 'IM_GATEWAY_UNAVAILABLE'})`
}
const refresh = async (initialize = false) => {
  if (polling) return
  polling = true
  try {
    const method = imGatewayClient.status()
    if (!method) throw new Error('IM_GATEWAY_UNAVAILABLE')
    const value = await method()
    if (disposed) return
    status.value = value
    if (initialize) {
      draft.value = structuredClone(value.config)
      users.value = value.config.allowedUserIds.join('\n'); groups.value = value.config.allowedGroupIds.join('\n'); assets.value = value.config.allowedAssetIds.join('\n')
      loaded.value = true
    }
    if (value.error) notice.value = errorText(value.error)
  } catch { if (!disposed) notice.value = t('imGateway.unavailable') }
  finally { polling = false }
}
const list = (text: string) => [...new Set(text.split(/[\s,]+/).filter(Boolean))]
const save = async () => {
  if (busy.value) return
  busy.value = true; notice.value = ''
  try {
    const method = imGatewayClient.save()
    if (!method) throw new Error('IM_GATEWAY_UNAVAILABLE')
    const result = await method({ config: { ...draft.value, allowedUserIds: list(users.value), allowedGroupIds: list(groups.value), allowedAssetIds: list(assets.value) }, ...(clearSecret.value ? { appSecret: '' } : secret.value ? { appSecret: secret.value } : {}) })
    if (disposed) return
    if (!result.ok || !result.status) { notice.value = errorText(result.error); return }
    status.value = result.status; secret.value = ''; clearSecret.value = false
    notice.value = result.status.error ? errorText(result.status.error) : t('imGateway.saved')
  } catch { if (!disposed) notice.value = t('imGateway.unavailable') }
  finally { busy.value = false }
}
const refreshTerminals = async () => {
  try {
    const value = await imGatewayClient.terminals()?.()
    if (disposed) return
    if (!value?.ok) { notice.value = t('imGateway.terminalsError'); return }
    terminals.value = value.terminals
  } catch { if (!disposed) notice.value = t('imGateway.terminalsError') }
}
onMounted(() => { void refresh(true); timer = setInterval(() => { if (!busy.value) void refresh(!loaded.value) }, 2000) })
onUnmounted(() => { disposed = true; if (timer) clearInterval(timer); secret.value = '' })
</script>
<style scoped>
.im-gateway-settings { max-width: 860px; display: grid; gap: 14px; }
fieldset { border: 0; padding: 0; display: grid; gap: 14px; }
label { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
input:not([type=checkbox]), textarea, select { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--theme-module-active-border); border-radius: 8px; background: var(--theme-module-active-input-bg); color: var(--theme-module-active-text); font: inherit; }
input:focus-visible, textarea:focus-visible, select:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--theme-accent, #4faabb); outline-offset: 2px; }
input[type=checkbox] { accent-color: var(--theme-accent, #4faabb); }
button:not(.settings-page-help-button) { padding: 9px 14px; border: 1px solid var(--theme-module-active-border); border-radius: 8px; background: var(--theme-module-active-card-bg); color: var(--theme-module-active-text); font: inherit; cursor: pointer; }
button:not(.settings-page-help-button):hover { filter: brightness(1.15); }
fieldset:disabled { opacity: 0.6; }
fieldset:disabled button { cursor: default; }
summary { cursor: pointer; }
pre { overflow-x: auto; }
h3, p { margin: 0; }
textarea { resize: vertical; }
.gateway-buttons { display: flex; gap: 12px; }
.gateway-status, pre { padding: 12px; background: var(--theme-module-active-card-bg); border-radius: 6px; }
p, li { color: var(--theme-module-active-text-muted); line-height: 1.6; }
table { width: 100%; text-align: left; table-layout: fixed; }
td, th { padding: 8px; overflow-wrap: anywhere; }
</style>
