<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from '@/i18n'
import { resolveTerminalFontFamily } from '@shared/terminalTypography'
import { isLocalTerminalFontAvailable, loadTerminalSymbolFont } from '@/services/terminal/terminalFontRuntime'

const props = defineProps<{
  value: string
  fonts: Array<{ value: string; label: string }>
  save: (value: string) => Promise<boolean>
}>()
const { t } = useI18n()
const custom = ref(false)
const name = ref('')
const saving = ref(false)
const missing = ref(false)
const selected = computed(() => custom.value ? '__custom__' : props.value)
const preview = 'AaBb 0123  \ue0b0  \uf07b  \uf126  \uf120  \udb80\udc04'

watch(() => props.value, (value) => {
  custom.value = !props.fonts.some((font) => font.value === value)
  missing.value = false
  if (custom.value) {
    try {
      const parsed: unknown = JSON.parse(value)
      name.value = typeof parsed === 'string' ? parsed : value
    } catch { name.value = value }
  }
}, { immediate: true })

onMounted(() => { void loadTerminalSymbolFont() })

const selectFont = async (event: Event) => {
  const select = event.target as HTMLSelectElement
  if (select.value === '__custom__') {
    custom.value = true
    missing.value = false
    return
  }
  saving.value = true
  try {
    if (await props.save(select.value)) custom.value = false
    else select.value = selected.value
  } finally { saving.value = false }
}

const saveCustomFont = async () => {
  const family = name.value.trim()
  if (!family || saving.value) return
  saving.value = true
  missing.value = false
  try {
    if (!await isLocalTerminalFontAvailable(family)) {
      missing.value = true
      return
    }
    await props.save(JSON.stringify(family))
  } finally { saving.value = false }
}
</script>

<template>
  <div class="terminal-font-settings">
    <div class="settings-form-row">
      <label for="terminal-font-select">{{ t('settings.terminal.font') }}</label>
      <select id="terminal-font-select" class="settings-select" :value="selected" :disabled="saving" @change="selectFont">
        <option v-for="font in fonts" :key="font.value" :value="font.value">{{ font.label }}</option>
        <option value="__custom__">{{ t('settings.terminal.customFont') }}</option>
      </select>
    </div>
    <form v-if="custom" class="settings-form-row" @submit.prevent="saveCustomFont">
      <label for="terminal-font-name">{{ t('settings.terminal.fontName') }}</label>
      <div class="terminal-font-input">
        <input id="terminal-font-name" v-model="name" class="settings-input" :disabled="saving" maxlength="200"
          :placeholder="t('settings.terminal.fontNamePlaceholder')" :aria-invalid="missing" aria-describedby="terminal-font-help terminal-font-error"
          @input="missing = false" />
        <button class="settings-button" type="submit" :disabled="saving || !name.trim()">{{ t('common.save') }}</button>
      </div>
    </form>
    <p id="terminal-font-help" class="settings-description">{{ t('settings.terminal.fontHelp') }}</p>
    <p v-if="missing" id="terminal-font-error" class="settings-description" role="alert">{{ t('settings.terminal.fontMissing') }}</p>
    <div class="terminal-font-preview" :style="{ fontFamily: resolveTerminalFontFamily(value) }" :aria-label="t('settings.terminal.fontPreview')">{{ preview }}</div>
  </div>
</template>

<style scoped>
.terminal-font-input { display: flex; flex: 1; gap: 8px; min-width: 0; }
.terminal-font-input input { flex: 1; min-width: 0; }
.terminal-font-preview { padding: 8px 0 16px; font-size: 18px; overflow-wrap: anywhere; }
</style>
