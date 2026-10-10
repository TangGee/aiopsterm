<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw } from 'vue'
import { useI18n } from '@/i18n'
import { voiceInputMessages } from '@/i18n/locales/voiceInput'
import { doubaoSpeechEndpoint, doubaoSpeechHelpUrl, isVoiceInputConfigured, voiceModelPresets } from '@shared/voicePresets'
import type { VoiceInputPreferences, VoiceInputStatus } from '@shared/contracts/voice'

const { locale } = useI18n()
const t = (key: keyof typeof voiceInputMessages.en) => voiceInputMessages[locale.value.startsWith('zh') ? 'zh' : 'en'][key]
const preferences = ref<VoiceInputPreferences>({ mode: 'local', localEngine: 'sensevoice', tokensPath: '', endpoint: '', model: '', executablePath: '', modelPath: '', shortcut: 'CommandOrControl+Alt+R', headsetEnabled: false })
const status = ref<VoiceInputStatus>()
const apiKey = ref('')
const clearKey = ref(false)
const notice = ref('')
const loading = ref(true)
const saving = ref(false)
const detecting = ref(false)
const failed = ref(false)
const preset = computed(() => voiceModelPresets[preferences.value.localEngine || 'whisper'])
const installing = computed(() => ['downloading', 'extracting', 'checking'].includes(status.value?.installation?.phase || ''))
const installation = computed(() => status.value?.installation)
const installLabel = computed(() => {
  const phase = installation.value?.phase
  return phase === 'downloading' ? t(installation.value?.asset === 'model' ? 'downloadingModel' : 'downloadingEngine')
    : phase === 'extracting' ? t('extracting') : phase === 'checking' ? t('checkingInstall')
    : phase === 'complete' ? t('installed') : phase === 'cancelled' ? t('installCancelled') : phase === 'error' ? t('installFailed') : ''
})
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`
const selectService = () => {
  const doubao = preferences.value.serviceProvider === 'doubao'
  preferences.value.endpoint = doubao ? doubaoSpeechEndpoint : ''
  preferences.value.model = doubao ? 'volc.bigasr.auc_turbo' : ''
  preferences.value.doubaoAppId = ''
  preferences.value.hasApiKey = false
  apiKey.value = ''; clearKey.value = false; notice.value = ''
}
const install = async () => {
  if (installing.value || !window.aiops.installVoiceInputModel) return
  notice.value = ''
  try { status.value = await window.aiops.installVoiceInputModel() }
  catch (error) { notice.value = String(error) }
}
const cancelInstall = async () => {
  try { await window.aiops.cancelVoiceInputInstall?.() } catch (error) { notice.value = String(error) }
}
const needsSetup = computed(() => !isVoiceInputConfigured(status.value?.preferences))
let disposed = false
let unsubscribeStatus: (() => void) | undefined
let unsubscribe: (() => void) | undefined
let timer: ReturnType<typeof setTimeout> | undefined
const selectPreset = () => {
  preferences.value.executablePath = ''
  preferences.value.modelPath = ''
  preferences.value.tokensPath = ''
  notice.value = ''
}
const browse = async (field: 'executablePath' | 'modelPath' | 'tokensPath') => {
  try {
    const result = await window.aiops.showOpenDialog({ properties: ['openFile'] })
    if (!disposed && result?.filePaths?.[0]) preferences.value[field] = result.filePaths[0]
  } catch (error) { notice.value = String(error) }
}
const open = async (url: string) => {
  try { await window.aiops.openExternalUrl(url) } catch (error) { notice.value = String(error) }
}
const save = async () => {
  if (saving.value || loading.value || failed.value || installing.value) return
  const candidate = { ...toRaw(preferences.value), ...(clearKey.value ? { hasApiKey: false } : apiKey.value ? { apiKey: apiKey.value } : {}) }
  if (candidate.endpoint !== status.value?.preferences.endpoint || candidate.serviceProvider !== status.value?.preferences.serviceProvider) candidate.hasApiKey = false
  const validation = clearKey.value ? { ...candidate, hasApiKey: true } : candidate
  if (!isVoiceInputConfigured(validation)) { notice.value = t('incomplete'); return }
  saving.value = true
  notice.value = ''
  try {
    const value = { ...candidate }
    delete value.position
    const result = await window.aiops.validateVoiceInputPreferences?.(validation)
    if (!result?.ok) { notice.value = `${t('checkFailed')} ${result?.errorMessage || ''}`; return }
    if (disposed) return
    if (!window.aiops.saveVoiceInputPreferences) throw new Error('Voice settings are unavailable.')
    delete value.hasApiKey
    status.value = await window.aiops.saveVoiceInputPreferences({ ...value, ...(clearKey.value ? { apiKey: '' } : apiKey.value ? { apiKey: apiKey.value } : {}) })
    apiKey.value = ''
    clearKey.value = false
    preferences.value.hasApiKey = status.value.preferences.hasApiKey
    notice.value = t('savedHelp')
  } catch (error) { notice.value = String(error) }
  finally { saving.value = false }
}
const detect = async () => {
  if (detecting.value || !window.aiops.saveVoiceInputPreferences) return
  detecting.value = true
  try {
    status.value = await window.aiops.saveVoiceInputPreferences({ headsetEnabled: true })
    preferences.value.headsetEnabled = true
    if (disposed) return
    if (!status.value.headsetRegistered) { detecting.value = false; notice.value = t('headsetFailed'); return }
    notice.value = t('waiting')
    timer = setTimeout(() => { detecting.value = false; notice.value = t('unavailable') }, 10_000)
  } catch (error) { detecting.value = false; notice.value = String(error) }
}
onMounted(async () => {
  unsubscribeStatus = window.aiops.onVoiceInputStatusChanged?.((value) => {
    const completed = installing.value && value.installation?.phase === 'complete'
    status.value = value
    if (completed) {
      const installed = value.preferences
      Object.assign(preferences.value, { mode: installed.mode, localEngine: installed.localEngine, executablePath: installed.executablePath, modelPath: installed.modelPath, tokensPath: installed.tokensPath })
      notice.value = t('installed')
    }
  })
  unsubscribe = window.aiops.onVoiceInputTrigger?.((event) => {
    if (event.source !== 'headset' || !detecting.value) return
    clearTimeout(timer)
    detecting.value = false
    notice.value = t('detected')
  })
  try {
    const value = await window.aiops.getVoiceInputStatus?.()
    if (disposed) return
    if (!value) throw new Error('Voice settings are unavailable.')
    status.value = value
    preferences.value = { ...value.preferences, serviceProvider: value.preferences.serviceProvider || 'compatible', localEngine: value.preferences.localEngine || (value.preferences.executablePath || value.preferences.modelPath ? 'whisper' : 'sensevoice') }
  } catch { failed.value = true; notice.value = t('loadFailed') }
  finally { loading.value = false }
})
onBeforeUnmount(() => { disposed = true; clearTimeout(timer); unsubscribe?.(); unsubscribeStatus?.() })
</script>

<template>
  <div class="voice-settings-page" data-testid="voice-settings-page">
    <h3>{{ t('title') }}</h3>
    <p v-if="needsSetup" class="voice-setup-hint" role="status">{{ t('setup') }}</p>
    <p>{{ t('introduction') }}</p>
    <section v-if="preferences.mode === 'local' && installation && installation.phase !== 'idle'" class="voice-install-progress" data-testid="voice-install-progress" aria-live="polite">
      <p>{{ installLabel }}</p>
      <progress v-if="installing" :aria-label="installLabel" :value="installation.phase === 'downloading' && installation.total ? installation.received : undefined" :max="installation.total || 1" />
      <p v-if="installation.phase === 'downloading'">{{ size(installation.received) }}<template v-if="installation.total"> / {{ size(installation.total) }} ({{ Math.min(100, Math.floor(installation.received / installation.total * 100)) }}%)</template></p>
      <p v-if="installation.errorMessage">{{ installation.errorMessage }}</p>
      <button v-if="installing" type="button" @click="cancelInstall">{{ t('cancel') }}</button>
    </section>
    <form @submit.prevent="save">
      <fieldset :disabled="loading || saving || failed || installing">
        <label>{{ t('mode') }}<select v-model="preferences.mode" data-testid="voice-mode"><option value="local">{{ t('local') }}</option><option value="service">{{ t('service') }}</option></select></label>
        <template v-if="preferences.mode === 'local'">
          <label>{{ t('preset') }}<select v-model="preferences.localEngine" data-testid="voice-preset" @change="selectPreset"><option value="sensevoice">{{ t('recommended') }}</option><option value="whisper">{{ t('whisperPreset') }}</option></select></label>
          <section v-if="preferences.localEngine === 'sensevoice'" class="voice-auto-install">
            <p v-if="status?.environment">{{ t('environment') }}: {{ status.environment.platform }} / {{ status.environment.arch }}</p>
            <button type="button" class="voice-save" data-testid="voice-auto-install" :disabled="status?.environment?.autoInstallSupported === false" @click="install">{{ t('autoInstall') }}</button>
            <p>{{ t('autoHelp') }}</p>
            <p v-if="status?.environment?.autoInstallSupported === false">{{ t('unsupportedInstall') }}</p>
          </section>
          <details :open="preferences.localEngine === 'whisper'" data-testid="voice-manual-setup">
          <summary>{{ t('manualSetup') }}</summary>
          <p>{{ preferences.localEngine === 'sensevoice' ? t('senseHelp') : t('whisperHelp') }}</p>
          <h4>{{ t('engineStep') }}</h4>
          <p>{{ t('engineHelp') }}</p>
          <div class="voice-links"><button type="button" @click="open(preset.engineUrl)">{{ t('engineDownload') }}</button><button type="button" @click="open(preset.helpUrl)">{{ t('officialHelp') }}</button></div>
          <label>{{ preset.executable }}<span class="voice-file"><input v-model="preferences.executablePath" data-testid="voice-executable" :placeholder="preset.executable" spellcheck="false" /><button type="button" @click="browse('executablePath')">{{ t('browse') }}</button></span></label>
          <h4>{{ t('modelStep') }}</h4>
          <p>{{ preferences.localEngine === 'sensevoice' ? t('senseFiles') : t('whisperFiles') }}</p>
          <div class="voice-links"><button type="button" @click="open(preset.modelUrl)">{{ t('modelDownload') }}</button></div>
          <label>{{ t('modelFile') }}<span class="voice-file"><input v-model="preferences.modelPath" data-testid="voice-model-file" :placeholder="preset.modelFile" spellcheck="false" /><button type="button" @click="browse('modelPath')">{{ t('browse') }}</button></span></label>
          <label v-if="preferences.localEngine === 'sensevoice'">{{ t('tokens') }}<span class="voice-file"><input v-model="preferences.tokensPath" data-testid="voice-tokens" placeholder="tokens.txt" spellcheck="false" /><button type="button" @click="browse('tokensPath')">{{ t('browse') }}</button></span></label>
          </details>
        </template>
        <template v-else>
          <label>{{ t('serviceProvider') }}<select v-model="preferences.serviceProvider" data-testid="voice-service-provider" @change="selectService"><option value="doubao">{{ t('doubao') }}</option><option value="compatible">{{ t('compatible') }}</option></select></label>
          <label>{{ preferences.serviceProvider === 'doubao' ? t('doubaoKey') : t('apiKey') }}<input v-model="apiKey" data-testid="voice-api-key" type="password" autocomplete="off" /></label>
          <label v-if="preferences.hasApiKey" class="voice-check"><input v-model="clearKey" type="checkbox" />{{ t('clearKey') }}</label>
          <details :open="preferences.serviceProvider !== 'doubao'" data-testid="voice-service-advanced">
            <summary>{{ t('serviceAdvanced') }}</summary>
            <label v-if="preferences.serviceProvider === 'doubao'">{{ t('doubaoAppId') }}<input v-model="preferences.doubaoAppId" data-testid="voice-doubao-app-id" autocomplete="off" /></label>
            <label>{{ t('endpoint') }}<input v-model="preferences.endpoint" data-testid="voice-endpoint" :readonly="preferences.serviceProvider === 'doubao'" placeholder="https://host/v1/audio/transcriptions" spellcheck="false" /></label>
            <label>{{ preferences.serviceProvider === 'doubao' ? t('resourceId') : t('model') }}<input v-model="preferences.model" data-testid="voice-service-model" :readonly="preferences.serviceProvider === 'doubao'" /></label>
          </details>
          <div class="voice-links"><button type="submit" class="voice-save" data-testid="voice-service-save">{{ saving ? t('saving') : t('save') }}</button><button v-if="preferences.serviceProvider === 'doubao'" type="button" @click="open(doubaoSpeechHelpUrl)">{{ t('doubaoGuide') }}</button></div>
          <p>{{ t('serviceHelp') }}</p>
          <p>{{ preferences.serviceProvider === 'doubao' ? t('doubaoHelp') : t('serviceProtocol') }}</p>
        </template>
        <h4>{{ t('controlsStep') }}</h4>
        <label>{{ t('shortcut') }}<input v-model="preferences.shortcut" /></label>
        <p>{{ status?.shortcutRegistered ? t('registered') : t('conflict') }}</p>
        <label class="voice-check"><input v-model="preferences.headsetEnabled" type="checkbox" />{{ t('headset') }}</label>
        <p>{{ t('headsetHelp') }}</p>
        <p v-if="status?.preferences.headsetEnabled && !status.headsetRegistered">{{ t('headsetFailed') }}</p>
        <div class="voice-links"><button type="button" :disabled="detecting" @click="detect">{{ t('test') }}</button><button type="submit" class="voice-save" data-testid="voice-save">{{ saving ? t('saving') : t('save') }}</button></div>
      </fieldset>
    </form>
    <p v-if="notice" class="voice-notice" role="status">{{ notice }}</p>
    <section class="voice-help"><h4>{{ t('usageHelp') }}</h4><p>{{ t('usage') }}</p><p>{{ t('privacyHelp') }}</p></section>
  </div>
</template>

<style scoped>
progress { width: 100%; accent-color: var(--theme-core-accent, #8251cb); }
summary { cursor: pointer; padding: 10px 0; }
details > label { margin: 12px 0; }
.voice-auto-install, .voice-install-progress { padding: 14px; border: 1px solid var(--theme-core-border, #545268); border-radius: 8px; overflow-wrap: anywhere; }
.voice-settings-page { max-width: 800px; padding: 4px 4px 24px; color: var(--theme-core-text); }
p { line-height: 1.65; opacity: .85; }
h3 { margin-top: 0; }
h4 { margin: 20px 0 0; }
fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 12px; min-width: 0; }
label { display: grid; gap: 6px; }
input:not([type=checkbox]), select { width: 100%; box-sizing: border-box; min-width: 0; border: 1px solid var(--theme-core-border, #545268); background: var(--theme-core-surface-muted, #302e40); color: inherit; border-radius: 6px; padding: 10px; }
.voice-file { display: flex; gap: 8px; }
.voice-check { display: flex; align-items: center; gap: 8px; }
.voice-links { display: flex; flex-wrap: wrap; gap: 8px; }
button { color: inherit; background: var(--theme-core-surface-muted, #302e40); border: 1px solid var(--theme-core-border, #545268); border-radius: 6px; padding: 8px 14px; cursor: pointer; flex-shrink: 0; }
button:disabled, fieldset:disabled { opacity: .6; cursor: default; }
.voice-save { background: var(--theme-core-accent, #8251cb); color: var(--theme-core-bg, #10151f); }
.voice-notice, .voice-setup-hint { padding: 12px; border: 1px solid var(--theme-core-border, #545268); border-radius: 8px; overflow-wrap: anywhere; }
.voice-help { margin-top: 24px; border-top: 1px solid var(--theme-core-border, #545268); }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--theme-core-accent, #8251cb); outline-offset: 2px; }
</style>
