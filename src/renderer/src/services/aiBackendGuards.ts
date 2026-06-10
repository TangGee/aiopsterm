import type {
  AiChatExportResult,
  AiCommandCatalog,
  AiCommandCatalogOption,
  AiContextCatalog,
  AiContextCategoryInfo,
  AiContextKind,
  AiContextOption,
  AiTodoItem,
  AiTodoSnapshot,
  AiTodoStatus,
  ChatAttachmentStageResult,
  ChatImageAttachmentMediaType,
  ChatImageAttachmentPrepareResult,
  VoiceTranscriptionProvider,
  VoiceTranscriptionResult
} from '@shared/preload'

export const malformedAiBackendResultMessage = 'AI 服务返回数据无效'

const aiContextKinds = new Set<AiContextKind>(['hosts', 'docs', 'images', 'skills', 'chats'])
const aiContextTypes = new Set(['file', 'dir', 'doc', 'image'])
const aiTodoStatuses = new Set<AiTodoStatus>(['pending', 'in_progress', 'completed'])
const chatImageMediaTypes = new Set<ChatImageAttachmentMediaType>(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const voiceProviders = new Set<VoiceTranscriptionProvider>(['aiopsterm-local', 'litellm', 'openai', 'bedrock', 'deepseek', 'anthropic', 'ollama'])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string'

const isOptionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean'

const isNonNegativeFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

const isNonNegativeInteger = (value: unknown): value is number => Number.isInteger(value) && isNonNegativeFiniteNumber(value)

export const isAiContextOptionData = (value: unknown): value is AiContextOption => {
  if (!isRecord(value)) return false
  if (!isNonEmptyString(value.id) || !aiContextKinds.has(value.kind as AiContextKind) || !isNonEmptyString(value.label)) return false
  if (!isOptionalString(value.detail) || !isOptionalString(value.relPath) || !isOptionalString(value.parentRelPath)) return false
  if (!isOptionalString(value.content) || !isOptionalString(value.mediaType) || !isOptionalString(value.data)) return false
  return value.contextType === undefined || aiContextTypes.has(String(value.contextType))
}

const isAiContextCategoryData = (value: unknown): value is AiContextCategoryInfo =>
  isRecord(value) &&
  aiContextKinds.has(value.id as AiContextKind) &&
  isNonEmptyString(value.label) &&
  Array.isArray(value.options) &&
  value.options.every(isAiContextOptionData)

export const isAiContextCatalogData = (value: unknown): value is AiContextCatalog =>
  isRecord(value) &&
  Array.isArray(value.categories) &&
  value.categories.every(isAiContextCategoryData) &&
  Array.isArray(value.openedHosts) &&
  value.openedHosts.every((host) => isAiContextOptionData(host) && host.kind === 'hosts') &&
  Array.isArray(value.selectedDefaults) &&
  value.selectedDefaults.every(isAiContextOptionData)

const isAiCommandCatalogOptionData = (value: unknown): value is AiCommandCatalogOption =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  isNonEmptyString(value.label) &&
  isNonEmptyString(value.name) &&
  isNonEmptyString(value.path) &&
  isNonEmptyString(value.command)

export const isAiCommandCatalogData = (value: unknown): value is AiCommandCatalog =>
  isRecord(value) && Array.isArray(value.commands) && value.commands.every(isAiCommandCatalogOptionData)

const isAiTodoSubtaskData = (value: unknown) =>
  isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.content) && isOptionalString(value.description)

const isAiTodoItemData = (value: unknown): value is AiTodoItem =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  isNonEmptyString(value.content) &&
  isOptionalString(value.description) &&
  aiTodoStatuses.has(value.status as AiTodoStatus) &&
  isOptionalBoolean(value.isFocused) &&
  (value.subtasks === undefined || (Array.isArray(value.subtasks) && value.subtasks.every(isAiTodoSubtaskData)))

export const isAiTodoSnapshotData = (value: unknown): value is AiTodoSnapshot => {
  if (!isRecord(value) || !Array.isArray(value.todos) || !value.todos.every(isAiTodoItemData)) return false
  if (!(value.focusedTodoId === null || isNonEmptyString(value.focusedTodoId))) return false
  if (!isNonNegativeInteger(value.totalTodos) || !isNonNegativeInteger(value.completedTodos)) return false
  if (value.totalTodos !== value.todos.length) return false
  if (value.completedTodos !== value.todos.filter((todo) => isRecord(todo) && todo.status === 'completed').length) return false
  if (value.focusedTodoId && !value.todos.some((todo) => isRecord(todo) && todo.id === value.focusedTodoId)) return false
  return value.source === 'backend' && typeof value.updatedAt === 'string'
}

export type AiChatExportData = NonNullable<AiChatExportResult['data']>

export const isAiChatExportData = (value: unknown): value is AiChatExportData => {
  if (!isRecord(value)) return false
  if (!isNonNegativeInteger(value.exported) || !isNonEmptyString(value.fileName)) return false
  if (!isOptionalString(value.filePath) || !isOptionalString(value.markdown) || !isOptionalBoolean(value.canceled)) return false
  return true
}

export const isChatAttachmentStageData = (value: unknown): value is ChatAttachmentStageResult =>
  isRecord(value) &&
  value.mode === 'local' &&
  isNonEmptyString(value.refPath) &&
  isNonEmptyString(value.name) &&
  isNonNegativeFiniteNumber(value.size) &&
  isNonEmptyString(value.stagedPath)

export type ChatImageAttachmentPrepareData = NonNullable<ChatImageAttachmentPrepareResult['data']>

export const isChatImageAttachmentPrepareData = (value: unknown): value is ChatImageAttachmentPrepareData =>
  isRecord(value) &&
  value.type === 'image' &&
  chatImageMediaTypes.has(value.mediaType as ChatImageAttachmentMediaType) &&
  isNonEmptyString(value.data) &&
  isOptionalString(value.name) &&
  isNonNegativeFiniteNumber(value.size)

export type VoiceTranscriptionData = NonNullable<VoiceTranscriptionResult['data']>

export const isVoiceTranscriptionData = (value: unknown): value is VoiceTranscriptionData =>
  isRecord(value) && isNonEmptyString(value.text) && voiceProviders.has(value.provider as VoiceTranscriptionProvider) && isOptionalString(value.model)
