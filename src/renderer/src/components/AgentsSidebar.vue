<template>
  <aside class="agents-sidebar">
    <header class="agents-workspace-header">
      <div class="agents-workspace-toolbar">
        <label class="agents-search">
          <Search />
          <input
            v-model="query"
            :placeholder="t('agents.searchSessions')"
            @keydown.esc.prevent="clearSearch"
          />
          <button
            v-if="query"
            class="agents-search-clear"
            :title="t('ai.clearSearch')"
            type="button"
            @click="clearSearch"
          >
            <X />
          </button>
        </label>
        <div
          class="agents-new-session-wrap"
          @click.stop
        >
          <button
            class="new-chat-btn"
            type="button"
            :class="{ active: newSessionMenuOpen }"
            :title="t('agents.newSession')"
            :aria-label="t('agents.newSession')"
            aria-haspopup="menu"
            :aria-expanded="newSessionMenuOpen"
            data-testid="agents-new-session-open"
            @click="newSessionMenuOpen = !newSessionMenuOpen"
          >
            <Plus />
          </button>
          <div
            v-if="newSessionMenuOpen"
            class="agents-new-session-menu"
            role="menu"
            data-testid="agents-new-session-menu"
          >
            <button
              type="button"
              role="menuitem"
              data-testid="agents-new-classic"
              @click="requestNewSession('classic')"
            >
              <Bot />
              <span>{{ t('agents.sessionType.classic') }}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="agents-new-codex"
              @click="requestNewSession('codex')"
            >
              <Code2 />
              <span>{{ t('agents.sessionType.codex') }}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="agents-new-database"
              @click="requestNewSession('database')"
            >
              <Database />
              <span>{{ t('agents.sessionType.database') }}</span>
            </button>
          </div>
        </div>
      </div>
    </header>

    <div class="agents-workspace-content">
      <div
        v-if="loading && sessions.length === 0"
        class="empty-state"
      >
        <LoaderCircle class="agents-session-loading" />
        <span class="empty-text">{{ t('agents.loadingSessions') }}</span>
      </div>
      <div
        v-else-if="visibleSessions.length === 0"
        class="empty-state"
      >
        <span class="empty-text">{{ catalogError || t('agents.noSessions') }}</span>
      </div>

      <div
        v-else
        class="conversation-list"
      >
        <div
          v-for="session in visibleSessions"
          :key="session.id"
          class="conversation-item product-session-item"
          :class="{ open: session.isOpen }"
          :data-session-id="session.id"
          :data-session-surface="session.surface"
        >
          <button
            class="product-session-main"
            type="button"
            :aria-label="sessionTitle(session)"
            @click="requestExistingSession(session)"
            @keydown.delete.prevent="requestDeleteSession(session)"
            @keydown.backspace.prevent="requestDeleteSession(session)"
          >
            <span
              class="product-session-icon"
              :data-surface="session.surface"
            >
              <component :is="surfaceIcon(session.surface)" />
              <i
                v-if="session.isOpen"
                class="product-session-open-dot"
                :title="t('agents.sessionOpen')"
              />
            </span>
            <div class="conversation-content">
              <div
                class="conversation-title"
                :title="sessionTitle(session)"
              >
                {{ sessionTitle(session) }}
              </div>
              <div class="conversation-meta">
                <span class="product-session-type">{{ surfaceLabel(session.surface) }}</span>
                <span
                  v-if="visibleBinding(session)"
                  class="product-session-binding"
                  :data-binding-kind="visibleBinding(session)?.kind"
                  :title="visibleBinding(session)?.tooltip"
                >
                  {{ visibleBinding(session)?.label }}
                </span>
                <span class="conversation-time">{{ formatSessionTime(session.updatedAt) }}</span>
              </div>
              <div
                v-if="visibleScopeLabel(session)"
                class="product-session-scope"
                :title="visibleScopeLabel(session)"
              >
                {{ visibleScopeLabel(session) }}
              </div>
            </div>
          </button>
          <button
            class="delete-btn"
            type="button"
            :title="t('agents.deleteSession')"
            :aria-label="`${t('agents.deleteSession')}: ${sessionTitle(session)}`"
            :disabled="deletingId === session.id"
            @click.stop="requestDeleteSession(session)"
          >
            <LoaderCircle v-if="deletingId === session.id" class="agents-session-loading" />
            <Trash2 v-else />
          </button>
        </div>

        <button
          v-if="hasMoreSessions"
          class="load-more-btn"
          type="button"
          @click="currentPage += 1"
        >
          {{ t('ai.loadMore') }}
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="pendingDeleteSession"
        class="agents-delete-dialog-backdrop"
        data-testid="agents-delete-dialog"
        @mousedown.self="cancelDeleteSession"
      >
        <section
          class="agents-delete-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="agents-delete-dialog-title"
          aria-describedby="agents-delete-dialog-description"
          @keydown.esc.stop.prevent="cancelDeleteSession"
        >
          <header>
            <span class="agents-delete-dialog-icon">
              <Trash2 />
            </span>
            <div>
              <strong id="agents-delete-dialog-title">{{ t('agents.deleteSession') }}</strong>
              <p id="agents-delete-dialog-description">
                {{
                  t('agents.deleteSessionConfirm', {
                    title: sessionTitle(pendingDeleteSession)
                  })
                }}
              </p>
            </div>
          </header>
          <footer>
            <button
              ref="deleteCancelButton"
              type="button"
              :disabled="Boolean(deletingId)"
              @click="cancelDeleteSession"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              class="danger"
              type="button"
              :disabled="Boolean(deletingId)"
              @click="confirmDeleteSession"
            >
              <LoaderCircle v-if="deletingId" class="agents-session-loading" />
              <Trash2 v-else />
              {{ t('common.delete') }}
            </button>
          </footer>
        </section>
      </div>
    </Teleport>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Bot, Code2, Database, LoaderCircle, Plus, Search, Trash2, X } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import { productSessionClient } from '@/services/ai/productSessionClient'
