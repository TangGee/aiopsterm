<template>
  <section class="managed-ai-session-content">
    <header class="managed-ai-session-content-header">
      <div>
        <h3>{{ snapshot?.title || panelTitle }}</h3>
        <p>
          <span>{{ sourceLabel }}</span>
          <span>{{ sessionId }}</span>
          <span v-if="snapshot?.storagePath">{{ snapshot.storagePath }}</span>
        </p>
      </div>
      <div class="managed-ai-session-content-actions">
        <button
          type="button"
          :title="t('common.refresh')"
          :disabled="loading"
          @click="refreshContent"
        >
          <RefreshCw />
        </button>
      </div>
    </header>

    <div
      v-if="error"
      class="managed-ai-session-content-error"
    >
      {{ error }}
    </div>

    <main class="managed-ai-session-content-body">
      <div class="managed-ai-session-content-toolbar">
        <div class="managed-ai-session-record-summary">
          <span>{{ t('aiSessions.content.allRecords') }}</span>
          <small>{{ records.length }}</small>
        </div>
        <label class="managed-ai-session-record-search">
          <Search />
          <input
            v-model="query"
            :placeholder="t('aiSessions.content.searchRecords')"
          />
        </label>
      </div>

      <div class="managed-ai-session-record-list">
        <article
          v-for="record in filteredRecords"
          :key="record.recordId"
          class="managed-ai-session-record-card"
          :class="recordClass(record)"
        >
          <header class="managed-ai-session-record-card-header">
            <div class="managed-ai-session-record-meta">
              <span class="managed-ai-session-record-role">{{ recordDisplayLabel(record) }}</span>
              <span class="managed-ai-session-record-line">{{ record.locationLabel }}</span>
              <span v-if="recordTypeLabel(record)" class="managed-ai-session-record-type">{{ recordTypeLabel(record) }}</span>
              <span class="managed-ai-session-record-count">{{ formatCharCount(recordFor(record).fullLength) }}</span>
              <span v-if="!recordFor(record).editable" class="managed-ai-session-record-readonly">{{ t('aiSessions.content.readonly') }}</span>
              <span v-if="isRecordDirty(record)" class="managed-ai-session-record-warning">{{ t('aiSessions.content.unsaved') }}</span>
            </div>
            <div class="managed-ai-session-record-actions">
              <button
                type="button"
                :title="t('aiSessions.content.openLarge')"
                :disabled="loadingRecordIds.has(record.recordId)"
                @click="openRecordModal(record)"
              >
                <Maximize2 />
              </button>
              <button
                v-if="shouldCollapseRecord(record) && isRecordExpanded(record)"
                type="button"
                :title="t('aiSessions.content.collapse')"
                :disabled="loadingRecordIds.has(record.recordId)"
                @click="toggleRecordExpanded(record)"
              >
                <ChevronDown />
              </button>
              <button
                type="button"
                :title="t('aiSessions.content.reset')"
                :disabled="!isRecordDirty(record)"
                @click="resetRecord(record)"
              >
                <RotateCcw />
              </button>
              <button
                type="button"
                class="primary"
                :title="t('common.save')"
                :disabled="!canSaveRecord(record)"
                @click="saveRecord(record)"
              >
                <Save />
              </button>
            </div>
          </header>

          <div
            v-if="isRecordCollapsed(record)"
            class="managed-ai-session-record-preview-block"
          >
            <pre class="managed-ai-session-record-preview">{{ collapsedPreview(recordContent(record)) }}</pre>
            <button
              type="button"
              class="managed-ai-session-record-expand-inline"
              :disabled="loadingRecordIds.has(record.recordId)"
              @click="toggleRecordExpanded(record)"
            >
              <ChevronRight />
              <span>{{ t('aiSessions.content.expandFull') }}</span>
            </button>
          </div>
          <textarea
            v-else
            v-model="drafts[record.recordId]"
            spellcheck="false"
            :readonly="!recordFor(record).editable || recordFor(record).contentTruncated || savingRecordIds.has(record.recordId)"
            @focus="ensureFullRecord(record)"
            @keydown.meta.s.prevent="saveRecord(record)"
            @keydown.ctrl.s.prevent="saveRecord(record)"
          ></textarea>

          <footer
            v-if="recordFor(record).editBlockedReason"
            class="managed-ai-session-record-footer"
          >
            {{ recordFor(record).editBlockedReason }}
          </footer>
        </article>

        <div
          v-if="!loading && filteredRecords.length === 0"
          class="managed-ai-session-content-empty"
        >
          {{ t('aiSessions.content.empty') }}
        </div>
        <div
          v-if="loading"
          class="managed-ai-session-content-empty"
        >
          {{ t('common.refreshing') }}
        </div>
      </div>
    </main>

    <footer class="managed-ai-session-content-status">
      <span>{{ filteredRecords.length }} / {{ records.length }}</span>
      <span
        v-if="saveNotice"
        class="notice"
      >
        {{ saveNotice }}
      </span>
    </footer>

    <Teleport to="body">
      <div
        v-if="modalRecord"
        class="managed-ai-session-record-modal-backdrop"
        @click.self="closeRecordModal"
      >
        <section
          class="managed-ai-session-record-modal"
          :class="recordClass(modalRecord)"
          role="dialog"
          aria-modal="true"
          :aria-label="recordDisplayLabel(modalRecord)"
          @keydown.esc="closeRecordModal"
        >
          <header class="managed-ai-session-record-modal-header">
            <div class="managed-ai-session-record-meta">
              <span class="managed-ai-session-record-role">{{ recordDisplayLabel(modalRecord) }}</span>
              <span class="managed-ai-session-record-line">{{ modalRecord.locationLabel }}</span>
              <span v-if="recordTypeLabel(modalRecord)" class="managed-ai-session-record-type">{{ recordTypeLabel(modalRecord) }}</span>
              <span class="managed-ai-session-record-count">{{ formatCharCount(recordFor(modalRecord).fullLength) }}</span>
              <span v-if="!recordFor(modalRecord).editable" class="managed-ai-session-record-readonly">{{ t('aiSessions.content.readonly') }}</span>
              <span v-if="isRecordDirty(modalRecord)" class="managed-ai-session-record-warning">{{ t('aiSessions.content.unsaved') }}</span>
            </div>
            <div class="managed-ai-session-record-modal-actions">
              <button
                type="button"
                :title="t('common.close')"
                @click="closeRecordModal"
              >
                <X />
              </button>
            </div>
          </header>

          <div class="managed-ai-session-record-modal-body">
            <textarea
              v-model="drafts[modalRecord.recordId]"
              class="managed-ai-session-record-modal-editor"
              spellcheck="false"
              :readonly="!recordFor(modalRecord).editable || recordFor(modalRecord).contentTruncated || savingRecordIds.has(modalRecord.recordId)"
              @focus="ensureFullRecord(modalRecord)"
              @keydown.meta.s.prevent="saveRecord(modalRecord)"
              @keydown.ctrl.s.prevent="saveRecord(modalRecord)"
            ></textarea>
          </div>

          <footer class="managed-ai-session-record-modal-footer">
            <div class="managed-ai-session-record-modal-status">
              <span v-if="loadingRecordIds.has(modalRecord.recordId)">{{ t('aiSessions.content.loadingFull') }}</span>
              <span v-else-if="recordFor(modalRecord).editBlockedReason">{{ recordFor(modalRecord).editBlockedReason }}</span>
            </div>
            <div class="managed-ai-session-record-modal-footer-actions">
              <button
                type="button"
                @click="closeRecordModal"
              >
                {{ t('common.close') }}
              </button>
              <button
                type="button"
                :disabled="!isRecordDirty(modalRecord)"
                @click="resetRecord(modalRecord)"
              >
                <RotateCcw />
                <span>{{ t('aiSessions.content.reset') }}</span>
              </button>
              <button
                type="button"
                class="primary"
                :disabled="!canSaveRecord(modalRecord)"
                @click="saveRecord(modalRecord)"
              >
                <Save />
                <span>{{ t('common.save') }}</span>
              </button>
            </div>
          </footer>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, Maximize2, RefreshCw, RotateCcw, Save, Search, X } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import { managedAiClient } from '@/services/ai/managedAiClient'
