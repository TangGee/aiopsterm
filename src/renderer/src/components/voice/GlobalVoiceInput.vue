<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Mic, Square, LoaderCircle, Settings, X, FileText } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import { registerGlobalVoiceController } from '@/services/voice/globalVoiceController'
import { isVoiceInputConfigured } from '@shared/voicePresets'
import { useI18n } from '@/i18n'
import { voiceInputMessages } from '@/i18n/locales/voiceInput'
import { captureVoiceInputTarget, type VoiceInputTarget } from '@/services/voice/voiceInputTargets'
import { createVoiceRecording } from '@/services/voice/voiceRecording'
import type { VoiceInputPreferences, VoiceInputStatus, VoiceInputTrigger } from '@shared/contracts/voice'

const { locale } = useI18n()
const workspace = useWorkspaceStore()
const t = (key: keyof typeof voiceInputMessages.en) => voiceInputMessages[locale.value.startsWith('zh') ? 'zh' : 'en'][key]
const root = ref<HTMLElement | null>(null)
const transcriptInput = ref<HTMLTextAreaElement | null>(null)
const panel = ref(false)
const transcript = ref('')
const notice = ref('')
const position = ref({ right: 24, bottom: 96 })
const now = ref(Date.now())
const level = ref(0)
const status = ref<VoiceInputStatus>()
const preferences = ref<VoiceInputPreferences>({ mode: 'local', endpoint: '', model: '', executablePath: '', modelPath: '', shortcut: 'CommandOrControl+Alt+R', headsetEnabled: false })
const target = shallowRef<VoiceInputTarget | null>(null)
let lastFocused: Element | null = null
let captured: VoiceInputTarget | null = null
let draftTarget: VoiceInputTarget | null = null
let unsubscribe: (() => void) | undefined
let interval: ReturnType<typeof setInterval> | undefined
let unsubscribeStatus: (() => void) | undefined
let context: AudioContext | null = null
let analyser: AnalyserNode | null = null
let disposed = false
let targetChanged = false
let unregisterController: (() => void) | undefined
let drag: { x: number; y: number; right: number; bottom: number; moved: boolean } | null = null
let suppressClick = false

