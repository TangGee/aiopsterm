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
          <small>{{ loadedRecordSummary }}</small>
        </div>
        <label class="managed-ai-session-record-search">
          <Search />
          <input
            v-model="query"
            :placeholder="t('aiSessions.content.searchRecords')"
          />
        </label>
      </div>

      <div
        ref="recordListRef"
        class="managed-ai-session-record-list"
        @scroll.passive="handleRecordListScroll"
      >
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
                class="danger"
                :title="t('common.delete')"
                :disabled="!canDeleteRecord(record)"
                @click="deleteRecord(record)"
              >
                <Trash2 />
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
          v-if="!loading && !loadingMore && filteredRecords.length === 0"
          class="managed-ai-session-content-empty"
        >
          {{ t('aiSessions.content.empty') }}
        </div>
        <div
          v-if="loading || loadingMore"
          class="managed-ai-session-content-empty"
        >
          {{ t('common.refreshing') }}
        </div>
      </div>
    </main>

    <footer class="managed-ai-session-content-status">
      <span>{{ loadedRecordSummary }}</span>
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
              <span v-else-if="saveNotice" class="notice">{{ saveNotice }}</span>
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
                class="danger"
                :disabled="!canDeleteRecord(modalRecord)"
                @click="deleteRecord(modalRecord)"
              >
                <Trash2 />
                <span>{{ t('common.delete') }}</span>
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
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, Maximize2, RefreshCw, RotateCcw, Save, Search, Trash2, X } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import { managedAiClient } from '@/services/ai/managedAiClient'
import { writeRendererRuntimeLog } from '@/services/app/runtimeLogClient'
import {
  isManagedAiSessionContentDeleteData,
  isManagedAiSessionContentRecordData,
  isManagedAiSessionContentSnapshot
} from '@/services/ai/managedAiBackendGuards'
import { managedAiSourceLabel } from '@/services/ai/aiSessionsPanelViewRuntime'
import type { ManagedAiSessionContentRecord, ManagedAiSessionContentSnapshot } from '@shared/contracts/managedAiSessionContent'
import type { AiAgentSessionSource } from '@shared/contracts/managedAiSessions'
import type { Ref } from 'vue'

type RecordDisplayRole = 'user' | 'assistant' | 'system' | 'developer' | 'tool' | 'metadata' | 'event' | 'reasoning' | 'file' | 'record'
type ContentLoadReason = 'initial' | 'refresh' | 'scroll' | 'fill' | 'search'
type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

const initialContentPageSize = 80
const contentPageSize = 120
const scrollLoadThresholdPx = 420
const searchPrefetchTarget = 20

const props = defineProps<{
  source: AiAgentSessionSource
  sessionId: string
  panelTitle?: string
}>()

const { t } = useI18n()
const snapshot = ref<ManagedAiSessionContentSnapshot | null>(null)
const contentRecords = ref<ManagedAiSessionContentRecord[]>([])
const query = ref('')
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const saveNotice = ref('')
const drafts = reactive<Record<string, string>>({})
const originals = reactive<Record<string, string>>({})
const fullRecords = reactive<Record<string, ManagedAiSessionContentRecord>>({})
const expandedRecordIds = ref<Set<string>>(new Set())
const loadingRecordIds = ref<Set<string>>(new Set())
const savingRecordIds = ref<Set<string>>(new Set())
const deletingRecordIds = ref<Set<string>>(new Set())
const activeRecordId = ref('')
const contentExhausted = ref(false)
const recordListRef = ref<HTMLElement | null>(null)
let contentLoadSeq = 0
let idleLoadHandle: number | null = null
let scrollFrameHandle: number | null = null

const sourceLabel = computed(() => managedAiSourceLabel(props.source))
const panelTitle = computed(() => props.panelTitle || `${sourceLabel.value} ${props.sessionId.slice(0, 8)}`)
const records = computed(() => contentRecords.value)
const recordsTotal = computed(() => snapshot.value?.total ?? records.value.length)
const hasMoreRecords = computed(() => !contentExhausted.value && records.value.length < recordsTotal.value)
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

