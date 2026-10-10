<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw } from 'vue'
import { useI18n } from '@/i18n'
import { voiceInputMessages } from '@/i18n/locales/voiceInput'
import { isVoiceInputConfigured, voiceModelPresets } from '@shared/voicePresets'
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
const needsSetup = computed(() => !isVoiceInputConfigured(status.value?.preferences))
let disposed = false
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
  if (saving.value || loading.value || failed.value) return
  if (!isVoiceInputConfigured(preferences.value)) { notice.value = t('incomplete'); return }
  saving.value = true
  notice.value = ''
  try {
    const value = { ...toRaw(preferences.value) }
    delete value.position
    delete value.hasApiKey
    const result = await window.aiops.validateVoiceInputPreferences?.(value)
    if (!result?.ok) { notice.value = `${t('checkFailed')} ${result?.errorMessage || ''}`; return }
    if (disposed) return
    if (!window.aiops.saveVoiceInputPreferences) throw new Error('Voice settings are unavailable.')
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
    preferences.value = { ...value.preferences, localEngine: value.preferences.localEngine || (value.preferences.executablePath || value.preferences.modelPath ? 'whisper' : 'sensevoice') }
  } catch { failed.value = true; notice.value = t('loadFailed') }
  finally { loading.value = false }
})
onBeforeUnmount(() => { disposed = true; clearTimeout(timer); unsubscribe?.() })
</script>

<template>
  <div class="voice-settings-page" data-testid="voice-settings-page">
    <h3>{{ t('title') }}</h3>
    <p v-if="needsSetup" class="voice-setup-hint" role="status">{{ t('setup') }}</p>
    <p>{{ t('introduction') }}</p>
    <form @submit.prevent="save">
      <fieldset :disabled="loading || saving || failed">
        <label>{{ t('mode') }}<select v-model="preferences.mode" data-testid="voice-mode"><option value="local">{{ t('local') }}</option><option value="service">{{ t('service') }}</option></select></label>
        <template v-if="preferences.mode === 'local'">
          <label>{{ t('preset') }}<select v-model="preferences.localEngine" data-testid="voice-preset" @change="selectPreset"><option value="sensevoice">{{ t('recommended') }}</option><option value="whisper">{{ t('whisperPreset') }}</option></select></label>
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
        </template>
        <template v-else>
          <p>{{ t('serviceHelp') }}</p><p>{{ t('serviceProtocol') }}</p>
          <label>{{ t('endpoint') }}<input v-model="preferences.endpoint" data-testid="voice-endpoint" placeholder="https://host/v1/audio/transcriptions" spellcheck="false" /></label>
          <label>{{ t('model') }}<input v-model="preferences.model" data-testid="voice-service-model" /></label>
          <label>{{ t('apiKey') }}<input v-model="apiKey" type="password" autocomplete="off" /></label>
          <label v-if="preferences.hasApiKey" class="voice-check"><input v-model="clearKey" type="checkbox" />{{ t('clearKey') }}</label>
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