import type { ProductSessionRecord, ProductSessionSurface } from '@shared/contracts/productSessions'
import type { ProductSessionUiRequestInput } from '@/components/productSessionUiTypes'

const emit = defineEmits<{
  requestProductSession: [request: ProductSessionUiRequestInput]
}>()

const { locale, t } = useI18n()
const query = ref('')
const sessions = ref<ProductSessionRecord[]>([])
const loading = ref(false)
const catalogError = ref('')
const deletingId = ref('')
const pendingDeleteSession = ref<ProductSessionRecord | null>(null)
const deleteCancelButton = ref<HTMLButtonElement | null>(null)
const newSessionMenuOpen = ref(false)
const currentPage = ref(1)
const pageSize = 20
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let stopProductSessionChanges: (() => void) | undefined
let refreshRequestedWhileLoading = false

const sortedSessions = computed(() =>
  [...sessions.value].sort((first, second) => second.updatedAt - first.updatedAt || first.id.localeCompare(second.id))
)

type SessionBindingDisplay = {
  kind: 'host' | 'connection'
  value: string
  label: string
  tooltip: string
}

const normalizedLabel = (value?: string) => String(value || '').trim().toLocaleLowerCase()

const sessionTarget = (session: ProductSessionRecord) =>
  session.surface === 'classic' ? undefined : session.target

const classicHostRefs = (session: ProductSessionRecord) =>
  session.surface === 'classic'
    ? (
        session.classicContext?.terminalBindings ||
        session.classicContext?.contexts ||
        []
      ).filter((context) => context.kind === 'hosts')
    : []

const hostRefEndpoint = (host: ReturnType<typeof classicHostRefs>[number]) => {
  const hostname = String(host.host || '').trim()
  if (!hostname) return ''
  const endpointHost = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname
  return `${host.username ? `${host.username}@` : ''}${endpointHost}${host.port ? `:${host.port}` : ''}`
}

const hostRefLabel = (host: ReturnType<typeof classicHostRefs>[number]) =>
  String(host.label || host.detail || hostRefEndpoint(host) || host.host || host.connectionId || host.assetId || host.id).trim()

const targetEndpointFor = (target?: ProductSessionRecord['target']) => {
  const host = String(target?.host || '').trim()
  if (!host) return ''
  const endpointHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `${target?.username ? `${target.username}@` : ''}${endpointHost}${target?.port ? `:${target.port}` : ''}`
}

const targetEndpoint = (session: ProductSessionRecord) => targetEndpointFor(sessionTarget(session))

const rawSessionTitle = (session: ProductSessionRecord) => session.title.trim()
const fallbackSessionTitle = (session: ProductSessionRecord) =>
  session.surface === 'codex' ? t('ai.codexCliMode') : surfaceLabel(session.surface)

