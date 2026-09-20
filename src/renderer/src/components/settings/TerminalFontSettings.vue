<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from '@/i18n'
import { resolveTerminalFontFamily } from '@shared/terminalTypography'
import { importedTerminalFontId, MAX_TERMINAL_FONT_BYTES, TERMINAL_FONT_EXTENSIONS, type ImportedTerminalFont } from '@shared/terminalFonts'
import { loadTerminalFonts } from '@/services/terminal/terminalFontRuntime'
import { localFilesClient } from '@/services/app/localFilesClient'

const props = defineProps<{
  value: string
  fonts: Array<{ value: string; label: string }>
  save: (value: string) => Promise<boolean>
}>()
const { t } = useI18n()
const saving = ref(false)
const importError = ref(false)
const importedFonts = ref<ImportedTerminalFont[]>([])
const fileInput = ref<HTMLInputElement>()
const unknownImportedFont = computed(() => importedTerminalFontId(props.value) && !importedFonts.value.some((font) => JSON.stringify(font.family) === props.value))
const unknownSavedFont = computed(() => !importedTerminalFontId(props.value) && !props.fonts.some((font) => font.value === props.value))
const preview = 'AaBb 0123  \ue0b0  \uf07b  \uf126  \uf120  \udb80\udc04'

watch(() => props.value, (value) => { void loadTerminalFonts(value) }, { immediate: true })

onMounted(async () => {
  try { importedFonts.value = await localFilesClient.listTerminalFonts()?.() || [] }
  catch { importError.value = true }
})

const importFont = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || saving.value) return
  saving.value = true
  importError.value = false
  try {
    if (!TERMINAL_FONT_EXTENSIONS.includes(file.name.split('.').pop()?.toLowerCase() || '') || file.size > MAX_TERMINAL_FONT_BYTES) throw new Error('Invalid font file')
    await new FontFace('AIOpsTerm Import Probe', await file.arrayBuffer()).load()
    const path = localFilesClient.getPathForFile()?.(file)
    const importFile = localFilesClient.importTerminalFont()
    if (!path || !importFile) throw new Error('Font import unavailable')
    const font = await importFile(path)
    const value = JSON.stringify(font.family)
    if (!await loadTerminalFonts(value)) throw new Error('Unable to load imported font')
    importedFonts.value = [...importedFonts.value.filter((item) => item.id !== font.id), font]
    if (!await props.save(value)) throw new Error('Unable to save font selection')
  } catch { importError.value = true }
  finally { saving.value = false; input.value = '' }
}

const selectFont = async (event: Event) => {
  const select = event.target as HTMLSelectElement
  const value = select.value
  importError.value = false
  saving.value = true
  try {
    if (!await loadTerminalFonts(value) && importedTerminalFontId(value)) {
      importError.value = true
      select.value = props.value
      return
    }
    if (!await props.save(value)) select.value = props.value
  } finally { saving.value = false }
}

</script>

<template>
  <div class="terminal-font-settings">
    <div class="settings-form-row">
      <label for="terminal-font-select">{{ t('settings.terminal.font') }}</label>
      <select id="terminal-font-select" class="settings-select" :value="value" :disabled="saving" @change="selectFont">
        <option v-for="font in fonts" :key="font.value" :value="font.value">{{ font.label }}</option>
        <option v-for="font in importedFonts" :key="font.id" :value="JSON.stringify(font.family)">{{ font.name }}</option>
        <option v-if="unknownImportedFont" :value="value">{{ t('settings.terminal.importedFont') }}</option>
        <option v-if="unknownSavedFont" :value="value" disabled>{{ value }}</option>
      </select>
    </div>
    <div class="settings-form-row">
      <button class="settings-button" type="button" :disabled="saving" @click="fileInput?.click()">{{ t('settings.terminal.importFont') }}</button>
      <input id="terminal-font-file" ref="fileInput" type="file" accept=".ttf,.otf,.woff,.woff2" hidden :disabled="saving" @change="importFont" />
    </div>
    <p id="terminal-font-help" class="settings-description">{{ t('settings.terminal.fontHelp') }}</p>
    <p v-if="importError" id="terminal-font-import-error" class="settings-description" role="alert">{{ t('settings.terminal.fontImportFailed') }}</p>
    <div class="terminal-font-preview" :style="{ fontFamily: resolveTerminalFontFamily(value) }" :aria-label="t('settings.terminal.fontPreview')">{{ preview }}</div>
  </div>
</template>

<style scoped>
.terminal-font-preview { padding: 8px 0 16px; font-size: 18px; overflow-wrap: anywhere; }
</style>