const recording = createVoiceRecording({
  transcribe: (input) => window.aiops.transcribeVoiceInput(input),
  cancelTranscription: (id) => { void window.aiops.cancelVoiceTranscription?.(id) },
  onStream(stream) {
    void context?.close().catch(() => undefined)
    context = null
    analyser = null
    level.value = 0
    if (!stream) return
    try {
      context = new AudioContext()
      analyser = context.createAnalyser()
      analyser.fftSize = 256
      context.createMediaStreamSource(stream).connect(analyser)
    } catch { /* Recording remains available without a level meter. */ }
  },
  onText(text) {
    const destination = target.value
    if (targetChanged) destination?.dispose?.()
    target.value = null
    if (!targetChanged && destination?.kind === 'text' && destination.insert(text)) return
    if (draftTarget?.insert(text)) { draftTarget = null; target.value = !targetChanged && destination?.kind === 'terminal' ? destination : null; panel.value = true; return }
    draftTarget = null
    transcript.value += (transcript.value && !/\s$/.test(transcript.value) ? '\n' : '') + text
    target.value = !targetChanged && destination?.kind === 'terminal' ? destination : null
    notice.value = !targetChanged && destination?.kind === 'terminal' ? t('terminal') : destination ? t('invalid') : ''
    panel.value = true
    void nextTick(() => transcriptInput.value?.focus())
  }
})
const { state, error } = recording
const busy = computed(() => state.value !== 'idle')
const duration = computed(() => {
  const seconds = Math.max(0, Math.floor((now.value - recording.startedAt.value) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
})
const terminalTarget = computed(() => panel.value && target.value?.kind === 'terminal')
const buttonTitle = computed(() => state.value === 'recording' ? t('stop') : state.value === 'idle' ? `${t('start')} (${preferences.value.shortcut})` : t(state.value))
const errorText = computed(() => /denied|notallowed|permission/i.test(error.value) ? t('permission') : /notfound|requested device/i.test(error.value) ? t('noMicrophone') : error.value)

const clampPosition = () => {
  position.value = { right: Math.min(Math.max(8, position.value.right), Math.max(8, innerWidth - 64)), bottom: Math.min(Math.max(8, position.value.bottom), Math.max(8, innerHeight - 64)) }
}
const applyStatus = (value: VoiceInputStatus) => {
  status.value = value
  preferences.value = { ...value.preferences }
  if (value.preferences.position) { position.value = { ...value.preferences.position }; clampPosition() }
}
const openSettings = () => {
  panel.value = false
  workspace.setActiveSettingsSection('voice')
  workspace.setActiveModule('settings')
}
const toggle = async (destination?: VoiceInputTarget | null, background = false) => {
  if (state.value === 'recording') { destination?.dispose?.(); recording.stop(); return }
  if (state.value !== 'idle') { destination?.dispose?.(); return }
  if (!isVoiceInputConfigured(status.value?.preferences)) { destination?.dispose?.(); openSettings(); return }
  target.value?.dispose?.()
  targetChanged = false
  target.value = background ? null : destination === undefined ? captureVoiceInputTarget(lastFocused) : destination
  draftTarget?.dispose?.()
  draftTarget = null
  notice.value = ''
  if (!target.value || target.value.kind === 'terminal') {
    panel.value = true
      notice.value = target.value?.kind === 'terminal' ? t('terminal') : t('fallback')
  }
  await recording.start()
}
const click = (event: MouseEvent) => {
  if (suppressClick) { suppressClick = false; return }
  void toggle(event.detail === 0 && !captured ? captureVoiceInputTarget(lastFocused) : captured)
  captured = null
}
const pointerDown = (event: PointerEvent) => {
  suppressClick = false
  if (event.button !== 0) return
  captured = captureVoiceInputTarget(document.activeElement === event.currentTarget ? lastFocused : document.activeElement)
  drag = { x: event.clientX, y: event.clientY, ...position.value, moved: false }
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  event.preventDefault()
}
const pointerMove = (event: PointerEvent) => {
  if (!drag) return
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) drag.moved = true
  if (!drag.moved) return
  position.value = { right: drag.right - event.clientX + drag.x, bottom: drag.bottom - event.clientY + drag.y }
  clampPosition()
}
const pointerUp = () => {
  if (drag?.moved) {
    suppressClick = true
    captured?.dispose?.()
    captured = null
    void window.aiops.saveVoiceInputPreferences?.({ position: position.value }).catch((cause) => { notice.value = String(cause) })
  }
  drag = null
}
const rememberFocus = (event: FocusEvent) => {
  if (event.target instanceof Element && !root.value?.contains(event.target)) lastFocused = event.target
}
const externalPointer = (event: PointerEvent) => {
  if (event.target instanceof Element && !root.value?.contains(event.target) && !event.target.closest('input, textarea, [contenteditable], .monaco-editor, .xterm')) lastFocused = null
}
const cancel = () => { recording.cancel(); target.value?.dispose?.(); target.value = null; draftTarget?.dispose?.(); draftTarget = null; captured?.dispose?.(); captured = null; notice.value = '' }
const close = () => { cancel(); panel.value = false }
const onKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && (busy.value || panel.value)) { event.preventDefault(); event.stopPropagation(); close() }
}
const onTrigger = (event: VoiceInputTrigger) => {
  if (event.source === 'headset' && workspace.activeModule === 'settings' && workspace.activeSettingsSection === 'voice' && !busy.value) return
  void toggle(event.background ? null : captureVoiceInputTarget(document.activeElement), event.background)
}
const continueDictating = async () => {
  const input = transcriptInput.value
  const draft = input ? captureVoiceInputTarget(input) : null
  const terminal = target.value?.kind === 'terminal' ? target.value : null
  await toggle(null)
  if (disposed || state.value !== 'recording') { draft?.dispose?.(); return }
  target.value = terminal
  draftTarget = draft
}
const insertTerminal = () => {
  if (targetChanged || !target.value?.insert(transcript.value.replace(/[\r\n\x00-\x1f\x7f-\x9f]+/g, ' '))) { notice.value = t('invalid'); target.value = null; return }
  close()
}
const copy = async () => {
  try { await navigator.clipboard.writeText(transcript.value); notice.value = t('copied') }
  catch { notice.value = t('copiedFailed'); transcriptInput.value?.select() }
}

watch(() => [workspace.activePanelId, workspace.selectedConversationId, workspace.selectedManagedAiSessionKey, workspace.activeModule, workspace.mode], () => {
  if (target.value) { targetChanged = true; target.value.dispose?.() }
}, { flush: 'sync' })