const sessionTitle = (session: ProductSessionRecord) => {
  const title = rawSessionTitle(session)
  if (session.surface !== 'codex' || !title) return title || fallbackSessionTitle(session)
  const target = sessionTarget(session)
  const legacyTargetTitles = [target?.assetName, target?.label, targetEndpoint(session), target?.host]
  return legacyTargetTitles.some((value) => normalizedLabel(value) === normalizedLabel(title))
    ? fallbackSessionTitle(session)
    : title
}

const sessionBinding = (session: ProductSessionRecord): SessionBindingDisplay | null => {
  if (session.surface === 'database') {
    const connectionId = String(session.database?.connectionId || '').trim()
    if (!connectionId) return null
    const label = `${t('database.field.connection')}: ${connectionId}`
    return { kind: 'connection', value: connectionId, label, tooltip: label }
  }

  const classicHosts = classicHostRefs(session)
  if (classicHosts.length) {
    const labels = classicHosts.map(hostRefLabel).filter(Boolean)
    if (!labels.length) return null
    const value = labels[0]
    const label = labels.length === 1 ? value : `${value} +${labels.length - 1}`
    const tooltip = classicHosts
      .map((host) => {
        const hostLabel = hostRefLabel(host)
        const endpoint = hostRefEndpoint(host)
        return endpoint && normalizedLabel(endpoint) !== normalizedLabel(hostLabel)
          ? `${hostLabel} (${endpoint})`
          : hostLabel
      })
      .filter(Boolean)
      .join(' · ')
    return { kind: 'host', value, label, tooltip }
  }

  const target = sessionTarget(session)
  if (!target) return null
  const endpoint = targetEndpoint(session)
  const value = String(
    target.assetName ||
    target.label ||
    endpoint ||
    target.host ||
    target.connectionId ||
    target.assetId ||
    ''
  ).trim()
  if (!value) return null
  const tooltip = endpoint && normalizedLabel(endpoint) !== normalizedLabel(value)
    ? `${t('terminal.tab.host')}: ${value} · ${endpoint}`
    : value
  return { kind: 'host', value, label: value, tooltip }
}

const sessionScopeLabel = (session: ProductSessionRecord) => {
  if (session.surface === 'database') {
    return [session.database?.databaseName, session.database?.schemaName]
      .filter(Boolean)
      .join(' / ')
  }
  return session.lastKnownCwd || session.projectRoot || ''
}

const visibleBinding = (session: ProductSessionRecord) => {
  const binding = sessionBinding(session)
  if (!binding) return null
  if (binding.kind === 'host' && normalizedLabel(binding.value) === normalizedLabel(sessionTitle(session))) return null
  return binding
}

const visibleScopeLabel = (session: ProductSessionRecord) => {
  const scope = sessionScopeLabel(session).trim()
  if (!scope) return ''
  const binding = sessionBinding(session)
  const duplicates = [sessionTitle(session), binding?.value, binding?.label]
    .some((value) => normalizedLabel(value) === normalizedLabel(scope))
  return duplicates ? '' : scope
}

const searchableText = (session: ProductSessionRecord) => {
  const targetValues = (target?: ProductSessionRecord['target']) => [
    target?.label,
    target?.assetName,
    target?.assetId,
    target?.connectionId,
    target?.host,
    target?.username,
    targetEndpointFor(target)
  ]
  return [
    session.title,
    session.id,
    surfaceLabel(session.surface),
    session.projectRoot,
    session.lastKnownCwd,
    ...(session.surface === 'classic' ? [] : targetValues(session.target)),
    ...classicHostRefs(session).flatMap((host) => [
      host.id,
      host.label,
      host.detail,
      host.assetId,
      host.connectionId,
      host.host,
      host.username,
      hostRefEndpoint(host)
    ]),
    session.database?.connectionId,
    session.database?.databaseName,
    session.database?.schemaName
  ].filter(Boolean).join(' ').toLowerCase()
}

const filteredSessions = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return sortedSessions.value
  return sortedSessions.value.filter((session) => searchableText(session).includes(keyword))
})

const visibleSessions = computed(() => filteredSessions.value.slice(0, currentPage.value * pageSize))
const hasMoreSessions = computed(() => visibleSessions.value.length < filteredSessions.value.length)

const surfaceIcon = (surface: ProductSessionSurface) => {
  if (surface === 'codex') return Code2
  if (surface === 'database') return Database
  return Bot
}

const surfaceLabel = (surface: ProductSessionSurface) => {
  if (surface === 'codex') return t('agents.sessionType.codex')
  if (surface === 'database') return t('agents.sessionType.database')
  return t('agents.sessionType.classic')
}