import {
  isManagedAiSessionContentRecordData,
  isManagedAiSessionContentSnapshot
} from '@/services/ai/managedAiBackendGuards'
import { managedAiSourceLabel } from '@/services/ai/aiSessionsPanelViewRuntime'
import type { ManagedAiSessionContentRecord, ManagedAiSessionContentSnapshot } from '@shared/contracts/managedAiSessionContent'
import type { AiAgentSessionSource } from '@shared/contracts/managedAiSessions'
import type { Ref } from 'vue'

type RecordDisplayRole = 'user' | 'assistant' | 'system' | 'developer' | 'tool' | 'metadata' | 'event' | 'reasoning' | 'file' | 'record'

const props = defineProps<{
  source: AiAgentSessionSource
  sessionId: string
  panelTitle?: string
}>()

const { t } = useI18n()
const snapshot = ref<ManagedAiSessionContentSnapshot | null>(null)
const query = ref('')
const loading = ref(false)
const error = ref('')
const saveNotice = ref('')
const drafts = reactive<Record<string, string>>({})
const originals = reactive<Record<string, string>>({})
const fullRecords = reactive<Record<string, ManagedAiSessionContentRecord>>({})
const expandedRecordIds = ref<Set<string>>(new Set())
const loadingRecordIds = ref<Set<string>>(new Set())
const savingRecordIds = ref<Set<string>>(new Set())
const activeRecordId = ref('')