onMounted(async () => {
  unregisterController = registerGlobalVoiceController({ state, toggle: () => { void toggle(captureVoiceInputTarget(document.activeElement)) } })
  document.addEventListener('focusin', rememberFocus)
  document.addEventListener('pointerdown', externalPointer, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', clampPosition)
  unsubscribe = window.aiops.onVoiceInputTrigger?.(onTrigger)
  unsubscribeStatus = window.aiops.onVoiceInputStatusChanged?.(applyStatus)
  interval = setInterval(() => {
    now.value = Date.now()
    if (analyser) {
      const data = new Uint8Array(analyser.fftSize)
      analyser.getByteTimeDomainData(data)
      level.value = Math.min(1, Math.sqrt(data.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / data.length) * 5)
    }
  }, 100)
  try {
    const value = await window.aiops.getVoiceInputStatus?.()
    if (value && !disposed) applyStatus(value)
  } catch (cause) { notice.value = String(cause) }
})
onBeforeUnmount(() => {
  disposed = true
  cancel()
  unsubscribe?.()
  unregisterController?.()
  clearInterval(interval)
  unsubscribeStatus?.()
  document.removeEventListener('focusin', rememberFocus)
  document.removeEventListener('pointerdown', externalPointer, true)
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('resize', clampPosition)
})
</script>

<template>
  <div ref="root" class="global-voice" data-testid="global-voice" :style="{ right: `${position.right}px`, bottom: `${position.bottom}px` }">
    <section v-if="panel" class="voice-panel" role="dialog" :aria-label="t('title')">
      <header><strong>{{ t('title') }}</strong><button :aria-label="t('close')" @click="close"><X :size="18" /></button></header>
        <p>{{ notice || t('fallback') }}</p>
        <textarea ref="transcriptInput" v-model="transcript" :aria-label="t('text')" rows="7" data-testid="voice-transcript" />
        <div class="voice-actions">
          <button :disabled="busy" @click="continueDictating">{{ t('continue') }}</button>
          <button :disabled="!transcript" @click="copy">{{ t('copy') }}</button>
          <button :disabled="busy || !transcript" @click="transcript = ''">{{ t('clear') }}</button>
          <button v-if="terminalTarget" :disabled="busy || !transcript" @click="insertTerminal">{{ t('insert') }}</button>
          <button @click="close">{{ t('done') }}</button>
        </div>
    </section>
    <div v-if="errorText" class="voice-error" role="alert">{{ t('failed') }}: {{ errorText }}<button @click="error = ''" :aria-label="t('close')"><X :size="14" /></button></div>
    <div class="voice-controls">
      <div v-if="busy" class="voice-status" role="status"><span>{{ t(state) }} {{ state === 'recording' ? duration : '' }}</span><meter v-if="state === 'recording'" min="0" max="1" :value="level" :aria-label="t('recording')" /><button @click="cancel">{{ t('cancel') }}</button></div>
      <button v-if="!busy" class="voice-secondary" :aria-label="t('openDraft')" :title="t('openDraft')" @click="panel = true"><FileText :size="17" /></button>
      <button v-if="!busy" class="voice-secondary" :aria-label="t('settings')" :title="t('settings')" @click="openSettings"><Settings :size="17" /></button>
      <button class="voice-mic" :class="{ recording: state === 'recording' }" data-testid="global-voice-button" :aria-label="buttonTitle" :title="`${buttonTitle}. ${t('drag')}`" :aria-pressed="state === 'recording'" :aria-busy="state === 'starting' || state === 'transcribing'" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="drag = null; captured = null" @click="click">
        <Square v-if="state === 'recording'" :size="20" /><LoaderCircle v-else-if="busy" class="voice-spinner" :size="23" /><Mic v-else :size="24" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.global-voice { position: fixed; z-index: 2500; color: var(--theme-core-text, #eee); font-size: 13px; max-width: calc(100vw - 16px); }
.voice-controls { position: relative; width: 48px; display: flex; gap: 6px; align-items: center; justify-content: flex-end; }
.global-voice button { cursor: pointer; color: inherit; border: 1px solid var(--theme-core-border, #545268); background: var(--theme-core-surface-muted, #2c2a3c); border-radius: 8px; padding: 7px 10px; }
.global-voice button:disabled { opacity: .5; cursor: default; }
.global-voice button:focus-visible { outline: 2px solid #b28aff; outline-offset: 3px; }
.global-voice .voice-mic { width: 48px; height: 48px; flex-shrink: 0; display: grid; place-items: center; border-radius: 50%; background: var(--theme-core-accent, #8251cb); color: var(--theme-core-bg, #10151f); box-shadow: 0 3px 14px #0005; touch-action: none; }
.global-voice .voice-mic.recording { background: #bd3549; color: white; }
.voice-secondary { opacity: 0; pointer-events: none; flex-shrink: 0; display: grid; place-items: center; width: 34px; height: 34px; }
.global-voice:hover .voice-secondary, .global-voice:focus-within .voice-secondary { opacity: 1; pointer-events: auto; }
.voice-status { position: fixed; right: 24px; bottom: 150px; max-width: calc(100vw - 48px); display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 6px 8px; background: var(--theme-core-surface-muted, #2c2a3c); border: 1px solid var(--theme-core-border, #545268); border-radius: 10px; }
.voice-status meter { width: 45px; }
.voice-panel { position: fixed; right: 24px; bottom: 160px; width: min(420px, calc(100vw - 32px)); max-height: calc(100vh - 182px); overflow-y: auto; border: 1px solid var(--theme-core-border, #545268); border-radius: 12px; padding: 16px; background: var(--theme-core-surface, #242232); box-shadow: 0 8px 32px #0006; }
.voice-panel header { display: flex; align-items: center; justify-content: space-between; }
.voice-panel p { line-height: 1.5; opacity: .85; }
.voice-panel textarea, .voice-panel input:not([type=checkbox]), .voice-panel select { box-sizing: border-box; width: 100%; background: var(--theme-core-surface-muted, #302e40); color: inherit; border: 1px solid var(--theme-core-border, #545268); border-radius: 6px; padding: 9px; margin: 5px 0; }
.voice-panel textarea { resize: vertical; min-height: 120px; }
.voice-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.voice-error { max-width: 380px; padding: 10px; margin-bottom: 8px; background: var(--theme-core-surface-muted, #2c2a3c); border: 1px solid #bd3549; border-radius: 8px; overflow-wrap: anywhere; }
.voice-error button { float: right; }
.voice-spinner { animation: voice-spin 1s linear infinite; }
@keyframes voice-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .voice-spinner { animation: none; } }
</style>