const formatSessionTime = (timestamp: number) => {
  const date = new Date(timestamp)
  const diff = Date.now() - date.getTime()
  const days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
  if (days === 0) return date.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
  if (days < 7) return t('ai.historyDaysAgo', { count: days })
  return date.toLocaleDateString(locale.value, { month: '2-digit', day: '2-digit' })
}

const refreshSessions = async () => {
  if (loading.value) {
    refreshRequestedWhileLoading = true
    return false
  }
  const listProductSessions = productSessionClient.list()
  if (!listProductSessions) {
    catalogError.value = t('agents.sessionsUnavailable')
    return false
  }
  loading.value = true
  try {
    const loaded: ProductSessionRecord[] = []
    const loadedIds = new Set<string>()
    const batchSize = 500
    let offset = 0
    while (true) {
      const result = await listProductSessions({ limit: batchSize, offset })
      if (!result?.ok || !Array.isArray(result.data?.sessions)) {
        catalogError.value = result?.errorMessage || t('agents.sessionsLoadFailed')
        return false
      }
      let added = 0
      for (const session of result.data.sessions) {
        if (loadedIds.has(session.id)) continue
        loadedIds.add(session.id)
        loaded.push(session)
        added += 1
      }
      if (result.data.sessions.length < batchSize || added === 0) break
      offset += result.data.sessions.length
    }
    sessions.value = loaded
    catalogError.value = ''
    return true
  } catch {
    catalogError.value = t('agents.sessionsLoadFailed')
    return false
  } finally {
    loading.value = false
    if (refreshRequestedWhileLoading) {
      refreshRequestedWhileLoading = false
      scheduleRefresh()
    }
  }
}

const scheduleRefresh = () => {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refreshSessions()
  }, 250)
}

const clearSearch = () => {
  query.value = ''
}

const requestNewSession = (surface: ProductSessionSurface) => {
  query.value = ''
  currentPage.value = 1
  newSessionMenuOpen.value = false
  emit('requestProductSession', { action: 'create', surface })
  scheduleRefresh()
}

const requestExistingSession = (session: ProductSessionRecord) => {
  emit('requestProductSession', {
    action: session.isOpen ? 'focus' : 'restore',
    surface: session.surface,
    sessionId: session.id
  })
  scheduleRefresh()
}

const requestDeleteSession = async (session: ProductSessionRecord) => {
  if (deletingId.value || pendingDeleteSession.value) return
  pendingDeleteSession.value = session
  await nextTick()
  deleteCancelButton.value?.focus()
}

const cancelDeleteSession = () => {
  if (deletingId.value) return
  pendingDeleteSession.value = null
}

const confirmDeleteSession = async () => {
  const session = pendingDeleteSession.value
  if (!session || deletingId.value) return
  const deleteProductSession = productSessionClient.delete()
  if (!deleteProductSession) {
    catalogError.value = t('agents.sessionsUnavailable')
    pendingDeleteSession.value = null
    return
  }
  deletingId.value = session.id
  try {
    const result = await deleteProductSession(session.id)
    const deleted = Boolean(result?.ok && result.data?.id === session.id && result.data.deleted)
    if (!deleted) {
      catalogError.value = result?.errorMessage || t('agents.sessionDeleteFailed')
      return
    }
    sessions.value = sessions.value.filter((candidate) => candidate.id !== session.id)
    if (visibleSessions.value.length === 0 && currentPage.value > 1) currentPage.value -= 1
    catalogError.value = ''
  } catch {
    catalogError.value = t('agents.sessionDeleteFailed')
  } finally {
    deletingId.value = ''
    pendingDeleteSession.value = null
  }
}

watch(query, () => {
  currentPage.value = 1
})

const closeNewSessionMenu = () => {
  newSessionMenuOpen.value = false
}

const handleWindowFocus = () => {
  void refreshSessions()
}

onMounted(() => {
  void refreshSessions()
  stopProductSessionChanges = productSessionClient.onChanged()?.(() => scheduleRefresh())
  window.addEventListener('focus', handleWindowFocus)
  document.addEventListener('click', closeNewSessionMenu)
})

onBeforeUnmount(() => {
  if (refreshTimer) clearTimeout(refreshTimer)
  stopProductSessionChanges?.()
  window.removeEventListener('focus', handleWindowFocus)
  document.removeEventListener('click', closeNewSessionMenu)
})

defineExpose({ refreshSessions })
</script>