const sourceLabel = computed(() => managedAiSourceLabel(props.source))
const panelTitle = computed(() => props.panelTitle || `${sourceLabel.value} ${props.sessionId.slice(0, 8)}`)
const records = computed(() => snapshot.value?.records || [])
const modalRecord = computed(() => records.value.find((record) => record.recordId === activeRecordId.value) || null)

const normalizeRecordText = (record: ManagedAiSessionContentRecord) =>
  `${record.role} ${record.messageType} ${record.locationLabel}`.toLowerCase()

const recordDisplayRole = (record: ManagedAiSessionContentRecord): RecordDisplayRole => {
  if (record.role === 'user' || record.role === 'assistant' || record.role === 'system' || record.role === 'developer' || record.role === 'tool') return record.role
  const text = normalizeRecordText(record)
  if (record.format === 'events' || text.includes('event') || text.includes('task_')) return 'event'
  if (text.includes('reasoning') || text.includes('thinking')) return 'reasoning'
  if (text.includes('file-history') || text.includes('/files/') || text.includes('file')) return 'file'
  if (text.includes('session_meta') || text.includes('metadata') || text.includes('instruction') || text.includes('base_instructions')) return 'metadata'
  return 'record'
}

const filteredRecords = computed(() => {
  const text = query.value.trim().toLowerCase()
  return records.value.filter((record) => {
    if (!text) return true
    return [recordDisplayLabel(record), recordTypeLabel(record), record.messageType, record.locationLabel, recordContent(record)].some((value) =>
      String(value || '').toLowerCase().includes(text)
    )
  })
})

const toolRecordKind = (record: ManagedAiSessionContentRecord): 'call' | 'result' | '' => {
  const messageType = record.messageType.toLowerCase()
  if (messageType.startsWith('tool call')) return 'call'
  if (messageType.startsWith('tool result')) return 'result'
  return ''
}

const toolRecordName = (record: ManagedAiSessionContentRecord) => {
  const match = /^tool (?:call|result):\s*(.+)$/i.exec(record.messageType)
  return match?.[1]?.trim() || ''
}

const recordDisplayLabel = (record: ManagedAiSessionContentRecord) => {
  const role = recordDisplayRole(record)
  if (role === 'user') return t('aiSessions.content.role.user')
  if (role === 'assistant') return t('aiSessions.content.role.assistant')
  if (role === 'system') return t('aiSessions.content.role.system')
  if (role === 'developer') return t('aiSessions.content.role.developer')
  if (role === 'tool') {
    const kind = toolRecordKind(record)
    if (kind === 'call') return t('aiSessions.content.role.toolCall')
    if (kind === 'result') return t('aiSessions.content.role.toolResult')
    return t('aiSessions.content.role.tool')
  }
  if (role === 'metadata') return t('aiSessions.content.role.metadata')
  if (role === 'event') return t('aiSessions.content.role.event')
  if (role === 'reasoning') return t('aiSessions.content.role.reasoning')
  if (role === 'file') return t('aiSessions.content.role.file')
  return t('aiSessions.content.role.record')
}