const loadedRecordSummary = computed(() => {
  const total = recordsTotal.value
  const loaded = records.value.length
  const visible = filteredRecords.value.length
  if (query.value.trim()) return total > loaded ? `${visible} / ${loaded} / ${total}` : `${visible} / ${loaded}`
  return total > loaded ? `${loaded} / ${total}` : String(total)
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
const canDeleteRecord = (record: ManagedAiSessionContentRecord) => {
  const current = recordFor(record)
  return Boolean(current.editable && !deletingRecordIds.value.has(record.recordId) && !savingRecordIds.value.has(record.recordId))
}

const collapsedPreview = (content: string) => {
  const preview = content.split('\n').filter(Boolean).slice(0, 2).join('\n') || content
  return preview.length > 260 ? `${preview.slice(0, 260)}...` : preview
}

const formatCharCount = (count: number) => {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}

const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const roundedDuration = (startedAt: number) => Math.max(0, Math.round(perfNow() - startedAt))

const scheduleIdleTask = (callback: () => void) => {
  const idleWindow = window as IdleWindow
  if (idleWindow.requestIdleCallback) return idleWindow.requestIdleCallback(callback, { timeout: 240 })
  return window.setTimeout(callback, 32)
}

const cancelIdleLoad = () => {
  if (idleLoadHandle === null) return
  const idleWindow = window as IdleWindow
  if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idleLoadHandle)
  else window.clearTimeout(idleLoadHandle)
  idleLoadHandle = null
}

const cancelScrollFrame = () => {
  if (scrollFrameHandle === null) return
  window.cancelAnimationFrame(scrollFrameHandle)
  scrollFrameHandle = null
}

const mergeContentRecords = (existing: ManagedAiSessionContentRecord[], incoming: ManagedAiSessionContentRecord[]) => {
  const seen = new Set(existing.map((record) => record.recordId))
  const uniqueIncoming = incoming.filter((record) => {
    if (seen.has(record.recordId)) return false
    seen.add(record.recordId)
    return true
  })
  return [...existing, ...uniqueIncoming]
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
  contentLoadSeq += 1
  cancelIdleLoad()
  cancelScrollFrame()
  saveNotice.value = ''
  contentRecords.value = []
  contentExhausted.value = false
  Object.keys(drafts).forEach((id) => delete drafts[id])
  Object.keys(originals).forEach((id) => delete originals[id])
  Object.keys(fullRecords).forEach((id) => delete fullRecords[id])
  expandedRecordIds.value = new Set()
  loadingRecordIds.value = new Set()
  savingRecordIds.value = new Set()
  deletingRecordIds.value = new Set()
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

const removeRecordFromLocalState = (recordId: string) => {
  contentRecords.value = contentRecords.value.filter((record) => record.recordId !== recordId)
  delete drafts[recordId]
  delete originals[recordId]
  delete fullRecords[recordId]
  setSetMembership(expandedRecordIds, recordId, false)
  if (activeRecordId.value === recordId) activeRecordId.value = ''
  if (!snapshot.value) return
  snapshot.value = {
    ...snapshot.value,
    total: Math.max(0, snapshot.value.total - 1),
    limit: contentRecords.value.length,
    records: contentRecords.value
  }
}

const shouldLoadMoreForViewport = () => {
  const element = recordListRef.value
  if (!element) return false
  return element.scrollHeight - element.scrollTop - element.clientHeight <= scrollLoadThresholdPx
}

const maybeScheduleMoreRecords = (reason: ContentLoadReason) => {
  if (!hasMoreRecords.value || loading.value || loadingMore.value) return
  cancelIdleLoad()
  idleLoadHandle = scheduleIdleTask(() => {
    idleLoadHandle = null
    if (!hasMoreRecords.value || loading.value || loadingMore.value) return
    if (reason === 'fill' && !shouldLoadMoreForViewport()) return
    if (reason === 'search' && (!query.value.trim() || filteredRecords.value.length >= searchPrefetchTarget)) return
    void loadContentPage(reason)
  })
}

const afterContentPageRendered = () => {
  if (query.value.trim()) {
    if (filteredRecords.value.length < searchPrefetchTarget) maybeScheduleMoreRecords('search')
    return
  }
  maybeScheduleMoreRecords('fill')
}

const handleRecordListScroll = () => {
  if (scrollFrameHandle !== null) return
  scrollFrameHandle = window.requestAnimationFrame(() => {
    scrollFrameHandle = null
    if (shouldLoadMoreForViewport()) void loadContentPage('scroll')
  })
}

const loadContentPage = async (reason: ContentLoadReason, reset = false) => {
  const listContent = managedAiClient.listManagedAiSessionContent()
  if (!listContent) {
    error.value = t('aiSessions.notice.serviceUnavailable')
    return false
  }
  if (!reset && (loading.value || loadingMore.value)) return false
  const seq = reset ? ++contentLoadSeq : contentLoadSeq
  const startedAt = perfNow()
  let apiDurationMs = 0
  let logLevel: 'info' | 'warn' = 'info'
  let logEvent = 'renderer.managed-ai-content.load'
  let shouldLog = true
  const offset = reset ? 0 : records.value.length
  const limit = reset ? initialContentPageSize : contentPageSize
  const logFields: Record<string, unknown> = {
    source: props.source,
    sessionId: props.sessionId,
    reason,
    offset,
    limit
  }
  if (reset) {
    cancelIdleLoad()
    snapshot.value = null
    contentRecords.value = []
    contentExhausted.value = false
    loading.value = true
    loadingMore.value = false
  } else {
    loadingMore.value = true
  }
  error.value = ''
  try {
    const result = await listContent({
      source: props.source,
      sessionId: props.sessionId,
      offset,
      limit,
      maxContentChars: 1600
    })
    apiDurationMs = roundedDuration(startedAt)
    if (seq !== contentLoadSeq) {
      shouldLog = false
      return false
    }
    if (!result?.ok || !isManagedAiSessionContentSnapshot(result.data)) {
      logLevel = 'warn'
      logEvent = 'renderer.managed-ai-content.load.failed'
      logFields.errorCode = result?.errorCode
      logFields.errorMessage = result?.errorMessage || t('aiSessions.content.loadFailed')
      error.value = result?.errorMessage || t('aiSessions.content.loadFailed')
      return false
    }
    const nextRecords = reset
      ? result.data.records
      : mergeContentRecords(contentRecords.value, result.data.records)
    contentRecords.value = nextRecords
    contentExhausted.value = result.data.records.length === 0 || nextRecords.length >= result.data.total
    snapshot.value = {
      ...result.data,
      offset: 0,
      limit: nextRecords.length,
      records: nextRecords
    }
    syncDraftsFromRecords(nextRecords)
    logFields.format = result.data.format
    logFields.records = result.data.records.length
    logFields.total = result.data.total
    logFields.loadedRecords = nextRecords.length
    logFields.hasMore = !contentExhausted.value
    void nextTick().then(afterContentPageRendered)
    return true
  } catch (err) {
    if (seq !== contentLoadSeq) {
      shouldLog = false
      return false
    }
    apiDurationMs = apiDurationMs || roundedDuration(startedAt)
    logLevel = 'warn'
    logEvent = 'renderer.managed-ai-content.load.failed'
    logFields.errorMessage = err instanceof Error ? err.message : t('aiSessions.content.loadFailed')
    error.value = err instanceof Error ? err.message : t('aiSessions.content.loadFailed')
    return false
  } finally {
    if (seq === contentLoadSeq) {
      if (reset) loading.value = false
      else loadingMore.value = false
    }
    if (!shouldLog || seq !== contentLoadSeq) return
    const renderTickStartedAt = perfNow()
    void nextTick().then(() => {
      writeRendererRuntimeLog(logLevel, logEvent, {
        ...logFields,
        apiDurationMs,
        durationMs: roundedDuration(startedAt),
        renderSettleMs: roundedDuration(renderTickStartedAt)
      })
    })
  }
}

const loadContent = (reason: ContentLoadReason = 'initial') => loadContentPage(reason, true)

const reloadContentThroughRecordCount = async (minimumRecords: number, reason: ContentLoadReason) => {
  const reloaded = await loadContentPage(reason, true)
  if (!reloaded) return false
  while (hasMoreRecords.value && records.value.length < minimumRecords) {
    const loadedMore = await loadContentPage('fill')
    if (!loadedMore) return false
  }
  return true
}

const refreshContent = () => {
  if (!confirmDiscardChanges()) return
  void loadContent('refresh')
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
  const savedRecordId = record.recordId
  const minimumRecordsAfterSave = Math.max(records.value.length, initialContentPageSize)
  const previousScrollTop = recordListRef.value?.scrollTop ?? 0
  setSetMembership(savingRecordIds, record.recordId, true)
  error.value = ''
  saveNotice.value = ''
  let mutationSucceeded = false
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
    mutationSucceeded = true
    const savedRecord = result.data.record
    fullRecords[savedRecordId] = savedRecord
    drafts[savedRecordId] = savedRecord.content
    originals[savedRecordId] = savedRecord.content
    setSetMembership(expandedRecordIds, savedRecordId, true)
    if (!(await reloadContentThroughRecordCount(minimumRecordsAfterSave, 'refresh'))) return
    const refreshedRecord = records.value.find((item) => item.recordId === savedRecordId)
    if (!refreshedRecord || refreshedRecord.sourceRevision === savedRecord.sourceRevision) {
      fullRecords[savedRecordId] = savedRecord
      drafts[savedRecordId] = savedRecord.content
      originals[savedRecordId] = savedRecord.content
    }
    await nextTick()
    const recordList = recordListRef.value
    if (recordList) {
      recordList.scrollTop = Math.min(previousScrollTop, Math.max(0, recordList.scrollHeight - recordList.clientHeight))
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('aiSessions.content.saveFailed')
  } finally {
    setSetMembership(savingRecordIds, record.recordId, false)
    if (mutationSucceeded) saveNotice.value = t('aiSessions.content.saved')
  }
}

const deleteRecord = async (record: ManagedAiSessionContentRecord) => {
  const current = recordFor(record)
  if (!canDeleteRecord(record)) return
  if (!window.confirm(t('aiSessions.content.deleteConfirm'))) return
  const deleteContentRecord = managedAiClient.deleteManagedAiSessionContentRecord()
  if (!deleteContentRecord) {
    error.value = t('aiSessions.notice.serviceUnavailable')
    return
  }
  const deletedRecordId = record.recordId
  const minimumRecordsAfterDelete = Math.max(records.value.length - 1, initialContentPageSize)
  const previousScrollTop = recordListRef.value?.scrollTop ?? 0
  setSetMembership(deletingRecordIds, deletedRecordId, true)
  error.value = ''
  saveNotice.value = ''
  let mutationSucceeded = false
  try {
    const result = await deleteContentRecord({
      source: props.source,
      sessionId: props.sessionId,
      recordId: deletedRecordId,
      sourceRevision: current.sourceRevision
    })
    if (!result?.ok || !isManagedAiSessionContentDeleteData(result.data)) {
      error.value = result?.errorMessage || t('aiSessions.content.deleteFailed')
      return
    }
    mutationSucceeded = true
    removeRecordFromLocalState(deletedRecordId)
    if (!(await reloadContentThroughRecordCount(minimumRecordsAfterDelete, 'refresh'))) return
    await nextTick()
    const recordList = recordListRef.value
    if (recordList) {
      recordList.scrollTop = Math.min(previousScrollTop, Math.max(0, recordList.scrollHeight - recordList.clientHeight))
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('aiSessions.content.deleteFailed')
  } finally {
    setSetMembership(deletingRecordIds, deletedRecordId, false)
    if (mutationSucceeded) saveNotice.value = t('aiSessions.content.deleted')
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

watch(query, () => {
  cancelIdleLoad()
  if (query.value.trim() && hasMoreRecords.value && filteredRecords.value.length < searchPrefetchTarget) {
    maybeScheduleMoreRecords('search')
  }
})

onMounted(() => {
  void loadContent()
})

onBeforeUnmount(() => {
  contentLoadSeq += 1
  cancelIdleLoad()
  cancelScrollFrame()
})
</script>