const recordTypeLabel = (record: ManagedAiSessionContentRecord) => {
  const toolName = recordDisplayRole(record) === 'tool' ? toolRecordName(record) : ''
  return toolName || record.messageType
}

const recordFor = (record: ManagedAiSessionContentRecord) => fullRecords[record.recordId] || record
const recordContent = (record: ManagedAiSessionContentRecord) => drafts[record.recordId] ?? recordFor(record).content
const isRecordDirty = (record: ManagedAiSessionContentRecord) => (drafts[record.recordId] ?? '') !== (originals[record.recordId] ?? '')
const hasUnsavedChanges = computed(() => records.value.some(isRecordDirty))
const recordClass = (record: ManagedAiSessionContentRecord) => `role-${recordDisplayRole(record)}`

const setSetMembership = (target: Ref<Set<string>>, id: string, enabled: boolean) => {
  const next = new Set(target.value)
  if (enabled) {
    next.add(id)
  } else {
    next.delete(id)
  }
  target.value = next
}

const isRecordExpanded = (record: ManagedAiSessionContentRecord) => expandedRecordIds.value.has(record.recordId)
const shouldCollapseRecord = (record: ManagedAiSessionContentRecord) => {
  const role = recordDisplayRole(record)
  const current = recordFor(record)
  return (
    current.contentTruncated ||
    role === 'system' ||
    role === 'developer' ||
    role === 'metadata' ||
    role === 'event' ||
    role === 'tool' ||
    role === 'reasoning' ||
    role === 'file' ||
    current.fullLength > 1200
  )
}
const isRecordCollapsed = (record: ManagedAiSessionContentRecord) => shouldCollapseRecord(record) && !isRecordExpanded(record)
const canSaveRecord = (record: ManagedAiSessionContentRecord) => {
  const current = recordFor(record)
  return Boolean(current.editable && !current.contentTruncated && isRecordDirty(record) && !savingRecordIds.value.has(record.recordId))
}

const collapsedPreview = (content: string) => {
  const preview = content.split('\n').filter(Boolean).slice(0, 2).join('\n') || content
  return preview.length > 260 ? `${preview.slice(0, 260)}...` : preview
}

const formatCharCount = (count: number) => {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}

const syncDraftsFromRecords = (nextRecords: ManagedAiSessionContentRecord[]) => {
  const nextIds = new Set(nextRecords.map((record) => record.recordId))
  Object.keys(drafts).forEach((id) => {
    if (!nextIds.has(id)) delete drafts[id]
  })
  Object.keys(originals).forEach((id) => {
    if (!nextIds.has(id)) delete originals[id]
  })
  Object.keys(fullRecords).forEach((id) => {
    if (!nextIds.has(id)) delete fullRecords[id]
  })
  nextRecords.forEach((record) => {
    const previousOriginal = originals[record.recordId]
    const loadedFullRecord = fullRecords[record.recordId]
    if (loadedFullRecord && loadedFullRecord.sourceRevision !== record.sourceRevision) {
      delete fullRecords[record.recordId]
    }
    const syncRecord = loadedFullRecord?.sourceRevision === record.sourceRevision ? loadedFullRecord : record
    if (drafts[record.recordId] === undefined || drafts[record.recordId] === previousOriginal) {
      drafts[record.recordId] = syncRecord.content
    }
    originals[record.recordId] = syncRecord.content
  })
}

const clearRecordState = () => {
  Object.keys(drafts).forEach((id) => delete drafts[id])
  Object.keys(originals).forEach((id) => delete originals[id])
  Object.keys(fullRecords).forEach((id) => delete fullRecords[id])
  expandedRecordIds.value = new Set()
  loadingRecordIds.value = new Set()
  savingRecordIds.value = new Set()
  activeRecordId.value = ''
}

const confirmDiscardChanges = () => !hasUnsavedChanges.value || window.confirm(t('aiSessions.content.discardChanges'))

const ensureFullRecord = async (record: ManagedAiSessionContentRecord) => {
  if (!record.contentTruncated || fullRecords[record.recordId] || loadingRecordIds.value.has(record.recordId)) return recordFor(record)
  const getRecord = managedAiClient.getManagedAiSessionContentRecord()
  if (!getRecord) {
    error.value = t('aiSessions.notice.serviceUnavailable')
    return recordFor(record)
  }
  setSetMembership(loadingRecordIds, record.recordId, true)
  try {
    const result = await getRecord({
      source: props.source,
      sessionId: props.sessionId,
      recordId: record.recordId,
      maxContentChars: 1000000
    })
    if (!result?.ok || !isManagedAiSessionContentRecordData(result.data)) {
      error.value = result?.errorMessage || t('aiSessions.content.loadFailed')
      return recordFor(record)
    }
    fullRecords[record.recordId] = result.data.record
    if (!isRecordDirty(record)) drafts[record.recordId] = result.data.record.content
    originals[record.recordId] = result.data.record.content
    return result.data.record
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('aiSessions.content.loadFailed')
    return recordFor(record)
  } finally {
    setSetMembership(loadingRecordIds, record.recordId, false)
  }
}

const toggleRecordExpanded = async (record: ManagedAiSessionContentRecord) => {
  const expanded = isRecordExpanded(record)
  if (!expanded) {
    const ensured = await ensureFullRecord(record)
    if (ensured.contentTruncated) return
  }
  setSetMembership(expandedRecordIds, record.recordId, !expanded)
}

const openRecordModal = async (record: ManagedAiSessionContentRecord) => {
  activeRecordId.value = record.recordId
  await ensureFullRecord(record)
}

const closeRecordModal = () => {
  activeRecordId.value = ''
}

const resetRecord = (record: ManagedAiSessionContentRecord) => {
  drafts[record.recordId] = originals[record.recordId] ?? recordFor(record).content
}

const loadContent = async () => {
  const listContent = managedAiClient.listManagedAiSessionContent()
  if (!listContent) {
    error.value = t('aiSessions.notice.serviceUnavailable')
    return
  }
  loading.value = true
  error.value = ''
  saveNotice.value = ''
  try {
    const result = await listContent({
      source: props.source,
      sessionId: props.sessionId,
      limit: 500,
      maxContentChars: 1600
    })
    if (!result?.ok || !isManagedAiSessionContentSnapshot(result.data)) {
      error.value = result?.errorMessage || t('aiSessions.content.loadFailed')
      return
    }
    snapshot.value = result.data
    syncDraftsFromRecords(result.data.records)
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('aiSessions.content.loadFailed')
  } finally {
    loading.value = false
  }
}

const refreshContent = () => {
  if (!confirmDiscardChanges()) return
  void loadContent()
}

const saveRecord = async (record: ManagedAiSessionContentRecord) => {
  let current = recordFor(record)
  if (current.contentTruncated) current = await ensureFullRecord(record)
  if (!canSaveRecord(record)) return
  const updateRecord = managedAiClient.updateManagedAiSessionContentRecord()
  if (!updateRecord) {
    error.value = t('aiSessions.notice.serviceUnavailable')
    return
  }
  setSetMembership(savingRecordIds, record.recordId, true)
  error.value = ''
  saveNotice.value = ''
  try {
    const result = await updateRecord({
      source: props.source,
      sessionId: props.sessionId,
      recordId: record.recordId,
      content: drafts[record.recordId] ?? '',
      sourceRevision: current.sourceRevision
    })
    if (!result?.ok || !isManagedAiSessionContentRecordData(result.data)) {
      error.value = result?.errorMessage || t('aiSessions.content.saveFailed')
      return
    }
    fullRecords[record.recordId] = result.data.record
    drafts[record.recordId] = result.data.record.content
    originals[record.recordId] = result.data.record.content
    setSetMembership(expandedRecordIds, record.recordId, true)
    await loadContent()
    saveNotice.value = t('aiSessions.content.saved')
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('aiSessions.content.saveFailed')
  } finally {
    setSetMembership(savingRecordIds, record.recordId, false)
  }
}

watch(
  () => `${props.source}:${props.sessionId}`,
  () => {
    snapshot.value = null
    clearRecordState()
    void loadContent()
  }
)

onMounted(() => {
  void loadContent()
})
</script>
