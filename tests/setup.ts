import type {
  AiChatExportInput,
  DatabaseCatalogInfo,
  DatabaseColumnInfo,
  DatabaseConnectionInfo,
  DatabaseConnectionMoveInput,
  DatabaseCreateDatabaseInput,
  DatabaseConnectionSaveInput,
  DatabaseConnectionTestInput,
  DatabaseEngineCode,
  DatabaseEngineInfo,
  DatabaseExportInput,
  DatabaseGroupCreateInput,
  DatabaseGroupInfo,
  DatabaseGroupUpdateInput,
  DatabasePageCommentKey,
  DatabasePageCommentRecord,
  DatabaseAiDrawerRequestRecord,
  DatabaseAiPaneMessageRecord,
  DatabaseAiPaneStateSnapshot,
  DatabaseWorkspaceCatalog,
  DatabaseTableMutation,
  DatabaseTableMutationPlanInput,
  DatabaseTableInfo,
  AiTodoItem,
  AiTodoSnapshotResult,
  AiAgentSessionEvent,
  ManagedAiSessionEvent,
  McpServerUserConfig,
  SshAgentKeychainOption,
  TerminalKeyboardInteractiveRequest,
  TerminalKeyboardInteractiveResult
} from '@shared/preload'
import { parseAssetImportContent, type ImportedAssetDraft } from '@shared/assetImport'
import { buildChatExportMarkdown, sanitizeChatExportFileName } from '@shared/chatExport'
import { prepareChatImageAttachment, validateChatImageAttachment } from '@shared/chatImageAttachment'
import { buildDatabaseExportCsv, sanitizeDatabaseExportFileName } from '@shared/databaseExport'
import {
  DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_BASE64,
  DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_MIME,
  DEFAULT_KNOWLEDGE_SEED_SIZES,
  DEFAULT_KNOWLEDGE_USED_BYTES
} from '@shared/knowledgeBaseSeed'
import { defaultModelSettingsSeedData } from '@shared/modelSettingsSeed'
import { defaultWorkspacePreferencesSeedData } from '@shared/workspacePreferencesSeed'
import { createHash, scryptSync } from 'crypto'
import { vi } from 'vitest'

process.env.AIOPSTERM_WORKSPACE_PREFERENCES_ENABLE_SEED = '1'
process.env.AIOPSTERM_MODEL_SETTINGS_ENABLE_SEED = '1'

type TestAppUpdateProgressEvent = {
  status: 'downloading' | 'downloaded' | 'error'
  version: string
  percent: number
  message?: string
}

const appUpdateProgressListeners = new Set<(event: TestAppUpdateProgressEvent) => void>()
const aiAgentSessionEventListeners = new Set<(event: AiAgentSessionEvent) => void>()
const managedAiSessionEventListeners = new Set<(event: ManagedAiSessionEvent) => void>()
const terminalKeyboardInteractiveRequestListeners = new Set<(event: TerminalKeyboardInteractiveRequest) => void>()
const terminalKeyboardInteractiveResultListeners = new Set<(event: TerminalKeyboardInteractiveResult) => void>()

const emitAppUpdateProgressMock = (event: TestAppUpdateProgressEvent) => {
  appUpdateProgressListeners.forEach((listener) => listener(event))
}

;(globalThis as any).__emitTerminalKeyboardInteractiveRequestMock = (event: TerminalKeyboardInteractiveRequest) => {
  terminalKeyboardInteractiveRequestListeners.forEach((listener) => listener(event))
}

;(globalThis as any).__emitTerminalKeyboardInteractiveResultMock = (event: TerminalKeyboardInteractiveResult) => {
  terminalKeyboardInteractiveResultListeners.forEach((listener) => listener(event))
}

;(globalThis as any).__resetTerminalKeyboardInteractiveMock = () => {
  terminalKeyboardInteractiveRequestListeners.clear()
  terminalKeyboardInteractiveResultListeners.clear()
}

;(globalThis as any).__emitAiAgentSessionEventMock = (event: AiAgentSessionEvent) => {
  aiAgentSessionEventListeners.forEach((listener) => listener(event))
}

;(globalThis as any).__resetAiAgentSessionEventMock = () => {
  aiAgentSessionEventListeners.clear()
  managedAiSessionEventListeners.clear()
}

;(globalThis as any).__emitManagedAiSessionEventMock = (event: ManagedAiSessionEvent) => {
  managedAiSessionEventListeners.forEach((listener) => listener(event))
}

const defaultQuickCommands = {
  groups: [
    { id: 1, uuid: 'group-monitor', group_name: '巡检命令' },
    { id: 2, uuid: 'group-service', group_name: '服务运维' }
  ],
  snippets: [
    {
      id: 1,
      uuid: 'snippet-disk',
      snippet_name: '磁盘巡检',
      snippet_content: 'df -h\nsleep==1000\ndu -sh * | sort -h',
      group_uuid: 'group-monitor',
      create_at: '2026-06-01 10:00',
      update_at: '2026-06-02 09:20'
    },
    {
      id: 2,
      uuid: 'snippet-load',
      snippet_name: '负载快照',
      snippet_content: "uptime\nprintf '\\n=== cpu ===\\n'\ntop -b -n 1 | head -n 20",
      group_uuid: 'group-monitor',
      create_at: '2026-06-01 10:10',
      update_at: '2026-06-02 09:25'
    },
    {
      id: 3,
      uuid: 'snippet-nginx',
      snippet_name: 'Nginx 状态',
      snippet_content: 'systemctl status nginx\njournalctl -u nginx --since "30 minutes ago" | tail -n 80',
      group_uuid: 'group-service',
      create_at: '2026-06-01 10:20',
      update_at: '2026-06-02 09:30'
    },
    {
      id: 4,
      uuid: 'snippet-root',
      snippet_name: '当前目录',
      snippet_content: 'pwd\nls -la',
      group_uuid: null,
      create_at: '2026-06-01 10:30',
      update_at: '2026-06-02 09:35'
    }
  ]
}

type TestKnowledgeNode = {
  id: string
  key: string
  relPath: string
  title: string
  type: 'file' | 'dir'
  size?: number
  children?: TestKnowledgeNode[]
}

const defaultKnowledgeBase: { tree: TestKnowledgeNode[]; usedBytes: number; totalBytes: number } = {
  tree: [
    {
      id: 'kb-dir-commands',
      key: 'commands',
      relPath: 'commands',
      title: 'commands',
      type: 'dir',
      children: [
        {
          id: 'kb-file-rollback-plan',
          key: 'commands/rollback-plan.md',
          relPath: 'commands/rollback-plan.md',
          title: 'rollback-plan.md',
          type: 'file',
          size: DEFAULT_KNOWLEDGE_SEED_SIZES['commands/rollback-plan.md']
        },
        {
          id: 'kb-file-diagnose',
          key: 'commands/diagnose.md',
          relPath: 'commands/diagnose.md',
          title: 'diagnose.md',
          type: 'file',
          size: DEFAULT_KNOWLEDGE_SEED_SIZES['commands/diagnose.md']
        },
        {
          id: 'kb-file-summary',
          key: 'commands/Summary to Doc.md',
          relPath: 'commands/Summary to Doc.md',
          title: 'Summary to Doc.md',
          type: 'file',
          size: DEFAULT_KNOWLEDGE_SEED_SIZES['commands/Summary to Doc.md']
        }
      ]
    },
    {
      id: 'kb-dir-images',
      key: 'images',
      relPath: 'images',
      title: 'images',
      type: 'dir',
      children: [
        {
          id: 'kb-file-interface',
          key: 'images/interface.png',
          relPath: 'images/interface.png',
          title: 'interface.png',
          type: 'file',
          size: DEFAULT_KNOWLEDGE_SEED_SIZES['images/interface.png']
        }
      ]
    },
    {
      id: 'kb-file-markdown',
      key: 'Markdown语法指南.md',
      relPath: 'Markdown语法指南.md',
      title: 'Markdown语法指南.md',
      type: 'file',
      size: DEFAULT_KNOWLEDGE_SEED_SIZES['Markdown语法指南.md']
    }
  ],
  usedBytes: DEFAULT_KNOWLEDGE_USED_BYTES,
  totalBytes: 1073741824
}

const cloneKnowledgeTree = (nodes: TestKnowledgeNode[] = defaultKnowledgeBase.tree): TestKnowledgeNode[] =>
  nodes.map((node) => ({ ...node, children: node.children ? cloneKnowledgeTree(node.children as TestKnowledgeNode[]) : undefined }))

let knowledgeTreeMock = cloneKnowledgeTree()

Object.assign(globalThis, {
  __resetKnowledgeTreeMock: () => {
    knowledgeTreeMock = cloneKnowledgeTree()
  },
  __setKnowledgeTreeMock: (nodes: TestKnowledgeNode[]) => {
    knowledgeTreeMock = cloneKnowledgeTree(nodes)
  }
})

const getKnowledgeParent = (relPath: string) => {
  const parts = relPath.split('/').filter(Boolean)
  return parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
}

const getKnowledgeName = (relPath: string) => relPath.split('/').filter(Boolean).at(-1) || relPath

const createKnowledgeRelPath = (parentRelDir: string, name: string) => [parentRelDir, name].filter(Boolean).join('/')

const uniqueKnowledgeNameMock = (parentRelDir: string, name: string) => {
  const dotIndex = name.lastIndexOf('.')
  const base = dotIndex >= 0 ? name.slice(0, dotIndex) : name
  const ext = dotIndex >= 0 ? name.slice(dotIndex) : ''
  let candidate = name
  let index = 1
  while (findKnowledgeNodeMock(createKnowledgeRelPath(parentRelDir, candidate))) {
    candidate = `${base} (${index})${ext}`
    index += 1
  }
  return candidate
}

const findKnowledgeNodeMock = (relPath: string, nodes: TestKnowledgeNode[] = knowledgeTreeMock): TestKnowledgeNode | null => {
  for (const node of nodes) {
    if (node.relPath === relPath) return node
    if (node.children) {
      const hit = findKnowledgeNodeMock(relPath, node.children as TestKnowledgeNode[])
      if (hit) return hit
    }
  }
  return null
}

const removeKnowledgeNodeMock = (relPath: string, nodes: TestKnowledgeNode[] = knowledgeTreeMock): TestKnowledgeNode | null => {
  const index = nodes.findIndex((node) => node.relPath === relPath)
  if (index >= 0) {
    const [removed] = nodes.splice(index, 1)
    return removed
  }
  for (const node of nodes) {
    if (node.children) {
      const removed = removeKnowledgeNodeMock(relPath, node.children as TestKnowledgeNode[])
      if (removed) return removed
    }
  }
  return null
}

const insertKnowledgeNodeMock = (parentRelDir: string, node: TestKnowledgeNode) => {
  if (!parentRelDir) {
    knowledgeTreeMock.unshift(node)
    return
  }
  const parent = findKnowledgeNodeMock(parentRelDir)
  if (!parent || parent.type !== 'dir') return
  parent.children = (parent.children || []) as TestKnowledgeNode[]
  ;(parent.children as TestKnowledgeNode[]).unshift(node)
}

const updateKnowledgeNodePathsMock = (node: TestKnowledgeNode, oldPrefix: string, newPrefix: string) => {
  node.relPath = node.relPath.replace(oldPrefix, newPrefix)
  node.key = node.relPath
  node.title = getKnowledgeName(node.relPath)
  node.children?.forEach((child) => updateKnowledgeNodePathsMock(child, oldPrefix, newPrefix))
}

const listKnowledgeDirMock = (relDir: string) => {
  const source = relDir ? ((findKnowledgeNodeMock(relDir)?.children || []) as TestKnowledgeNode[]) : knowledgeTreeMock
  return source.map((node) => ({
    name: node.title,
    relPath: node.relPath,
    type: node.type,
    size: node.size,
    mtimeMs: 1717200000000
  }))
}

const createKnowledgeNodeMock = (kind: 'file' | 'dir', parentRelDir: string, name: string): TestKnowledgeNode => {
  const finalName = uniqueKnowledgeNameMock(parentRelDir, name)
  const relPath = createKnowledgeRelPath(parentRelDir, finalName)
  const node: TestKnowledgeNode = {
    id: `kb-${relPath.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    key: relPath,
    relPath,
    title: finalName,
    type: kind,
    ...(kind === 'file' ? { size: 1024 } : { children: [] })
  }
  insertKnowledgeNodeMock(parentRelDir, node)
  return node
}

const cloneKnowledgeNodeWithPaths = (node: TestKnowledgeNode, dstRelDir: string): TestKnowledgeNode => {
  const cloned = cloneKnowledgeTree([node])[0]
  const nextRelPath = createKnowledgeRelPath(dstRelDir, uniqueKnowledgeNameMock(dstRelDir, cloned.title))
  updateKnowledgeNodePathsMock(cloned, cloned.relPath, nextRelPath)
  return cloned
}

const defaultAliasCommands = [
  { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 },
  { id: 'alias-gst', alias: 'gst', command: 'git status', createdAt: 1717286400000 },
  { id: 'alias-kctx', alias: 'kctx', command: 'kubectl config current-context', createdAt: 1717372800000 }
]

type TestAliasCommand = {
  id: string
  alias: string
  command: string
  createdAt?: number
}

const cloneAliasCommands = (commands: TestAliasCommand[] = defaultAliasCommands) => commands.map((alias) => ({ ...alias }))

const defaultExtensionSettings = {
  autoCompleteStatus: true,
  quickVimStatus: true,
  aliasStatus: true,
  highlightStatus: true
}

type TestUserProfile = {
  uid: number
  name: string
  username: string
  avatarInitials: string
  avatarImageUrl: string
  registrationType: 'enterprise' | 'personal'
  registrationCode: 1 | 2 | 3 | 4 | 6 | 7 | 9
  authProvider: 'local' | 'sso' | 'oauth'
  subscription: 'free' | 'pro' | 'ultra'
  subscriptionExpiresAt: string
  email: string
  mobile: string
  localIp: string
  macAddress: string
  isOfficeDevice: boolean
  needDeviceVerification: boolean
  skippedLogin: boolean
  localDatabaseReady: boolean
  lastLoginMethod: 'account' | 'email' | 'mobile' | 'skip' | 'external'
  lastLoginAt: string
  passwordUpdatedAt: string
  avatarUpdatedAt: string
}

type TestTrustedDevice = {
  id: number
  deviceName: string
  macAddress: string
  lastLoginIp: string
  location: string
  lastLoginUserAgent: string
  current: boolean
}

const defaultUserProfile: TestUserProfile = {
  uid: 2001007,
  name: 'Local Operator',
  username: 'local_ops',
  avatarInitials: 'AI',
  avatarImageUrl: '',
  registrationType: 'personal',
  registrationCode: 9,
  authProvider: 'local',
  subscription: 'pro',
  subscriptionExpiresAt: '2026-12-31',
  email: 'operator@example.local',
  mobile: '13800000000',
  localIp: '127.0.0.1',
  macAddress: 'aa:bb:cc:dd:ee:ff',
  isOfficeDevice: true,
  needDeviceVerification: false,
  skippedLogin: false,
  localDatabaseReady: true,
  lastLoginMethod: 'account',
  lastLoginAt: '2026-06-04 10:30',
  passwordUpdatedAt: '2026-06-01 09:00',
  avatarUpdatedAt: '2026-06-01 09:00'
}

const defaultTrustedDevices: TestTrustedDevice[] = [
  {
    id: 1,
    deviceName: 'Linux Workstation',
    macAddress: 'aa:bb:cc:dd:ee:ff',
    lastLoginIp: '10.24.8.12',
    location: 'Shanghai',
    lastLoginUserAgent: 'Chrome/125 Linux',
    current: true
  },
  {
    id: 2,
    deviceName: 'MacBook',
    macAddress: '11:22:33:44:55:66',
    lastLoginIp: '10.18.3.42',
    location: 'Hangzhou',
    lastLoginUserAgent: 'Safari/17 macOS',
    current: false
  }
]

type TestUserAccountSnapshot = {
  profile: TestUserProfile
  trustedDevices: TestTrustedDevice[]
}

type TestUserAccountCredential = {
  username: string
  passwordHash: string
  salt: string
  updatedAt: string
  requiresDeviceVerification?: boolean
}

const cloneUserProfileMock = (profile: TestUserProfile): TestUserProfile => ({ ...profile })

const cloneTrustedDeviceMock = (device: TestTrustedDevice): TestTrustedDevice => ({ ...device })

const trimUserTextMock = (value: unknown) => String(value || '').trim()

const userCredentialKeyMock = (username: string) => trimUserTextMock(username).toLowerCase()

const userCredentialHashMock = (password: string, salt: string) => scryptSync(password, `tests/setup\0${salt}`, 32).toString('hex')

const createUserCredentialMock = (
  username: string,
  password: string,
  options: { salt?: string; updatedAt?: string; requiresDeviceVerification?: boolean } = {}
): TestUserAccountCredential => {
  const salt = options.salt || createHash('sha256').update(['tests/setup', userCredentialKeyMock(username)].join('\0')).digest('hex').slice(0, 32)
  return {
    username: trimUserTextMock(username),
    salt,
    passwordHash: userCredentialHashMock(password, salt),
    updatedAt: options.updatedAt || defaultUserProfile.passwordUpdatedAt,
    ...(options.requiresDeviceVerification ? { requiresDeviceVerification: true } : {})
  }
}

const defaultUserCredentialsMock = () => [
  createUserCredentialMock('ops_login', 'secret'),
  createUserCredentialMock('ops_return', 'secret'),
  createUserCredentialMock('privacy_ops', 'secret'),
  createUserCredentialMock('verify-device', 'secret', { requiresDeviceVerification: true })
]

let userProfileStoreMock = cloneUserProfileMock(defaultUserProfile)
let trustedDeviceStoreMock = defaultTrustedDevices.map(cloneTrustedDeviceMock)
let userCredentialStoreMock = defaultUserCredentialsMock()

type UserCodeCooldownScopeMock = 'login' | 'contact'
type UserCodeKindMock = 'email' | 'mobile'
const userCodeCooldownMsMock = 300_000
const userCodeCooldownStoreMock = new Map<string, { expiresAt: number; codeHash: string; attempts: number; debugCode: string }>()

const userTimestampMock = (value = new Date()) => {
  const pad = (input: number) => input.toString().padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`
}

const isValidUserEmailMock = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

const isValidUserMobileMock = (value: string) => /^1[3-9]\d{9}$/.test(value)

const userAvatarAssetUrlPatternMock = /^aiopsterm-user-avatar:\/\/[a-f0-9]{64}\.(png|jpg|gif|webp|bmp|svg)$/i

const userCodeCooldownKeyMock = (scope: UserCodeCooldownScopeMock, kind: UserCodeKindMock, target: string) =>
  [scope, kind, kind === 'email' ? target.toLowerCase() : target].join(':')

const userCodeChallengeIdMock = (scope: UserCodeCooldownScopeMock, kind: UserCodeKindMock, target: string) =>
  createHash('sha256')
    .update(['tests/setup', scope, kind, kind === 'email' ? target.toLowerCase() : target].join('\0'))
    .digest('hex')
    .slice(0, 24)

const remainingUserCodeCooldownSecondsMock = (expiresAt: number, now = Date.now()) => Math.max(0, Math.ceil((expiresAt - now) / 1000))

const userCodeValueMock = (scope: UserCodeCooldownScopeMock, kind: UserCodeKindMock) => {
  if (scope === 'login' && kind === 'email') return '246810'
  if (scope === 'login' && kind === 'mobile') return '135790'
  return '123456'
}

const userCodeHashMock = (scope: UserCodeCooldownScopeMock, kind: UserCodeKindMock, target: string, code: string) =>
  createHash('sha256')
    .update(['tests/setup', scope, kind, kind === 'email' ? target.toLowerCase() : target, code].join('\0'))
    .digest('hex')

const clearUserCodeCooldownMock = (scope: UserCodeCooldownScopeMock, kind: UserCodeKindMock, target: string) => {
  userCodeCooldownStoreMock.delete(userCodeCooldownKeyMock(scope, kind, target))
}

const issueUserCodeCooldownMock = (scope: UserCodeCooldownScopeMock, kind: UserCodeKindMock, target: string, message: string) => {
  const now = Date.now()
  const key = userCodeCooldownKeyMock(scope, kind, target)
  const active = userCodeCooldownStoreMock.get(key)
  const activeRemainingSeconds = active ? remainingUserCodeCooldownSecondsMock(active.expiresAt, now) : 0
  const expiresAt = activeRemainingSeconds > 0 ? active!.expiresAt : now + userCodeCooldownMsMock
  const remainingSeconds = activeRemainingSeconds > 0 ? activeRemainingSeconds : remainingUserCodeCooldownSecondsMock(expiresAt, now)
  if (activeRemainingSeconds <= 0) {
    const code = userCodeValueMock(scope, kind)
    userCodeCooldownStoreMock.set(key, {
      expiresAt,
      codeHash: userCodeHashMock(scope, kind, target, code),
      attempts: 0,
      debugCode: code
    })
  }
  return {
    ok: true as const,
    data: {
      challengeId: userCodeChallengeIdMock(scope, kind, target),
      kind,
      target,
      countdownSeconds: remainingSeconds,
      remainingSeconds,
      expiresAt,
      message: activeRemainingSeconds > 0 ? `验证码已发送，请 ${remainingSeconds} 秒后重试` : message
    }
  }
}

const verifyUserCodeMock = (scope: UserCodeCooldownScopeMock, kind: UserCodeKindMock, target: string, codeInput: string) => {
  const key = userCodeCooldownKeyMock(scope, kind, target)
  const active = userCodeCooldownStoreMock.get(key)
  if (!active) return userErrorMock('USER_CODE_NOT_SENT', '请先获取验证码')
  if (remainingUserCodeCooldownSecondsMock(active.expiresAt) <= 0) {
    userCodeCooldownStoreMock.delete(key)
    return userErrorMock('USER_CODE_EXPIRED', '验证码已过期，请重新获取')
  }
  const code = trimUserTextMock(codeInput).replace(/\s+/g, '')
  if (userCodeHashMock(scope, kind, target, code) !== active.codeHash) {
    const attempts = active.attempts + 1
    if (attempts >= 5) {
      userCodeCooldownStoreMock.delete(key)
      return userErrorMock('USER_CODE_LOCKED', '验证码错误次数过多，请重新获取')
    }
    userCodeCooldownStoreMock.set(key, { ...active, attempts })
    return userErrorMock('USER_CODE_INVALID', '验证码错误')
  }
  return null
}

const userPasswordScoreMock = (password: string) => {
  if (!password) return 0
  let score = password.length >= 8 ? 1 : 0
  if (/[A-Z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1
  return score
}

const findUserCredentialMock = (username: string) =>
  userCredentialStoreMock.find((credential) => userCredentialKeyMock(credential.username) === userCredentialKeyMock(username)) || null

const verifyUserCredentialPasswordMock = (credential: TestUserAccountCredential, password: string) =>
  credential.passwordHash === userCredentialHashMock(password, credential.salt)

const upsertUserCredentialMock = (username: string, password: string, options: { updatedAt?: string; requiresDeviceVerification?: boolean } = {}) => {
  const normalizedUsername = trimUserTextMock(username)
  if (!normalizedUsername) return
  const existing = findUserCredentialMock(normalizedUsername)
  const credential = createUserCredentialMock(normalizedUsername, password, {
    updatedAt: options.updatedAt || userTimestampMock(),
    requiresDeviceVerification: options.requiresDeviceVerification ?? existing?.requiresDeviceVerification
  })
  userCredentialStoreMock = existing
    ? userCredentialStoreMock.map((item) => (userCredentialKeyMock(item.username) === userCredentialKeyMock(normalizedUsername) ? credential : item))
    : [...userCredentialStoreMock, credential]
}

const renameCurrentUserCredentialMock = (previousUsername: string, nextUsername: string) => {
  const previousKey = userCredentialKeyMock(previousUsername)
  const nextKey = userCredentialKeyMock(nextUsername)
  if (!previousKey || !nextKey || previousKey === nextKey) return
  const existing = findUserCredentialMock(previousUsername)
  if (!existing) return
  userCredentialStoreMock = userCredentialStoreMock
    .filter((credential) => userCredentialKeyMock(credential.username) !== nextKey)
    .map((credential) => (userCredentialKeyMock(credential.username) === previousKey ? { ...credential, username: trimUserTextMock(nextUsername) } : credential))
}

const userAccountSnapshotMock = (): TestUserAccountSnapshot => ({
  profile: cloneUserProfileMock(userProfileStoreMock),
  trustedDevices: trustedDeviceStoreMock.map(cloneTrustedDeviceMock)
})

const userErrorMock = (errorCode: string, errorMessage: string) => ({
  ok: false as const,
  errorCode,
  errorMessage
})

const userSuccessMock = (message: string) => ({
  ok: true as const,
  data: {
    ...userAccountSnapshotMock(),
    message
  }
})

const userExternalActionSuccessMock = (action: 'login' | 'account-center', url = `https://accounts.aiopsterm.local/${action}`) => ({
  ok: true as const,
  data: {
    action,
    url,
    opened: true as const,
    openedAt: userTimestampMock(),
    message: action === 'login' ? '登录页面已打开' : '账号中心已打开'
  }
})

const applyUserProfileMock = (patch: Partial<TestUserProfile>) => {
  userProfileStoreMock = {
    ...userProfileStoreMock,
    ...patch
  }
}

const loginUserProfileMock = (patch: Partial<TestUserProfile>) => {
  applyUserProfileMock({
    ...patch,
    skippedLogin: false,
    needDeviceVerification: patch.needDeviceVerification ?? false,
    localDatabaseReady: true,
    lastLoginAt: userTimestampMock()
  })
}

const resetUserAccountStoreMock = () => {
  userProfileStoreMock = cloneUserProfileMock(defaultUserProfile)
  trustedDeviceStoreMock = defaultTrustedDevices.map(cloneTrustedDeviceMock)
  userCredentialStoreMock = defaultUserCredentialsMock()
  userCodeCooldownStoreMock.clear()
}

const deactivateUserAccountStoreMock = () => {
  userProfileStoreMock = {
    ...cloneUserProfileMock(defaultUserProfile),
    uid: 0,
    name: 'Local Operator',
    username: 'local_ops',
    email: '',
    mobile: '',
    subscription: 'free',
    subscriptionExpiresAt: '',
    skippedLogin: true,
    localDatabaseReady: false,
    needDeviceVerification: false,
    lastLoginMethod: 'skip',
    lastLoginAt: ''
  }
  trustedDeviceStoreMock = [cloneTrustedDeviceMock({ ...defaultTrustedDevices[0], id: 1, current: true })]
  userCredentialStoreMock = defaultUserCredentialsMock()
  userCodeCooldownStoreMock.clear()
}

const validateUserProfileUpdateMock = (input: Partial<Pick<TestUserProfile, 'name' | 'username' | 'avatarInitials' | 'avatarImageUrl'>>) => {
  const username = trimUserTextMock(input.username ?? userProfileStoreMock.username)
  const name = trimUserTextMock(input.name ?? userProfileStoreMock.name)
  if (!username || username.length < 6 || username.length > 20) return '用户名长度需要在 6 到 20 个字符之间'
  if (!/^[A-Za-z0-9_]+$/.test(username)) return '用户名仅支持字母、数字和下划线'
  if (!name || name.length > 20) return '姓名不能为空且不能超过 20 个字符'
  return ''
}

const canEditUserMobileMock = () => userProfileStoreMock.registrationCode !== 7

const canEditUserEmailMock = () => ![2, 3, 4, 6].includes(userProfileStoreMock.registrationCode)

const canResetUserPasswordMock = () => userProfileStoreMock.registrationCode !== 1 && userProfileStoreMock.authProvider !== 'sso'

const validateUserContactMock = (kind: 'email' | 'mobile', value: string) => {
  if (kind === 'email') {
    if (!canEditUserEmailMock()) return '当前登录方式不允许修改邮箱'
    if (!isValidUserEmailMock(value)) return '邮箱格式不正确'
    return ''
  }
  if (!canEditUserMobileMock()) return '当前登录方式不允许修改手机号'
  if (!isValidUserMobileMock(value)) return '手机号格式不正确'
  return ''
}

type TestExtensionPlugin = {
  pluginId: string
  name: string
  description: string
  iconKey: 'jumpserver' | 'alias' | 'runbook' | 'cloud' | 'private' | 'local'
  tabName: string
  show: boolean
  isPlugin: boolean
  installed: boolean
  hasUpdate: boolean
  installedVersion?: string
  latestVersion?: string
  installable?: boolean
  required?: boolean
  isDraggedOnly?: boolean
  source?: 'preinstalled' | 'store' | 'local'
  isPrivate?: boolean
  lastUpdated?: string
  storePackagePath?: string
  packagePath?: string
  packageUrl?: string
  packageSha256?: string
  subscriptionUrl?: string
  size?: number
  readme?: string
  categories?: string[]
  functions?: Array<{ title: string; desc: string }>
  detailSummary?: string
  guideSteps?: string[]
  connectionLog?: Array<{ time: string; status: 'progress' | 'success' | 'error'; message: string }>
}

const defaultExtensionPluginCatalog: TestExtensionPlugin[] = [
  {
    pluginId: 'jumpserverSupport',
    name: 'Jumpserver Support',
    description: '支持资产同步与资产直连',
    iconKey: 'jumpserver',
    tabName: 'jumpserverSupport',
    show: true,
    isPlugin: false,
    installed: false,
    hasUpdate: false,
    installedVersion: '',
    latestVersion: '',
    source: 'preinstalled',
    categories: ['SSH', 'Tools'],
    detailSummary: '支持资产同步与资产直连，保留堡垒机连接、目标资产连接、认证和代理阶段的运行状态。',
    functions: [
      { title: '资产同步', desc: '从堡垒机同步组织、主机和账号信息。' },
      { title: '资产直连', desc: '在终端中选择同步资产后直接建立 SSH 会话。' },
      { title: '认证联动', desc: '保留 Jumpserver 会话认证、审计和代理链路状态。' },
      { title: '同步状态', desc: '展示后端资产同步数量、数据源和已同步主机状态。' }
    ],
    guideSteps: [
      '在资产管理中新增 Jumpserver 数据源。',
      '填写堡垒机地址、组织和认证信息。',
      '同步资产并确认主机分组。',
      '从终端或文件管理中选择资产直连。'
    ]
  },
  {
    pluginId: 'Alias',
    name: 'Alias',
    description: '全局Alias配置',
    iconKey: 'alias',
    tabName: 'aliasConfig',
    show: true,
    isPlugin: false,
    installed: false,
    hasUpdate: false,
    installedVersion: '',
    latestVersion: '',
    source: 'preinstalled',
    categories: ['Tools']
  }
]

const extensionPluginStoreFixtureCatalog: TestExtensionPlugin[] = [
  {
    pluginId: 'ops-runbook',
    name: 'Ops Runbook',
    description: '本地维护流程和技能模板。',
    iconKey: 'runbook',
    tabName: 'Ops Runbook',
    show: true,
    isPlugin: true,
    installed: false,
    hasUpdate: false,
    installedVersion: '',
    latestVersion: '1.3.0',
    installable: true,
    source: 'store',
    lastUpdated: '2026-06-01',
    size: 1843200,
    readme: 'Ops Runbook 提供常用巡检、发布前检查和故障复盘模板，可在终端工作区中作为辅助流程打开。',
    categories: ['Tools', 'Runbook'],
    functions: [
      { title: '巡检模板', desc: '生成磁盘、负载、服务状态的检查清单。' },
      { title: '发布守卫', desc: '把发布前后验证步骤整理为可复用流程。' }
    ]
  },
  {
    pluginId: 'cloud-assets',
    name: 'Cloud Assets',
    description: '云资产发现和同步插件，需要真实 .external-reference 包后安装。',
    iconKey: 'cloud',
    tabName: 'Cloud Assets',
    show: true,
    isPlugin: true,
    installed: false,
    hasUpdate: false,
    installedVersion: '',
    latestVersion: '0.9.1',
    installable: true,
    source: 'store',
  lastUpdated: '2026-05-28',
  size: 2310144,
  packageUrl: 'https://aiopsterm.local/extensions/cloud-assets-0.9.1.external-reference',
  packageSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  readme: 'Cloud Assets 需要来自插件仓库或本地拖入的真实 .external-reference 包。未配置真实包时，后端不会模拟安装成功。',
    categories: ['Cloud', 'Assets'],
    functions: [
      { title: '云资产同步', desc: '按账号和地域拉取云主机列表。' },
      { title: '标签映射', desc: '把云标签映射到本地资产分组。' }
    ]
  },
  {
    pluginId: 'private-automation-pack',
    name: 'Private Automation Pack',
    description: '私有自动化插件，需要订阅后安装。',
    iconKey: 'private',
    tabName: 'Private Automation Pack',
    show: true,
    isPlugin: true,
    installed: false,
    hasUpdate: false,
    installedVersion: '',
    latestVersion: '2.0.0',
    installable: false,
    isPrivate: true,
    subscriptionUrl: 'https://aiopsterm.local/extensions/private-automation-pack',
    source: 'store',
    lastUpdated: '2026-05-20',
    size: 4194304,
    readme: '私有插件展示订阅入口；未订阅时不可直接安装。',
    categories: ['Private', 'Automation'],
    functions: [{ title: '订阅能力', desc: '开通后启用私有自动化任务模板。' }]
  }
]

type TestExtensionProgress = {
  pluginId: string
  stage: 'downloading' | 'verifying' | 'installing' | 'done' | 'error' | 'cancelled' | ''
  percent: number
  operation: 'install' | 'update' | 'uninstall' | 'package'
  message?: string
  requestId?: string
}

const extensionProgressListeners = new Set<(event: TestExtensionProgress) => void>()
const cancelledExtensionOperationIds = new Set<string>()

const cloneTestExtensionPlugin = (plugin: TestExtensionPlugin): TestExtensionPlugin => ({
  ...plugin,
  categories: plugin.categories ? [...plugin.categories] : undefined,
  functions: plugin.functions ? plugin.functions.map((item) => ({ ...item })) : undefined,
  guideSteps: plugin.guideSteps ? [...plugin.guideSteps] : undefined,
  connectionLog: plugin.connectionLog ? plugin.connectionLog.map((item) => ({ ...item })) : undefined
})

let extensionPluginStoreMock = defaultExtensionPluginCatalog.map(cloneTestExtensionPlugin)

const upsertExtensionPluginStoreMock = (plugin: TestExtensionPlugin) => {
  const next = cloneTestExtensionPlugin(plugin)
  const index = extensionPluginStoreMock.findIndex((item) => item.pluginId === next.pluginId)
  if (index >= 0) {
    extensionPluginStoreMock[index] = { ...extensionPluginStoreMock[index], ...next }
    return
  }
  extensionPluginStoreMock.push(next)
}

const resetExtensionPluginStoreMock = () => {
  extensionPluginStoreMock = defaultExtensionPluginCatalog.map(cloneTestExtensionPlugin)
  extensionProgressListeners.clear()
  cancelledExtensionOperationIds.clear()
}

const setExtensionPluginStoreMock = (plugins: TestExtensionPlugin[]) => {
  extensionPluginStoreMock = plugins.map(cloneTestExtensionPlugin)
}

const emitExtensionProgressMock = (event: TestExtensionProgress) => {
  extensionProgressListeners.forEach((listener) => listener(event))
}

const finishExtensionOperationMock = (
  operation: 'install' | 'update' | 'package',
  plugin: TestExtensionPlugin,
  delayMs = 120,
  requestId = ''
) =>
  new Promise((resolve) => {
    cancelledExtensionOperationIds.delete(plugin.pluginId)
    emitExtensionProgressMock({
      pluginId: plugin.pluginId,
      operation,
      stage: operation === 'package' ? 'installing' : 'downloading',
      percent: operation === 'package' ? 100 : 8,
      requestId: requestId || undefined
    })
    window.setTimeout(() => {
      if (cancelledExtensionOperationIds.has(plugin.pluginId)) {
        cancelledExtensionOperationIds.delete(plugin.pluginId)
        emitExtensionProgressMock({ pluginId: plugin.pluginId, operation, stage: 'cancelled', percent: 0, requestId: requestId || undefined })
        resolve({
          ok: false,
          errorCode: 'EXTENSION_PLUGIN_OPERATION_CANCELLED',
          errorMessage: 'Plugin operation cancelled.'
        })
        return
      }
      const next = cloneTestExtensionPlugin(plugin)
      next.installed = true
      next.hasUpdate = false
      next.installedVersion = next.latestVersion || next.installedVersion || '1.0.0'
      next.source = next.source || (operation === 'package' ? 'local' : 'store')
      upsertExtensionPluginStoreMock(next)
      emitExtensionProgressMock({ pluginId: next.pluginId, operation, stage: 'done', percent: 100, requestId: requestId || undefined })
      resolve({
        ok: true,
        data: {
          operation,
          plugin: next,
          message: `${next.name} ${operation === 'update' ? 'updated' : 'installed'} by test backend.`
        }
      })
    }, delayMs)
  })

const storePackageUnavailableMock = (plugin: TestExtensionPlugin) => ({
  ok: false,
  errorCode: 'EXTENSION_STORE_PACKAGE_UNAVAILABLE',
  errorMessage: `${plugin.name} requires a real .external-reference package before it can be installed.`
})

const createPackagePluginMock = (input: { fileName: string; filePath?: string; size?: number; existingPluginIds?: string[] }): TestExtensionPlugin => {
  const pluginName = input.fileName.replace(/\.external-reference$/i, '').replace(/[-_]+/g, ' ').trim() || 'Local Plugin'
  const slug = pluginName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin'
  const existing = input.existingPluginIds || []
  const baseId = `local-${slug}`
  let pluginId = baseId
  let index = 1
  while (existing.includes(pluginId)) pluginId = `${baseId}-${index++}`
  return {
    pluginId,
    name: pluginName,
    description: 'Installed from a local .external-reference package.',
    iconKey: 'local',
    tabName: pluginName,
    show: true,
    isPlugin: true,
    installed: false,
    hasUpdate: false,
    installedVersion: '',
    latestVersion: '',
    installable: true,
    isDraggedOnly: true,
    source: 'local',
    lastUpdated: 'Just now',
    size: input.size || 524288,
    readme: 'Local package installed through the aiopsterm backend plugin boundary.',
    categories: ['Local', 'Tools'],
    functions: [{ title: 'Local plugin', desc: 'Installed from a .external-reference package through the backend boundary.' }]
  }
}

const defaultDatabaseTableRows: Record<string, Array<Record<string, unknown>>> = {
  'conn-prod-pg:orders:public:orders': [
    { id: 1001, service: 'payment-api', status: 'investigating', owner: 'alice', updated_at: '2026-06-03 10:12:00' },
    { id: 1002, service: 'orders-worker', status: 'mitigated', owner: 'bob', updated_at: '2026-06-03 09:44:00' },
    { id: 1003, service: 'k8s-ingress', status: 'watching', owner: null, updated_at: '2026-06-02 22:01:00' },
    { id: 1004, service: 'billing-sync', status: 'closed', owner: 'carol', updated_at: '2026-06-02 18:22:00' }
  ],
  'conn-prod-pg:orders:public:open_orders_v': [
    { id: 1001, service: 'payment-api', status: 'investigating', owner: 'alice', updated_at: '2026-06-03 10:12:00' }
  ],
  'conn-prod-pg:orders:ops:ops_incidents': [
    { id: 9001, service: 'checkout', severity: 'P1', status: 'open', updated_at: '2026-06-03 11:18:00' },
    { id: 9002, service: 'search', severity: 'P2', status: 'triaged', updated_at: '2026-06-03 08:04:00' }
  ],
  'conn-prod-pg:orders:ops:active_incidents_v': [{ id: 9001, service: 'checkout', severity: 'P1', status: 'open', updated_at: '2026-06-03 11:18:00' }],
  'conn-metrics-mysql:metrics::service_health': [
    { id: 1, service: 'api-gateway', region: 'shanghai', latency_ms: 28, healthy: true },
    { id: 2, service: 'worker', region: 'hangzhou', latency_ms: 73, healthy: true },
    { id: 3, service: 'queue', region: 'shenzhen', latency_ms: 211, healthy: false }
  ],
  'conn-metrics-mysql:metrics::ops_incidents': [
    { id: 7001, service: 'metrics-api', severity: 'P2', status: 'watching', updated_at: '2026-06-03 07:52:00' },
    { id: 7002, service: 'prometheus', severity: 'P3', status: 'closed', updated_at: '2026-06-02 16:31:00' }
  ],
  'conn-metrics-mysql:metrics::metric_events': [
    { service: 'api-gateway', event_type: 'deploy', severity: 'info', created_at: '2026-06-03 10:42:00' },
    { service: 'queue', event_type: 'lag', severity: 'warning', created_at: '2026-06-03 10:58:00' }
  ],
  'conn-oracle-audit:ORCLPDB1:OPS:AUDIT_LOG': [
    { event_id: 501, actor: 'deploy-bot', action: 'RELEASE_START', created_at: '2026-06-03 08:10:00' },
    { event_id: 502, actor: 'ops-user', action: 'MANUAL_APPROVE', created_at: '2026-06-03 08:16:00' }
  ],
  'conn-local-cache:cache.db::cache_entries': [
    { key: 'session:1001', value: 'payment-api', ttl_seconds: 3600, updated_at: '2026-06-03 09:00:00' },
    { key: 'feature:rollout', value: 'enabled', ttl_seconds: null, updated_at: '2026-06-02 23:20:00' }
  ]
}

const defaultDatabaseTableDdl: Record<string, { ddl: string; error?: { code: 'permission' | 'other'; message: string } }> = {
  'conn-prod-pg:orders:public:orders': {
    ddl:
      'CREATE TABLE public.orders (\n  id BIGINT PRIMARY KEY,\n  service VARCHAR(80) NOT NULL,\n  status VARCHAR(32) NOT NULL,\n  owner VARCHAR(64),\n  updated_at TIMESTAMP NOT NULL\n);'
  },
  'conn-prod-pg:orders:public:open_orders_v': {
    ddl:
      'CREATE VIEW public.open_orders_v AS\nSELECT id, service, status, owner, updated_at\nFROM public.orders\nWHERE status <> \'closed\';',
    error: { code: 'permission', message: 'DDL requires elevated catalog permission.' }
  },
  'conn-prod-pg:orders:ops:ops_incidents': {
    ddl:
      'CREATE TABLE ops.ops_incidents (\n  id BIGINT PRIMARY KEY,\n  service VARCHAR(80) NOT NULL,\n  severity VARCHAR(16) NOT NULL,\n  status VARCHAR(32) NOT NULL,\n  updated_at TIMESTAMP NOT NULL\n);'
  },
  'conn-prod-pg:orders:ops:active_incidents_v': {
    ddl:
      'CREATE VIEW ops.active_incidents_v AS\nSELECT id, service, severity, status, updated_at\nFROM ops.ops_incidents\nWHERE status <> \'closed\';'
  },
  'conn-metrics-mysql:metrics::service_health': {
    ddl:
      'CREATE TABLE `service_health` (\n  `id` INT NOT NULL,\n  `service` VARCHAR(80) NOT NULL,\n  `region` VARCHAR(32) NOT NULL,\n  `latency_ms` INT NOT NULL,\n  `healthy` TINYINT NOT NULL,\n  PRIMARY KEY (`id`)\n);'
  },
  'conn-metrics-mysql:metrics::ops_incidents': {
    ddl:
      'CREATE TABLE `ops_incidents` (\n  `id` BIGINT NOT NULL,\n  `service` VARCHAR(80) NOT NULL,\n  `severity` VARCHAR(16) NOT NULL,\n  `status` VARCHAR(32) NOT NULL,\n  `updated_at` DATETIME NOT NULL,\n  PRIMARY KEY (`id`)\n);'
  },
  'conn-metrics-mysql:metrics::metric_events': {
    ddl:
      'CREATE TABLE `metric_events` (\n  `service` VARCHAR(80) NOT NULL,\n  `event_type` VARCHAR(32) NOT NULL,\n  `severity` VARCHAR(16) NOT NULL,\n  `created_at` DATETIME NOT NULL\n);'
  },
  'conn-oracle-audit:ORCLPDB1:OPS:AUDIT_LOG': {
    ddl:
      'CREATE TABLE OPS.AUDIT_LOG (\n  event_id NUMBER NOT NULL,\n  actor VARCHAR2(64) NOT NULL,\n  action VARCHAR2(64) NOT NULL,\n  created_at TIMESTAMP NOT NULL\n);'
  },
  'conn-local-cache:cache.db::cache_entries': {
    ddl:
      'CREATE TABLE cache_entries (\n  key TEXT PRIMARY KEY,\n  value TEXT,\n  ttl_seconds INTEGER,\n  updated_at TEXT NOT NULL\n);'
  }
}

const databaseEngineOptionsMock: DatabaseEngineInfo[] = [
  { code: 'mysql', connectionCode: 'mysql', name: 'MySQL', enabled: true, accent: '#00758f' },
  { code: 'oracle', connectionCode: 'oracle', name: 'Oracle', enabled: true, accent: '#c74634' },
  { code: 'postgresql', connectionCode: 'postgresql', name: 'PostgreSQL', enabled: true, accent: '#336791' },
  { code: 'sqlserver', connectionCode: 'sqlserver', name: 'SQLServer', enabled: true, accent: '#a91d22' },
  { code: 'sqlite', connectionCode: 'sqlite', name: 'SQLite', enabled: true, accent: '#00a1e0' },
  { code: 'mariadb', connectionCode: 'mariadb', name: 'MariaDB', enabled: true, accent: '#c0765c' },
  { code: 'clickhouse', connectionCode: 'clickhouse', name: 'ClickHouse', enabled: true, accent: '#fdd835' },
  { code: 'presto', connectionCode: 'presto', name: 'Presto', enabled: true, accent: '#7c2d12' },
  { code: 'oceanbase', connectionCode: 'oceanbase', name: 'OceanBase', enabled: true, accent: '#0ea5e9' },
  { code: 'kingbase', connectionCode: 'kingbase', name: 'KingBase', enabled: true, accent: '#dc2626' }
]

const databaseGroupsMock: DatabaseGroupInfo[] = [
  { id: 'group-default', name: 'Default Group' },
  { id: 'group-prod', name: 'Production' },
  { id: 'group-local', name: 'Local Lab' }
]

const databaseGroupParentsMock: Record<string, string | null> = {
  'group-default': null,
  'group-prod': null,
  'group-local': null
}

const ordersColumnsMock: DatabaseColumnInfo[] = [
  { name: 'id', type: 'bigint', nullable: false, key: 'PK' },
  { name: 'service', type: 'varchar(80)', nullable: false },
  { name: 'status', type: 'varchar(32)', nullable: false },
  { name: 'owner', type: 'varchar(64)', nullable: true },
  { name: 'updated_at', type: 'timestamp', nullable: false }
]

const incidentsColumnsMock: DatabaseColumnInfo[] = [
  { name: 'id', type: 'bigint', nullable: false, key: 'PK' },
  { name: 'service', type: 'varchar(80)', nullable: false },
  { name: 'severity', type: 'varchar(16)', nullable: false },
  { name: 'status', type: 'varchar(32)', nullable: false },
  { name: 'updated_at', type: 'datetime', nullable: false }
]

const serviceHealthColumnsMock: DatabaseColumnInfo[] = [
  { name: 'id', type: 'int', nullable: false, key: 'PK' },
  { name: 'service', type: 'varchar(80)', nullable: false },
  { name: 'region', type: 'varchar(32)', nullable: false },
  { name: 'latency_ms', type: 'int', nullable: false },
  { name: 'healthy', type: 'tinyint', nullable: false }
]

const metricEventsColumnsMock: DatabaseColumnInfo[] = [
  { name: 'service', type: 'varchar(80)', nullable: false },
  { name: 'event_type', type: 'varchar(32)', nullable: false },
  { name: 'severity', type: 'varchar(16)', nullable: false },
  { name: 'created_at', type: 'datetime', nullable: false }
]

const cacheColumnsMock: DatabaseColumnInfo[] = [
  { name: 'key', type: 'text', nullable: false, key: 'PK' },
  { name: 'value', type: 'text', nullable: true },
  { name: 'ttl_seconds', type: 'integer', nullable: true },
  { name: 'updated_at', type: 'text', nullable: false }
]

const oracleAuditColumnsMock: DatabaseColumnInfo[] = [
  { name: 'event_id', type: 'NUMBER', nullable: false },
  { name: 'actor', type: 'VARCHAR2(64)', nullable: false },
  { name: 'action', type: 'VARCHAR2(64)', nullable: false },
  { name: 'created_at', type: 'TIMESTAMP', nullable: false }
]

const databaseConnectionsMock: DatabaseConnectionInfo[] = [
  {
    id: 'conn-prod-pg',
    name: 'orders-postgres',
    dbType: 'postgresql',
    env: 'Production',
    groupId: 'group-prod',
    host: '10.32.6.9',
    port: 5432,
    authentication: 'UserAndPassword',
    user: 'readonly',
    hasPassword: true,
    database: 'orders',
    sslMode: 'require',
    url: 'jdbc:postgresql://10.32.6.9:5432/orders',
    status: 'connected',
    catalogs: [
      {
        name: 'orders',
        schemas: [
          {
            name: 'public',
            tables: [{ id: 'tbl-orders', name: 'orders', columns: ordersColumnsMock, primaryKey: ['id'] }],
            views: [{ id: 'view-public-open-orders', name: 'open_orders_v', columns: ordersColumnsMock, primaryKey: ['id'] }],
            functions: ['notify_order_owner(order_id bigint)', 'calculate_order_age(order_id bigint)'],
            procedures: ['archive_closed_orders(cutoff timestamp)']
          },
          {
            name: 'ops',
            tables: [{ id: 'tbl-pg-incidents', name: 'ops_incidents', columns: incidentsColumnsMock, primaryKey: ['id'] }],
            views: [{ id: 'view-ops-active-incidents', name: 'active_incidents_v', columns: incidentsColumnsMock, primaryKey: ['id'] }],
            functions: ['incident_priority(severity text)'],
            procedures: ['rotate_incident_partitions()']
          }
        ]
      }
    ]
  },
  {
    id: 'conn-metrics-mysql',
    name: 'metrics-mysql',
    dbType: 'mysql',
    env: 'Staging',
    groupId: 'group-default',
    host: '10.32.6.18',
    port: 3306,
    authentication: 'UserAndPassword',
    user: 'ops',
    hasPassword: true,
    database: 'metrics',
    url: 'jdbc:mysql://10.32.6.18:3306/metrics',
    status: 'idle',
    catalogs: [
      {
        name: 'metrics',
        tables: [
          { id: 'tbl-service-health', name: 'service_health', columns: serviceHealthColumnsMock, primaryKey: ['id'] },
          { id: 'tbl-mysql-incidents', name: 'ops_incidents', columns: incidentsColumnsMock, primaryKey: ['id'] },
          { id: 'tbl-metric-events', name: 'metric_events', columns: metricEventsColumnsMock, primaryKey: [] }
        ]
      }
    ]
  },
  {
    id: 'conn-oracle-audit',
    name: 'audit-oracle',
    dbType: 'oracle',
    env: 'TEST',
    groupId: 'group-default',
    host: '10.32.6.28',
    port: 1521,
    authentication: 'UserAndPassword',
    user: 'audit',
    hasPassword: true,
    database: 'ORCLPDB1',
    url: '10.32.6.28:1521/ORCLPDB1',
    status: 'connected',
    catalogs: [
      {
        name: 'ORCLPDB1',
        schemas: [
          {
            name: 'OPS',
            tables: [{ id: 'tbl-oracle-audit-log', name: 'AUDIT_LOG', columns: oracleAuditColumnsMock, primaryKey: [] }]
          }
        ]
      }
    ]
  },
  {
    id: 'conn-local-cache',
    name: 'local-cache',
    dbType: 'sqlite',
    env: 'Development',
    groupId: 'group-local',
    host: 'local',
    port: null,
    authentication: 'UserAndPassword',
    user: '',
    database: 'cache.db',
    filePath: '/tmp/aiopsterm/cache.db',
    readonly: true,
    url: 'sqlite:///tmp/aiopsterm/cache.db',
    status: 'idle',
    catalogs: [
      {
        name: 'cache.db',
        tables: [{ id: 'tbl-cache-entries', name: 'cache_entries', columns: cacheColumnsMock, primaryKey: ['key'] }]
      }
    ]
  }
]

let databaseTableRowsMock = cloneDatabaseTableRows()
let databaseTableColumnsMock = cloneDatabaseTableColumns()
let databaseTableDdlMock = cloneDatabaseTableDdl()
let databaseAiPaneRequestSequenceMock = 1
let databaseAiDrawerRequestSequenceMock = 1
const databaseAiPaneMessagesMock = new Map<string, DatabaseAiPaneMessageRecord>()
const databaseAiDrawerRequestsMock = new Map<string, DatabaseAiDrawerRequestRecord>()
const databasePageCommentsMock = new Map<string, DatabasePageCommentRecord>()
const defaultDatabaseAiPaneStateMock = (): DatabaseAiPaneStateSnapshot => ({
  open: false,
  width: 360,
  context: {
    connectionId: '',
    catalogName: '',
    schemaName: '',
    dbType: ''
  },
  draft: '',
  messages: []
})
let databaseAiPaneStateMock = defaultDatabaseAiPaneStateMock()
let aiChatExchangeRequestSequenceMock = 1
const cancelledAiChatResponseKeysMock = new Set<string>()
let kubernetesTerminalSequenceMock = 1
type TestKubernetesTerminalRecord = {
  id: string
  sessionId: string
  clusterId: string
  name: string
  namespace: string
  output: string
  status: 'connecting' | 'connected' | 'ended' | 'error'
  cols: number
  rows: number
  createdAt: string
  updatedAt: string
}
type TestKubernetesTerminalDataEvent = {
  id: string
  sessionId: string
  clusterId: string
  data: string
  command: string
  output: string
  success: boolean
  error: string
  emittedAt: string
}
type TestKubernetesTerminalExitEvent = {
  id: string
  sessionId: string
  clusterId: string
  exitCode: number
  reason: 'closed' | 'disconnect' | 'error'
  error?: string
  emittedAt: string
}
let kubernetesTerminalSessionsMock: TestKubernetesTerminalRecord[] = []
const kubernetesTerminalDataListenersMock = new Set<(event: TestKubernetesTerminalDataEvent) => void>()
const kubernetesTerminalExitListenersMock = new Set<(event: TestKubernetesTerminalExitEvent) => void>()

;(globalThis as any).__emitKubernetesTerminalExitMock = (event: TestKubernetesTerminalExitEvent) => {
  kubernetesTerminalExitListenersMock.forEach((listener) => listener(event))
}

;(globalThis as any).__emitKubernetesTerminalDataMock = (event: TestKubernetesTerminalDataEvent) => {
  kubernetesTerminalDataListenersMock.forEach((listener) => listener(event))
}

const aiChatRequestIdFromAssistantMessageIdMock = (assistantMessageId?: string) => {
  const normalized = String(assistantMessageId || '').trim()
  return normalized.endsWith('-assistant') ? normalized.slice(0, -'-assistant'.length) : ''
}

const aiChatResponseKeysMock = (input: { requestId?: string; assistantMessageId?: string }) => {
  const assistantMessageId = String(input.assistantMessageId || '').trim()
  const requestId = String(input.requestId || '').trim() || aiChatRequestIdFromAssistantMessageIdMock(assistantMessageId)
  return [
    requestId ? `request:${requestId}` : '',
    assistantMessageId ? `assistant:${assistantMessageId}` : ''
  ].filter(Boolean)
}

function cloneDatabaseTableRows() {
  return Object.fromEntries(Object.entries(defaultDatabaseTableRows).map(([key, rows]) => [key, rows.map((row) => ({ ...row }))]))
}

function cloneDatabaseTableColumns() {
  return Object.fromEntries(Object.entries(defaultDatabaseTableRows).map(([key, rows]) => [key, Object.keys(rows[0] || {})]))
}

function cloneDatabaseTableDdl() {
  return Object.fromEntries(
    Object.entries(defaultDatabaseTableDdl).map(([key, entry]) => [key, { ddl: entry.ddl, error: entry.error ? { ...entry.error } : undefined }])
  )
}

function resetDatabaseTableRowsMock() {
  databaseTableRowsMock = cloneDatabaseTableRows()
  databaseTableColumnsMock = cloneDatabaseTableColumns()
  databaseTableDdlMock = cloneDatabaseTableDdl()
  databaseAiPaneRequestSequenceMock = 1
  databaseAiDrawerRequestSequenceMock = 1
  databaseAiPaneMessagesMock.clear()
  databaseAiPaneStateMock = defaultDatabaseAiPaneStateMock()
  databaseAiDrawerRequestsMock.clear()
  databasePageCommentsMock.clear()
  resetDatabaseConnectionsMock()
}

function databasePageCommentKeyMock(key: DatabasePageCommentKey) {
  return [
    key.scope,
    key.connectionId,
    key.databaseName,
    key.schemaName || '',
    key.tableName || '',
    key.resultId || '',
    key.sql || ''
  ].join('\u001f')
}

function databaseTableKey(input: { connectionId: string; databaseName: string; schemaName?: string; tableName: string }) {
  const candidates = [
    `${input.connectionId}:${input.databaseName}:${input.schemaName || ''}:${input.tableName}`,
    `${input.connectionId}:${input.databaseName}::${input.tableName}`
  ]
  return candidates.find((key) => databaseTableRowsMock[key]) || candidates[0]
}

function databaseDdlKey(input: { connectionId: string; databaseName: string; schemaName?: string; tableName: string }) {
  const exact = databaseTableKey(input)
  if (databaseTableDdlMock[exact]) return exact
  return (
    Object.keys(databaseTableDdlMock).find((key) => {
      const [, databaseName, schemaName, tableName] = key.split(':')
      return databaseName === input.databaseName && schemaName === (input.schemaName || '') && tableName === input.tableName
    }) || exact
  )
}

function databaseCatalogTableExistsMock(input: { connectionId: string; databaseName: string; schemaName?: string; tableName: string }) {
  const key = `${input.connectionId}:${input.databaseName}:${input.schemaName || ''}:${input.tableName}`
  return Object.prototype.hasOwnProperty.call(databaseTableRowsMock, key) || Object.prototype.hasOwnProperty.call(databaseTableDdlMock, key)
}

const unquoteDatabaseSqlIdentifierMock = (value: string) =>
  value.replace(/^[`"\[]|[`"\]]$/g, '').replace(/""/g, '"').replace(/``/g, '`').replace(/]]/g, ']')

const databaseTableNameFromSqlMock = (sql: string) => {
  const match = sql.match(/\bfrom\s+([`"\[]?[\w.-]+[`"\]]?(?:\s*\.\s*[`"\[]?[\w.-]+[`"\]]?)?)/i)
  if (!match) return ''
  return (
    match[1]
      .split('.')
      .map((part) => unquoteDatabaseSqlIdentifierMock(part.trim()))
      .filter(Boolean)
      .at(-1) || ''
  )
}

const databaseSchemaNameFromSqlMock = (sql: string) => {
  const match = sql.match(/\bfrom\s+([`"\[]?[\w.-]+[`"\]]?)\s*\.\s*([`"\[]?[\w.-]+[`"\]]?)/i)
  return match ? unquoteDatabaseSqlIdentifierMock(match[1].trim()) : ''
}

const databaseRowsForSqlMock = (input: { sql: string; connectionId: string; databaseName?: string; schemaName?: string }) => {
  const tableName = databaseTableNameFromSqlMock(input.sql)
  const schemaName = databaseSchemaNameFromSqlMock(input.sql) || input.schemaName || ''
  const rows = tableName
    ? databaseTableRowsMock[databaseTableKey({ connectionId: input.connectionId, databaseName: input.databaseName || '', schemaName, tableName })]
    : null
  if (/^explain\b/i.test(input.sql)) {
    if (tableName && !rows) return { ok: false as const, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${tableName}` }
    return {
      ok: true as const,
      rows: [
        { step: 1, operation: tableName ? 'Seq Scan' : 'Result', relation: tableName || 'derived', cost: '0.00..12.40', rows: rows?.length ?? 1 },
        { step: 2, operation: 'Limit', relation: 'result', cost: '0.00..1.00', rows: 1 }
      ]
    }
  }
  if (rows) return { ok: true as const, rows: rows.map((row) => ({ ...row })) }
  const constant = input.sql.replace(/\s+/g, ' ').trim().replace(/;$/, '').match(/^select\s+1(?:\s+as\s+([A-Za-z_][\w$]*))?$/i)
  if (constant) return { ok: true as const, rows: [{ [constant[1] || 'result']: 1 }] }
  if (/\bfrom\b/i.test(input.sql)) return { ok: false as const, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${tableName || 'unknown'}` }
  return {
    ok: false as const,
    errorCode: 'DB_SQL_UNSUPPORTED',
    errorMessage: 'Seed database SQL execution supports backend-known tables or SELECT 1 only.'
  }
}

let databaseSqlExecutionSeqMock = 0

const createDatabaseSqlExecutionMock = (input: { status: 'ok' | 'error'; message: string; durationMs?: number; rowCount?: number }) => {
  databaseSqlExecutionSeqMock += 1
  return {
    id: `sql-exec-test-${databaseSqlExecutionSeqMock}`,
    status: input.status,
    message: input.message,
    durationMs: input.durationMs ?? 1,
    rowCount: input.rowCount ?? 0,
    createdAt: `2026-06-10T00:00:${String(databaseSqlExecutionSeqMock).padStart(2, '0')}.000Z`
  }
}

const cloneDatabaseCatalogColumnMock = (column: DatabaseColumnInfo): DatabaseColumnInfo => ({ ...column })

const cloneDatabaseCatalogTableMock = (table: DatabaseTableInfo): DatabaseTableInfo => ({
  ...table,
  columns: table.columns.map(cloneDatabaseCatalogColumnMock),
  primaryKey: table.primaryKey.slice()
})

const cloneDatabaseCatalogMock = (connectionId: string, catalog: DatabaseCatalogInfo): DatabaseCatalogInfo => ({
  name: catalog.name,
  ...(catalog.tables
    ? {
        tables: catalog.tables
          .filter((table) => databaseCatalogTableExistsMock({ connectionId, databaseName: catalog.name, tableName: table.name }))
          .map(cloneDatabaseCatalogTableMock)
      }
    : {}),
  ...(catalog.schemas
    ? {
        schemas: catalog.schemas.map((schema) => ({
          name: schema.name,
          tables: schema.tables
            .filter((table) =>
              databaseCatalogTableExistsMock({ connectionId, databaseName: catalog.name, schemaName: schema.name, tableName: table.name })
            )
            .map(cloneDatabaseCatalogTableMock),
          views: (schema.views ?? [])
            .filter((table) =>
              databaseCatalogTableExistsMock({ connectionId, databaseName: catalog.name, schemaName: schema.name, tableName: table.name })
            )
            .map(cloneDatabaseCatalogTableMock),
          functions: schema.functions?.slice(),
          procedures: schema.procedures?.slice()
        }))
      }
    : {})
})

const cloneDatabaseCatalogConnectionMock = (connection: DatabaseConnectionInfo): DatabaseConnectionInfo => ({
  ...connection,
  catalogs: connection.catalogs.map((catalog) => cloneDatabaseCatalogMock(connection.id, catalog))
})

const defaultDatabaseConnectionsMock = databaseConnectionsMock.map(cloneDatabaseCatalogConnectionMock)
const defaultDatabaseGroupsMock = databaseGroupsMock.map((group) => ({ ...group }))
const defaultDatabaseGroupParentsMock = { ...databaseGroupParentsMock }

function resetDatabaseConnectionsMock() {
  databaseConnectionsMock.splice(0, databaseConnectionsMock.length, ...defaultDatabaseConnectionsMock.map(cloneDatabaseCatalogConnectionMock))
  databaseGroupsMock.splice(0, databaseGroupsMock.length, ...defaultDatabaseGroupsMock.map((group) => ({ ...group })))
  Object.keys(databaseGroupParentsMock).forEach((key) => {
    delete databaseGroupParentsMock[key]
  })
  Object.assign(databaseGroupParentsMock, defaultDatabaseGroupParentsMock)
}

const databaseTrimMock = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const databaseAiPaneMessageRecordMock = (
  input: {
    requestId: string
    role: 'user' | 'assistant'
    status: DatabaseAiPaneMessageRecord['status']
    content: string
    contextSummary: string
    createdAt: number
  },
  id: string
): DatabaseAiPaneMessageRecord => ({
  id,
  requestId: input.requestId,
  role: input.role,
  status: input.status,
  content: input.content,
  contextSummary: input.contextSummary,
  createdAt: input.createdAt,
  updatedAt: input.createdAt
})

const cloneDatabaseAiPaneMessageMock = (message: DatabaseAiPaneMessageRecord): DatabaseAiPaneMessageRecord => ({ ...message })

const cloneDatabaseAiPaneStateMock = (state: DatabaseAiPaneStateSnapshot): DatabaseAiPaneStateSnapshot => ({
  open: state.open,
  width: state.width,
  context: { ...state.context },
  draft: state.draft,
  messages: state.messages.map(cloneDatabaseAiPaneMessageMock)
})

const isMysqlCompatibleDatabaseMock = (dialect: DatabaseEngineCode | TestDatabaseAiTargetDialect | '') =>
  dialect === 'mysql' || dialect === 'mariadb' || dialect === 'oceanbase'

const isPostgresCompatibleDatabaseMock = (dialect: DatabaseEngineCode | TestDatabaseAiTargetDialect | '') =>
  dialect === 'postgresql' || dialect === 'kingbase'

const normalizeDatabaseAiPaneStateMock = (state: DatabaseAiPaneStateSnapshot): DatabaseAiPaneStateSnapshot => ({
  open: state.open === true,
  width: Math.min(720, Math.max(280, Math.round(Number(state.width) || 360))),
    context: {
      connectionId: databaseTrimMock(state.context?.connectionId),
      catalogName: databaseTrimMock(state.context?.catalogName),
      schemaName: databaseTrimMock(state.context?.schemaName),
      dbType: ['mysql', 'mariadb', 'oceanbase', 'postgresql', 'kingbase', 'sqlite', 'oracle', 'sqlserver', 'clickhouse', 'presto'].includes(String(state.context?.dbType)) ? state.context.dbType : ''
    },
  draft: typeof state.draft === 'string' ? state.draft : '',
  messages: (Array.isArray(state.messages) ? state.messages : []).slice(-24).map((message) => ({
    ...cloneDatabaseAiPaneMessageMock(message),
    status: message.status === 'queued' || message.status === 'streaming' ? 'cancelled' : message.status
  }))
})

const storeDatabaseAiPaneMessageMock = (message: DatabaseAiPaneMessageRecord) => {
  databaseAiPaneMessagesMock.set(message.id, cloneDatabaseAiPaneMessageMock(message))
  return message
}

const findDatabaseAiPaneAssistantMessageMock = (input: { requestId: string; assistantMessageId?: string }) => {
  if (input.assistantMessageId) {
    const message = databaseAiPaneMessagesMock.get(input.assistantMessageId)
    if (message?.role === 'assistant') return cloneDatabaseAiPaneMessageMock(message)
  }
  return (
    Array.from(databaseAiPaneMessagesMock.values())
      .filter((message) => message.role === 'assistant' && message.requestId === input.requestId)
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  )
}

const updateDatabaseAiPaneAssistantMessageMock = (
  input: { requestId: string; assistantMessageId?: string },
  patch: Partial<Pick<DatabaseAiPaneMessageRecord, 'status' | 'content' | 'updatedAt'>>
) => {
  const existing = findDatabaseAiPaneAssistantMessageMock(input)
  if (!existing) return null
  const updated = { ...existing, ...patch, updatedAt: patch.updatedAt ?? Date.now() }
  databaseAiPaneMessagesMock.set(updated.id, cloneDatabaseAiPaneMessageMock(updated))
  return updated
}

const cloneDatabaseAiDrawerRequestMock = (request: DatabaseAiDrawerRequestRecord): DatabaseAiDrawerRequestRecord => ({
  ...request,
  backendContext: { ...request.backendContext }
})

const storeDatabaseAiDrawerRequestMock = (request: DatabaseAiDrawerRequestRecord) => {
  databaseAiDrawerRequestsMock.set(request.id, cloneDatabaseAiDrawerRequestMock(request))
  return request
}

const findDatabaseAiDrawerRequestMock = (requestId: string) => {
  const request = databaseAiDrawerRequestsMock.get(requestId)
  return request ? cloneDatabaseAiDrawerRequestMock(request) : null
}

const updateDatabaseAiDrawerRequestMock = (requestId: string, patch: Partial<Pick<DatabaseAiDrawerRequestRecord, 'status' | 'text' | 'targetDialect' | 'updatedAt'>>) => {
  const existing = findDatabaseAiDrawerRequestMock(requestId)
  if (!existing) return null
  const updated = { ...existing, ...patch, updatedAt: patch.updatedAt ?? Date.now() }
  databaseAiDrawerRequestsMock.set(updated.id, cloneDatabaseAiDrawerRequestMock(updated))
  return updated
}

const normalizeDatabaseAiTargetDialectMock = (dialect?: TestDatabaseAiTargetDialect | ''): TestDatabaseAiTargetDialect =>
  dialect === 'sqlserver'
    ? 'mssql'
    : dialect && isMysqlCompatibleDatabaseMock(dialect)
      ? 'mysql'
      : dialect && isPostgresCompatibleDatabaseMock(dialect)
        ? 'postgresql'
        : dialect || 'postgresql'

const databaseAiPaneContextSummaryMock = (input: { context: { contextSummary?: string; connectionId?: string; databaseName?: string; schemaName?: string; dbType?: string } }) =>
  input.context.contextSummary ||
  [input.context.connectionId, input.context.dbType, input.context.databaseName, input.context.schemaName].filter(Boolean).join(' · ')

const databaseAiPaneErrorResponseMock = (input: {
  requestId?: string
  assistantMessageId?: string
  context: { contextSummary?: string; connectionId?: string; databaseName?: string; schemaName?: string; dbType?: string }
}, errorCode: string, errorMessage: string) => {
  const requestId = input.requestId || `dbai-pane-response-test-${databaseAiPaneRequestSequenceMock++}`
  const existing = findDatabaseAiPaneAssistantMessageMock({ requestId, assistantMessageId: input.assistantMessageId })
  const assistantMessage =
    existing && existing.status !== 'cancelled'
      ? updateDatabaseAiPaneAssistantMessageMock({ requestId, assistantMessageId: existing.id }, { status: 'error', content: errorMessage })!
      : existing ||
        storeDatabaseAiPaneMessageMock(
          databaseAiPaneMessageRecordMock(
            {
              requestId,
              role: 'assistant',
              status: 'error',
              content: errorMessage,
              contextSummary: databaseAiPaneContextSummaryMock(input),
              createdAt: Date.now()
            },
            input.assistantMessageId || `${requestId}-assistant`
          )
        )
  return {
    ok: false,
    errorCode,
    errorMessage,
    data: {
      requestId,
      assistantMessage,
      text: assistantMessage.content,
      provider: 'aiopsterm-local' as const,
      durationMs: 1
    }
  }
}

const databaseAiDrawerActionNameMock = (action: TestDatabaseAiDrawerAction) => {
  switch (action) {
    case 'explain':
      return 'Explain SQL'
    case 'nl2sql':
      return 'Natural Language to SQL'
    case 'optimize':
      return 'Optimize SQL'
    case 'convert':
      return 'Convert SQL'
    case 'complete':
      return 'Complete SQL'
    case 'diagnose':
      return 'Diagnose SQL'
    case 'truncate':
      return 'Truncate Table'
    case 'drop':
      return 'Drop Table'
    default:
      return action
  }
}

const databaseAiDrawerErrorResponseMock = (
  input: {
    requestId?: string
    action: TestDatabaseAiDrawerAction
    sourceSql: string
    targetDialect?: TestDatabaseAiTargetDialect
    context: { connectionId?: string; contextSummary?: string; dbType?: TestDatabaseAiTargetDialect | ''; databaseName?: string; schemaName?: string; tableName?: string }
  },
  errorCode: string,
  errorMessage: string
) => {
  const existing = input.requestId ? findDatabaseAiDrawerRequestMock(input.requestId) : null
  const targetDialect = normalizeDatabaseAiTargetDialectMock(input.targetDialect || existing?.targetDialect || input.context.dbType || 'postgresql')
  const text = `Reasoning\n- ${errorMessage}`
  const request =
    existing && existing.status !== 'cancelled'
      ? updateDatabaseAiDrawerRequestMock(existing.id, { status: 'error', text, targetDialect })!
      : existing ||
        storeDatabaseAiDrawerRequestMock({
          id: input.requestId || `dbai-drawer-response-test-${databaseAiDrawerRequestSequenceMock++}`,
          action: input.action,
          label: databaseAiDrawerActionNameMock(input.action),
          status: 'error',
          contextSummary: input.context.contextSummary || '',
          sourceSql: input.sourceSql,
          text,
          targetDialect,
          backendContext: {
            connectionId: input.context.connectionId || '',
            dbType: input.context.dbType === 'mssql' ? '' : input.context.dbType,
            databaseName: input.context.databaseName || '',
            schemaName: input.context.schemaName,
            tableName: input.context.tableName,
            contextSummary: input.context.contextSummary
          },
          createdAt: Date.now(),
          updatedAt: Date.now()
        })

  return {
    ok: false,
    errorCode,
    errorMessage,
    data: {
      request,
      text: request.text,
      reasoning: request.text,
      sql: '',
      provider: 'aiopsterm-local' as const,
      durationMs: 1
    }
  }
}

const sqlitePathFromUrlMock = (url: string) => {
  const trimmed = databaseTrimMock(url)
  if (!trimmed.toLowerCase().startsWith('sqlite://')) return ''
  return trimmed.replace(/^sqlite:\/\//i, '')
}

const basenameFromDatabasePathMock = (value: string) => value.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'main'

const defaultDatabaseCatalogDefaultsMock = (): DatabaseWorkspaceCatalog['defaults'] => ({
  selectedNodeId: 'conn-prod-pg',
  expandedGroupIds: ['group-default', 'group-prod', 'group-local'],
  expandedConnectionIds: ['conn-prod-pg'],
  expandedCatalogIds: ['conn-prod-pg:orders'],
  expandedSchemaIds: ['conn-prod-pg:orders:public', 'conn-prod-pg:orders:ops'],
  expandedSchemaObjectFolderIds: ['conn-prod-pg:orders:public:tables', 'conn-prod-pg:orders:ops:tables']
})

const databaseSchemaHasObjectsMock = (schema: NonNullable<DatabaseCatalogInfo['schemas']>[number]) =>
  schema.tables.length > 0 || (schema.views?.length ?? 0) > 0 || (schema.functions?.length ?? 0) > 0 || (schema.procedures?.length ?? 0) > 0

const databaseCatalogDefaultsMock = (selectedConnectionId = 'conn-prod-pg'): DatabaseWorkspaceCatalog['defaults'] => {
  const baseDefaults = defaultDatabaseCatalogDefaultsMock()
  const selectedConnection = databaseConnectionsMock.find((connection) => connection.id === selectedConnectionId)
  if (!selectedConnection || selectedConnectionId === 'conn-prod-pg') {
    return baseDefaults
  }
  const expandedSchemaIds = selectedConnection.catalogs.flatMap((catalog) =>
    (catalog.schemas ?? []).filter(databaseSchemaHasObjectsMock).map((schema) => `${selectedConnection.id}:${catalog.name}:${schema.name}`)
  )
  const expandedSchemaObjectFolderIds = selectedConnection.catalogs.flatMap((catalog) =>
    (catalog.schemas ?? []).flatMap((schema) => {
      const folderIds: string[] = []
      if (schema.tables.length) folderIds.push(`${selectedConnection.id}:${catalog.name}:${schema.name}:tables`)
      if (schema.views?.length) folderIds.push(`${selectedConnection.id}:${catalog.name}:${schema.name}:views`)
      if (schema.functions?.length) folderIds.push(`${selectedConnection.id}:${catalog.name}:${schema.name}:functions`)
      if (schema.procedures?.length) folderIds.push(`${selectedConnection.id}:${catalog.name}:${schema.name}:procedures`)
      return folderIds
    })
  )
  return {
    selectedNodeId: selectedConnection.id,
    expandedGroupIds: databaseGroupsMock.map((group) => group.id),
    expandedConnectionIds: Array.from(new Set([...baseDefaults.expandedConnectionIds, selectedConnection.id])),
    expandedCatalogIds: Array.from(
      new Set([...baseDefaults.expandedCatalogIds, ...selectedConnection.catalogs.map((catalog) => `${selectedConnection.id}:${catalog.name}`)])
    ),
    expandedSchemaIds: Array.from(new Set([...baseDefaults.expandedSchemaIds, ...expandedSchemaIds])),
    expandedSchemaObjectFolderIds: Array.from(new Set([...baseDefaults.expandedSchemaObjectFolderIds, ...expandedSchemaObjectFolderIds]))
  }
}

const databaseWorkspaceCatalogMock = (selectedConnectionId = 'conn-prod-pg'): DatabaseWorkspaceCatalog => ({
  engines: databaseEngineOptionsMock.map((engine) => ({ ...engine })),
  groups: databaseGroupsMock.map((group) => ({ ...group })),
  groupParents: { ...databaseGroupParentsMock },
  connections: databaseConnectionsMock.map(cloneDatabaseCatalogConnectionMock),
  defaults: databaseCatalogDefaultsMock(selectedConnectionId)
})

const testDatabaseConnectionMock = async (input: DatabaseConnectionTestInput) => {
  if (input.dbType === 'sqlite') {
    const filePath = databaseTrimMock(input.filePath) || sqlitePathFromUrlMock(databaseTrimMock(input.url))
    if (!filePath) return { ok: false, errorCode: 'DB_SQLITE_FILE_REQUIRED', errorMessage: 'SQLite file path is required.' }
    if (!/\.(db|sqlite|sqlite3)$/i.test(filePath)) {
      return { ok: false, errorCode: 'DB_SQLITE_EXTENSION', errorMessage: 'SQLite file should end with .db, .sqlite, or .sqlite3.' }
    }
  }
  const serverVersion =
    input.dbType === 'mysql'
        ? 'MySQL 8 local backend validation'
        : input.dbType === 'mariadb'
          ? 'MariaDB local backend validation'
          : input.dbType === 'oceanbase'
            ? 'OceanBase MySQL-compatible local backend validation'
            : input.dbType === 'postgresql'
              ? 'PostgreSQL 16 local backend validation'
              : input.dbType === 'kingbase'
                ? 'KingBase PostgreSQL-compatible local backend validation'
                : input.dbType === 'oracle'
                  ? 'Oracle local backend validation'
                  : input.dbType === 'sqlserver'
                    ? 'SQL Server local backend validation'
                    : input.dbType === 'clickhouse'
                      ? 'ClickHouse local backend validation'
                      : input.dbType === 'presto'
                        ? 'Presto local backend validation'
                        : 'SQLite local backend validation'
  return { ok: true, data: { dbType: input.dbType, serverVersion, endpoint: 'test-backend', durationMs: 1 } }
}

const slugForDatabaseConnectionMock = (value: string) =>
  databaseTrimMock(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'database'

const nextDatabaseConnectionIdMock = (name: string) => {
  const base = `conn-${slugForDatabaseConnectionMock(name)}`
  let candidate = base
  let suffix = 2
  while (databaseConnectionsMock.some((connection) => connection.id === candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

const nextDatabaseGroupIdMock = (name: string) => {
  const base = `group-${slugForDatabaseConnectionMock(name || 'group')}`
  let candidate = base
  let suffix = 2
  while (databaseGroupsMock.some((group) => group.id === candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

const databaseGroupExistsMock = (groupId: string | null | undefined) =>
  !!groupId && databaseGroupsMock.some((group) => group.id === databaseTrimMock(groupId))

const normalizedDatabaseGroupIdMock = (groupId: string | null | undefined) => {
  const id = databaseTrimMock(groupId)
  return databaseGroupExistsMock(id) ? id : 'group-default'
}

const normalizedDatabaseGroupParentIdMock = (groupId: string | null | undefined) => {
  const id = databaseTrimMock(groupId)
  return databaseGroupExistsMock(id) ? id : null
}

const databaseGroupDescendantIdsMock = (groupId: string) => {
  const out = new Set<string>()
  const visit = (parentId: string) => {
    databaseGroupsMock.forEach((group) => {
      if ((databaseGroupParentsMock[group.id] ?? null) === parentId) {
        out.add(group.id)
        visit(group.id)
      }
    })
  }
  visit(groupId)
  return out
}

const buildSavedDatabaseConnectionUrlMock = (
  input: DatabaseConnectionTestInput,
  normalized: Pick<DatabaseConnectionInfo, 'dbType' | 'host' | 'port' | 'database' | 'filePath'>
) => {
  const rawUrl = databaseTrimMock(input.url)
  if (rawUrl) return rawUrl
  if (normalized.dbType === 'sqlite') return `sqlite://${normalized.filePath || ''}`
  if (normalized.dbType === 'clickhouse' || normalized.dbType === 'presto') {
    const port = normalized.port || (normalized.dbType === 'presto' ? 8080 : 8123)
    return `http://${normalized.host}${port ? `:${port}` : ''}`
  }
  const port = normalized.port ? `:${normalized.port}` : ''
  const database = normalized.database ? `/${normalized.database}` : ''
  if (normalized.dbType === 'oracle') return `${normalized.host}${port}${database}`
  const scheme =
    normalized.dbType === 'postgresql'
      ? 'jdbc:postgresql'
      : normalized.dbType === 'kingbase'
        ? 'jdbc:kingbase8'
        : normalized.dbType === 'sqlserver'
          ? 'jdbc:sqlserver'
          : normalized.dbType === 'mariadb'
            ? 'jdbc:mariadb'
            : normalized.dbType === 'oceanbase'
              ? 'jdbc:oceanbase'
              : 'jdbc:mysql'
  return `${scheme}://${normalized.host}${port}${database}`
}

const defaultCatalogsForSavedConnectionMock = (connection: Omit<DatabaseConnectionInfo, 'catalogs'>): DatabaseCatalogInfo[] => {
  if (!connection.database) return []
  if (isPostgresCompatibleDatabaseMock(connection.dbType)) {
    return [{ name: connection.database, schemas: [{ name: 'public', tables: [], views: [], functions: [], procedures: [] }] }]
  }
  if (connection.dbType === 'oracle') {
    return [{ name: connection.database, schemas: [{ name: 'OPS', tables: [], views: [], functions: [], procedures: [] }] }]
  }
  if (connection.dbType === 'sqlserver') {
    return [{ name: connection.database, schemas: [{ name: 'dbo', tables: [], views: [], functions: [], procedures: [] }] }]
  }
  if (connection.dbType === 'presto') {
    return [{ name: connection.database, schemas: [] }]
  }
  return [{ name: connection.database, tables: [] }]
}

const createDatabaseCatalogForConnectionMock = (connection: DatabaseConnectionInfo, name: string): DatabaseCatalogInfo =>
  isPostgresCompatibleDatabaseMock(connection.dbType) || connection.dbType === 'sqlserver'
    ? { name, schemas: [{ name: isPostgresCompatibleDatabaseMock(connection.dbType) ? 'public' : 'dbo', tables: [], views: [], functions: [], procedures: [] }] }
    : { name, tables: [] }

const unquoteDatabaseIdentifierMock = (value: string) => {
  const token = databaseTrimMock(value)
  if (token.startsWith('`') && token.endsWith('`')) return token.slice(1, -1).replace(/``/g, '`')
  if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1).replace(/""/g, '"')
  return token
}

const databaseNameFromCreateSqlMock = (sql: string) => {
  const match = databaseTrimMock(sql).match(/^create\s+database\s+(?:if\s+not\s+exists\s+)?(`(?:``|[^`])+`|"(?:""|[^"])+"|[A-Za-z_][A-Za-z0-9_]*)\s*;?$/i)
  return match ? unquoteDatabaseIdentifierMock(match[1]) : ''
}

const normalizeSavedDatabaseConnectionMock = (
  input: DatabaseConnectionSaveInput['connection']
): Omit<DatabaseConnectionInfo, 'id' | 'status' | 'catalogs' | 'hasPassword'> => {
  const isSqlite = input.dbType === 'sqlite'
  const hasOracleConnectString = input.dbType === 'oracle' && !!databaseTrimMock(input.url)
  const filePath = isSqlite ? databaseTrimMock(input.filePath) || sqlitePathFromUrlMock(databaseTrimMock(input.url)) : ''
  const database = isSqlite ? basenameFromDatabasePathMock(filePath) : databaseTrimMock(input.database)
  const sslMode: DatabaseConnectionInfo['sslMode'] =
    isPostgresCompatibleDatabaseMock(input.dbType) || input.dbType === 'sqlserver' ? ((input.sslMode || '') as DatabaseConnectionInfo['sslMode']) : ''
  const proxyName = !isSqlite && (input.needProxy || databaseTrimMock(input.proxyName)) ? databaseTrimMock(input.proxyName) : ''
  const normalized = {
    name: databaseTrimMock(input.name),
    dbType: input.dbType,
    env: input.env ?? 'Development',
    groupId: normalizedDatabaseGroupIdMock(input.groupId),
    host: isSqlite ? 'local' : hasOracleConnectString ? 'connect-string' : databaseTrimMock(input.host),
    port: isSqlite || hasOracleConnectString ? null : typeof input.port === 'number' && Number.isFinite(input.port) ? input.port : null,
    authentication: input.authentication ?? 'UserAndPassword',
    user: isSqlite ? '' : databaseTrimMock(input.user),
    database,
    filePath: isSqlite ? filePath : undefined,
    readonly: isSqlite ? !!input.readonly : undefined,
    sslMode,
    needProxy: !isSqlite && !!proxyName ? true : undefined,
    proxyName: !isSqlite && proxyName ? proxyName : undefined
  }
  return {
    ...normalized,
    url: buildSavedDatabaseConnectionUrlMock(input, normalized)
  }
}

const saveDatabaseConnectionMock = async (input: DatabaseConnectionSaveInput) => {
  const testResult = await testDatabaseConnectionMock(input.connection)
  if (!testResult.ok) return testResult
  const normalized = normalizeSavedDatabaseConnectionMock(input.connection)
  if (input.mode === 'edit') {
    const existingIndex = databaseConnectionsMock.findIndex((connection) => connection.id === input.id)
    if (existingIndex === -1) return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
    const existing = databaseConnectionsMock[existingIndex]
    const saved: DatabaseConnectionInfo = {
      id: existing.id,
      ...normalized,
      hasPassword: databaseTrimMock(input.connection.password) ? true : existing.hasPassword,
      status: existing.status,
      catalogs:
        existing.dbType === normalized.dbType && existing.database === normalized.database
          ? existing.catalogs.map((catalog) => cloneDatabaseCatalogMock(existing.id, catalog))
          : []
    }
    if (!saved.catalogs.length) saved.catalogs = defaultCatalogsForSavedConnectionMock(saved)
    databaseConnectionsMock[existingIndex] = saved
    return { ok: true, data: { ...databaseWorkspaceCatalogMock(saved.id), connection: cloneDatabaseCatalogConnectionMock(saved), message: 'Connection saved' } }
  }

  const saved: DatabaseConnectionInfo = {
    id: nextDatabaseConnectionIdMock(normalized.name),
    ...normalized,
    hasPassword: !!databaseTrimMock(input.connection.password),
    status: 'idle',
    catalogs: []
  }
  saved.catalogs = defaultCatalogsForSavedConnectionMock(saved)
  databaseConnectionsMock.push(saved)
  return { ok: true, data: { ...databaseWorkspaceCatalogMock(saved.id), connection: cloneDatabaseCatalogConnectionMock(saved), message: 'Connection saved' } }
}

const createDatabaseCatalogMock = async (input: DatabaseCreateDatabaseInput) => {
  const index = databaseConnectionsMock.findIndex((connection) => connection.id === databaseTrimMock(input.connectionId))
  const connection = index >= 0 ? databaseConnectionsMock[index] : null
  if (!connection) return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  if (!isMysqlCompatibleDatabaseMock(connection.dbType) && !isPostgresCompatibleDatabaseMock(connection.dbType) && connection.dbType !== 'sqlserver') {
    return {
      ok: false,
      errorCode: 'DB_CREATE_DATABASE_UNSUPPORTED',
      errorMessage: 'Create Database is only available for MySQL-compatible, PostgreSQL-compatible, and SQL Server connections.'
    }
  }
  const name = databaseNameFromCreateSqlMock(input.sql) || databaseTrimMock(input.requestedName)
  if (!name) return { ok: false, errorCode: 'DB_CREATE_DATABASE_SQL_INVALID', errorMessage: 'CREATE DATABASE statement is required.' }
  if (connection.catalogs.some((catalog) => catalog.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, errorCode: 'DB_CREATE_DATABASE_DUPLICATE', errorMessage: 'Database already exists.' }
  }
  const catalog = createDatabaseCatalogForConnectionMock(connection, name)
  const saved = {
    ...connection,
    catalogs: [...connection.catalogs.map((item) => cloneDatabaseCatalogMock(connection.id, item)), catalog]
  }
  databaseConnectionsMock[index] = saved
  return {
    ok: true,
    data: {
      ...databaseWorkspaceCatalogMock(saved.id),
      connection: cloneDatabaseCatalogConnectionMock(saved),
      catalog: cloneDatabaseCatalogMock(saved.id, catalog),
      message: 'Database created in workspace catalog'
    }
  }
}

const createDatabaseGroupMock = async (input: DatabaseGroupCreateInput) => {
  const name = databaseTrimMock(input.name) || 'New Group'
  const group = {
    id: nextDatabaseGroupIdMock(name),
    name
  }
  databaseGroupsMock.push(group)
  databaseGroupParentsMock[group.id] = normalizedDatabaseGroupParentIdMock(input.parentId)
  return { ok: true, data: { ...databaseWorkspaceCatalogMock(group.id), group: { ...group }, message: 'Group created' } }
}

const renameDatabaseGroupMock = async (input: DatabaseGroupUpdateInput) => {
  const group = databaseGroupsMock.find((item) => item.id === databaseTrimMock(input.id))
  if (!group) return { ok: false, errorCode: 'DB_GROUP_NOT_FOUND', errorMessage: 'Database group was not found.' }
  const name = databaseTrimMock(input.name)
  if (!name) return { ok: false, errorCode: 'DB_GROUP_NAME_REQUIRED', errorMessage: 'Group name is required.' }
  group.name = name
  return { ok: true, data: { ...databaseWorkspaceCatalogMock(group.id), group: { ...group }, message: 'Group renamed' } }
}

const moveDatabaseGroupMock = async (input: DatabaseGroupUpdateInput) => {
  const groupId = databaseTrimMock(input.id)
  const group = databaseGroupsMock.find((item) => item.id === groupId)
  if (!group) return { ok: false, errorCode: 'DB_GROUP_NOT_FOUND', errorMessage: 'Database group was not found.' }
  if (groupId === 'group-default') return { ok: false, errorCode: 'DB_GROUP_DEFAULT_LOCKED', errorMessage: 'Default Group cannot be moved.' }
  const parentId = input.parentId === undefined ? (databaseGroupParentsMock[groupId] ?? null) : normalizedDatabaseGroupParentIdMock(input.parentId)
  if (parentId === groupId || (parentId && databaseGroupDescendantIdsMock(groupId).has(parentId))) {
    return { ok: false, errorCode: 'DB_GROUP_PARENT_INVALID', errorMessage: 'Group cannot be moved into itself or one of its children.' }
  }
  databaseGroupParentsMock[groupId] = parentId
  return { ok: true, data: { ...databaseWorkspaceCatalogMock(group.id), group: { ...group }, message: parentId ? 'Group moved' : 'Group moved to root' } }
}

const deleteDatabaseGroupMock = async (id: string) => {
  const groupId = databaseTrimMock(id)
  const group = databaseGroupsMock.find((item) => item.id === groupId)
  if (!group) return { ok: false, errorCode: 'DB_GROUP_NOT_FOUND', errorMessage: 'Database group was not found.' }
  if (groupId === 'group-default') return { ok: false, errorCode: 'DB_GROUP_DEFAULT_LOCKED', errorMessage: 'Default Group cannot be deleted.' }
  const index = databaseGroupsMock.findIndex((item) => item.id === groupId)
  databaseGroupsMock.splice(index, 1)
  databaseGroupsMock.forEach((item) => {
    if ((databaseGroupParentsMock[item.id] ?? null) === groupId) databaseGroupParentsMock[item.id] = null
  })
  delete databaseGroupParentsMock[groupId]
  databaseConnectionsMock.forEach((connection) => {
    if (connection.groupId === groupId) connection.groupId = 'group-default'
  })
  return { ok: true, data: { ...databaseWorkspaceCatalogMock('group-default'), deletedGroupId: groupId, message: 'Group deleted' } }
}

const databaseConnectionMutationMock = async (
  connectionId: string,
  message: string,
  mutate: (connection: DatabaseConnectionInfo) => DatabaseConnectionInfo
) => {
  const id = databaseTrimMock(connectionId)
  const index = databaseConnectionsMock.findIndex((connection) => connection.id === id)
  if (index === -1) return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  const saved = mutate(databaseConnectionsMock[index])
  databaseConnectionsMock[index] = saved
  return { ok: true, data: { ...databaseWorkspaceCatalogMock(saved.id), connection: cloneDatabaseCatalogConnectionMock(saved), message } }
}

const moveDatabaseConnectionMock = async (input: DatabaseConnectionMoveInput) =>
  databaseConnectionMutationMock(input.connectionId, normalizedDatabaseGroupIdMock(input.groupId) === 'group-default' ? 'Connection moved to root group' : 'Connection moved', (connection) => ({
    ...connection,
    groupId: normalizedDatabaseGroupIdMock(input.groupId)
  }))

const removeDatabaseConnectionMock = async (connectionId: string) => {
  const id = databaseTrimMock(connectionId)
  const index = databaseConnectionsMock.findIndex((connection) => connection.id === id)
  if (index === -1) return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  databaseConnectionsMock.splice(index, 1)
  return { ok: true, data: { ...databaseWorkspaceCatalogMock(), connectionId: id, message: 'Connection removed' } }
}

const connectDatabaseConnectionMock = async (connectionId: string) =>
  databaseConnectionMutationMock(connectionId, 'Connection opened', (connection) => ({ ...connection, status: 'connected' }))

const disconnectDatabaseConnectionMock = async (connectionId: string) =>
  databaseConnectionMutationMock(connectionId, 'Connection closed', (connection) => ({ ...connection, status: 'idle' }))

const refreshDatabaseConnectionMock = async (connectionId: string) =>
  databaseConnectionMutationMock(connectionId, 'Connection schema refreshed', (connection) => ({ ...connection }))

function rowKeyForDatabaseMock(row: Record<string, unknown>, primaryKey: string[], index: number) {
  if (!primaryKey.length) return `row-${index}`
  return JSON.stringify(primaryKey.map((column) => row[column] ?? null))
}

type DatabaseMutationDialectMock = DatabaseEngineCode
type DatabaseMutationStatementMock = { kind: DatabaseTableMutation['kind']; sql: string; params: unknown[] }

const databaseMutationIdentifierMock = (value: string, dialect: DatabaseMutationDialectMock) =>
  isMysqlCompatibleDatabaseMock(dialect) ? `\`${String(value || '').replace(/`/g, '``')}\`` : `"${String(value || '').replace(/"/g, '""')}"`

const databaseMutationPlaceholderMock = (dialect: DatabaseMutationDialectMock, index: number) => {
  if (isPostgresCompatibleDatabaseMock(dialect)) return `$${index}`
  if (dialect === 'oracle') return `:${index}`
  return '?'
}

const databaseMutationTableReferenceMock = (
  input: Pick<DatabaseTableMutationPlanInput, 'databaseName' | 'schemaName' | 'tableName'>,
  dialect: DatabaseMutationDialectMock
) => {
  const table = databaseMutationIdentifierMock(databaseTrimMock(input.tableName), dialect)
  if (isMysqlCompatibleDatabaseMock(dialect) || dialect === 'sqlite') return `${databaseMutationIdentifierMock(databaseTrimMock(input.databaseName), dialect)}.${table}`
  return `${databaseMutationIdentifierMock(databaseTrimMock(input.schemaName) || (isPostgresCompatibleDatabaseMock(dialect) ? 'public' : ''), dialect)}.${table}`
}

const decodeDatabaseMutationPrimaryKeyRowKeyMock = (rowKey: string, primaryKey: string[]) => {
  if (!primaryKey.length) return null
  try {
    const parsed = JSON.parse(rowKey)
    return Array.isArray(parsed) && parsed.length === primaryKey.length ? parsed : null
  } catch {
    return null
  }
}

const pushDatabaseMutationComparisonMock = (
  clauses: string[],
  params: unknown[],
  dialect: DatabaseMutationDialectMock,
  column: string,
  value: unknown
) => {
  const quoted = databaseMutationIdentifierMock(column, dialect)
  if (value === null || value === undefined) {
    clauses.push(`${quoted} IS NULL`)
    return
  }
  params.push(value)
  clauses.push(`${quoted} = ${databaseMutationPlaceholderMock(dialect, params.length)}`)
}

const databaseMutationWhereForRowMock = (
  dialect: DatabaseMutationDialectMock,
  knownColumns: string[],
  mutation: Extract<DatabaseTableMutation, { kind: 'delete' | 'update' }>,
  params: unknown[]
) => {
  const primaryKey = mutation.primaryKey.map(databaseTrimMock).filter(Boolean)
  const values = decodeDatabaseMutationPrimaryKeyRowKeyMock(mutation.rowKey, primaryKey)
  if (primaryKey.length && values) {
    const clauses: string[] = []
    primaryKey.forEach((column, index) => pushDatabaseMutationComparisonMock(clauses, params, dialect, column, values[index]))
    return { sql: clauses.join(' AND '), usesPrimaryKey: true }
  }
  if (dialect === 'oracle') throw Object.assign(new Error('Oracle table editing requires a primary key in this version.'), { code: 'DB_PRIMARY_KEY_REQUIRED' })
  if (!mutation.originalRow) throw Object.assign(new Error('Original row snapshot is required for table mutations without a primary key.'), { code: 'DB_ROW_SNAPSHOT_REQUIRED' })
  const clauses: string[] = []
  knownColumns.forEach((column) => {
    if (Object.prototype.hasOwnProperty.call(mutation.originalRow, column)) {
      pushDatabaseMutationComparisonMock(clauses, params, dialect, column, mutation.originalRow?.[column])
    }
  })
  if (!clauses.length) throw Object.assign(new Error('Original row snapshot does not contain known table columns.'), { code: 'DB_ROW_SNAPSHOT_REQUIRED' })
  return { sql: clauses.join(' AND '), usesPrimaryKey: false }
}

const applyDatabaseMutationSingleRowGuardMock = (
  dialect: DatabaseMutationDialectMock,
  tableRef: string,
  sql: string,
  whereSql: string,
  usesPrimaryKey: boolean
) => {
  if (usesPrimaryKey) return sql
  if (isMysqlCompatibleDatabaseMock(dialect)) return `${sql} LIMIT 1`
  if (dialect === 'sqlite') return sql.replace(`WHERE ${whereSql}`, `WHERE rowid = (SELECT rowid FROM ${tableRef} WHERE ${whereSql} LIMIT 1)`)
  if (isPostgresCompatibleDatabaseMock(dialect)) return sql.replace(`WHERE ${whereSql}`, `WHERE ctid = (SELECT ctid FROM ${tableRef} WHERE ${whereSql} LIMIT 1)`)
  return sql
}

const buildDatabaseMutationStatementMock = (
  dialect: DatabaseMutationDialectMock,
  tableRef: string,
  knownColumns: string[],
  mutation: DatabaseTableMutation
): DatabaseMutationStatementMock | null => {
  const knownColumnSet = new Set(knownColumns.map((column) => column.toLowerCase()))
  const params: unknown[] = []
  if (mutation.kind === 'drop') return { kind: mutation.kind, sql: `DROP TABLE ${tableRef}`, params }
  if (mutation.kind === 'truncate') return { kind: mutation.kind, sql: dialect === 'sqlite' ? `DELETE FROM ${tableRef}` : `TRUNCATE TABLE ${tableRef}`, params }
  if (mutation.kind === 'insert') {
    const columns = Object.keys(mutation.values).filter((column) => knownColumnSet.has(column.toLowerCase()) && mutation.values[column] !== null && mutation.values[column] !== undefined)
    if (!columns.length) return null
    columns.forEach((column) => params.push(mutation.values[column]))
    return {
      kind: mutation.kind,
      sql: `INSERT INTO ${tableRef} (${columns.map((column) => databaseMutationIdentifierMock(column, dialect)).join(', ')}) VALUES (${columns.map((_column, index) => databaseMutationPlaceholderMock(dialect, index + 1)).join(', ')})`,
      params
    }
  }
  if (mutation.kind === 'delete') {
    const where = databaseMutationWhereForRowMock(dialect, knownColumns, mutation, params)
    const sql = `DELETE FROM ${tableRef} WHERE ${where.sql}`
    return { kind: mutation.kind, sql: applyDatabaseMutationSingleRowGuardMock(dialect, tableRef, sql, where.sql, where.usesPrimaryKey), params }
  }
  const columns = Object.keys(mutation.patch).filter((column) => knownColumnSet.has(column.toLowerCase()))
  if (!columns.length) return null
  columns.forEach((column) => params.push(mutation.patch[column]))
  const assignments = columns.map((column, index) => `${databaseMutationIdentifierMock(column, dialect)} = ${databaseMutationPlaceholderMock(dialect, index + 1)}`).join(', ')
  const where = databaseMutationWhereForRowMock(dialect, knownColumns, mutation, params)
  const sql = `UPDATE ${tableRef} SET ${assignments} WHERE ${where.sql}`
  return { kind: mutation.kind, sql: applyDatabaseMutationSingleRowGuardMock(dialect, tableRef, sql, where.sql, where.usesPrimaryKey), params }
}

const formatDatabaseMutationSqlLiteralMock = (value: unknown) => {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return `'${String(value).replace(/'/g, "''")}'`
}

const formatDatabaseMutationStatementPreviewMock = (statement: DatabaseMutationStatementMock) => {
  let paramIndex = 0
  const sql = statement.sql.replace(/\$(\d+)|:(\d+)|\?/g, (match) => {
    if (match === '?') {
      const value = statement.params[paramIndex]
      paramIndex += 1
      return formatDatabaseMutationSqlLiteralMock(value)
    }
    const index = Number(match.slice(1) || paramIndex + 1)
    return formatDatabaseMutationSqlLiteralMock(statement.params[index - 1])
  })
  return `${sql};`
}

const databaseMutationWarningMock = (dialect: DatabaseMutationDialectMock, mutations: DatabaseTableMutation[]) => {
  const hasNoPrimaryKeyRowMutation = mutations.some((mutation) => {
    if (mutation.kind !== 'delete' && mutation.kind !== 'update') return false
    return mutation.primaryKey.map(databaseTrimMock).filter(Boolean).length === 0
  })
  if (!hasNoPrimaryKeyRowMutation) return ''
  if (dialect === 'oracle') return 'Oracle table editing requires a primary key in this version.'
  return 'No primary key detected. UPDATE and DELETE previews use the original row snapshot with a single-row guard.'
}

const planDatabaseTableMutationMock = async (input: DatabaseTableMutationPlanInput) => {
  const connection = databaseConnectionsMock.find((item) => item.id === databaseTrimMock(input.connectionId))
  if (!connection) return { ok: false, errorCode: 'DB_CONNECTION_NOT_FOUND', errorMessage: 'Database connection was not found.' }
  const key = databaseTableKey(input)
  const rows = databaseTableRowsMock[key]
  if (!rows) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
  const dialect = connection.dbType
  const knownColumns = databaseTableColumnsMock[key] || input.knownColumns || input.columns || Object.keys(rows[0] || {})
  try {
    const tableRef = databaseMutationTableReferenceMock(input, dialect)
    const statements = input.mutations
      .map((mutation) => buildDatabaseMutationStatementMock(dialect, tableRef, knownColumns, mutation))
      .filter((statement): statement is DatabaseMutationStatementMock => !!statement)
      .map((statement) => ({ ...statement, preview: formatDatabaseMutationStatementPreviewMock(statement) }))
    return {
      ok: true,
      data: {
        statements,
        statementCount: statements.length,
        preview: statements.map((statement) => statement.preview).join('\n'),
        warning: databaseMutationWarningMock(dialect, input.mutations)
      }
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : 'DB_MUTATION_PLAN_FAILED'
    return {
      ok: false,
      errorCode: code,
      errorMessage: error instanceof Error ? error.message : 'Database table mutation planning failed.'
    }
  }
}

function filterDatabaseRowsMock(rows: Array<Record<string, unknown>>, filters: Array<{ column: string; operator: string; value?: string; values?: string[] }>) {
  return rows.filter((row) =>
    filters.every((filter) => {
      const value = row[filter.column]
      const normalized = value === null || value === undefined ? null : String(value)
      if (filter.operator === 'isnull') return normalized === null
      if (filter.operator === 'notnull') return normalized !== null
      if (normalized === null) return false
      if (filter.operator === 'like') return normalized.toLowerCase().includes(String(filter.value || '').toLowerCase())
      if (filter.operator === 'eq') return normalized === String(filter.value || '')
      if (filter.operator === 'neq') return normalized !== String(filter.value || '')
      if (filter.operator === 'in') return (filter.values || []).includes(normalized)
      return true
    })
  )
}

function parseDatabaseWhereMock(whereRaw?: string | null) {
  const raw = (whereRaw || '').trim()
  if (!raw) return []
  const match = raw.match(/(\w+)\s*(=|<>|!=|like)\s*['"]?([^'"]+)['"]?/i)
  if (!match) return []
  return [{ column: match[1], operator: match[2].toLowerCase() === 'like' ? 'like' : match[2] === '=' ? 'eq' : 'neq', value: match[3] }]
}

type TestDatabaseAiDrawerAction = 'explain' | 'nl2sql' | 'optimize' | 'convert' | 'complete' | 'diagnose' | 'drop' | 'truncate'
type TestDatabaseAiTargetDialect =
  | 'mysql'
  | 'mariadb'
  | 'oceanbase'
  | 'postgresql'
  | 'kingbase'
  | 'sqlite'
  | 'oracle'
  | 'mssql'
  | 'sqlserver'
  | 'clickhouse'
  | 'presto'

const stripDatabaseAiSqlTerminatorMock = (sql: string) => sql.trim().replace(/;+$/, '').trim()
const ensureDatabaseAiSqlTerminatedMock = (sql: string) => {
  const trimmed = sql.trim()
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`
}
const quoteDatabaseAiIdentifierMock = (value: string, dialect: TestDatabaseAiTargetDialect) => {
  const raw = String(value || '').replace(/^[`"\[]|[`"\]]$/g, '')
  if (isMysqlCompatibleDatabaseMock(dialect) || dialect === 'clickhouse') return `\`${raw.replace(/`/g, '``')}\``
  if (dialect === 'mssql') return `[${raw.replace(/]/g, ']]')}]`
  return `"${raw.replace(/"/g, '""')}"`
}
const extractDatabaseAiLimitMock = (sql: string) => {
  const limitMatch = sql.match(/\blimit\s+(\d+)\b/i)
  if (limitMatch) return Number(limitMatch[1])
  const fetchMatch = sql.match(/\bfetch\s+first\s+(\d+)\s+rows\s+only\b/i)
  if (fetchMatch) return Number(fetchMatch[1])
  const topMatch = sql.match(/\btop\s*\(\s*(\d+)\s*\)/i)
  if (topMatch) return Number(topMatch[1])
  return null
}
const addDatabaseAiLimitMock = (sql: string, dialect: TestDatabaseAiTargetDialect, fallbackLimit: number) => {
  const limit = extractDatabaseAiLimitMock(sql) ?? fallbackLimit
  let withoutLimit = stripDatabaseAiSqlTerminatorMock(sql)
    .replace(/\s+limit\s+\d+\s*$/i, '')
    .replace(/\s+fetch\s+first\s+\d+\s+rows\s+only\s*$/i, '')
  const topMatch = withoutLimit.match(/^\s*select\s+top\s*\(\s*(\d+)\s*\)\s+/i)
  if (topMatch) withoutLimit = withoutLimit.replace(/^\s*select\s+top\s*\(\s*\d+\s*\)\s+/i, 'SELECT ')
  const resolvedLimit = Number(topMatch?.[1] ?? limit)
  if (dialect === 'oracle') return ensureDatabaseAiSqlTerminatedMock(`${withoutLimit}\nFETCH FIRST ${resolvedLimit} ROWS ONLY`)
  if (dialect === 'mssql') return ensureDatabaseAiSqlTerminatedMock(withoutLimit.replace(/^\s*select\s+/i, `SELECT TOP (${resolvedLimit}) `))
  return ensureDatabaseAiSqlTerminatedMock(`${withoutLimit}\nLIMIT ${resolvedLimit}`)
}
const convertDatabaseAiSqlMock = (sql: string, dialect: TestDatabaseAiTargetDialect) => {
  const normalized = stripDatabaseAiSqlTerminatorMock(sql.trim() || 'SELECT 1')
  const quoted = normalized
    .replace(/"([^"]+)"/g, (_match, value: string) => quoteDatabaseAiIdentifierMock(value, dialect))
    .replace(/`([^`]+)`/g, (_match, value: string) => quoteDatabaseAiIdentifierMock(value, dialect))
    .replace(/\[([^\]]+)\]/g, (_match, value: string) => quoteDatabaseAiIdentifierMock(value, dialect))
  return addDatabaseAiLimitMock(quoted, dialect, extractDatabaseAiLimitMock(normalized) ?? 100)
}
const databaseAiTableRefMock = (
  input: {
    context: { databaseName?: string; schemaName?: string; tableName?: string }
    sourceSql: string
  },
  dialect: TestDatabaseAiTargetDialect
) => {
  const fromMatch = input.sourceSql.match(/\bfrom\s+([`"\[]?[\w.-]+[`"\]]?(?:\s*\.\s*[`"\[]?[\w.-]+[`"\]]?)?)/i)
  const parts = (fromMatch?.[1] || '')
    .split('.')
    .map((part) => part.trim().replace(/^[`"\[]|[`"\]]$/g, ''))
    .filter(Boolean)
  const schemaName = input.context.schemaName || (parts.length > 1 ? parts[0] : '')
  const tableName = input.context.tableName || parts.at(-1) || 'orders'
  if ((isPostgresCompatibleDatabaseMock(dialect) || dialect === 'oracle' || dialect === 'mssql') && schemaName) {
    return `${quoteDatabaseAiIdentifierMock(schemaName, dialect)}.${quoteDatabaseAiIdentifierMock(tableName, dialect)}`
  }
  if (dialect === 'sqlite' && input.context.databaseName) {
    return `${quoteDatabaseAiIdentifierMock(input.context.databaseName, dialect)}.${quoteDatabaseAiIdentifierMock(tableName, dialect)}`
  }
  if (dialect === 'presto' && input.context.databaseName && schemaName) {
    return `${quoteDatabaseAiIdentifierMock(input.context.databaseName, dialect)}.${quoteDatabaseAiIdentifierMock(schemaName, dialect)}.${quoteDatabaseAiIdentifierMock(tableName, dialect)}`
  }
  if (dialect === 'clickhouse' && input.context.databaseName) {
    return `${quoteDatabaseAiIdentifierMock(input.context.databaseName, dialect)}.${quoteDatabaseAiIdentifierMock(tableName, dialect)}`
  }
  return quoteDatabaseAiIdentifierMock(tableName, dialect)
}
const generateDatabaseAiDrawerSqlMock = (input: {
  action: TestDatabaseAiDrawerAction
  sourceSql: string
  targetDialect?: TestDatabaseAiTargetDialect
  context: { dbType?: TestDatabaseAiTargetDialect | ''; databaseName?: string; schemaName?: string; tableName?: string }
}) => {
  const dialect = normalizeDatabaseAiTargetDialectMock(input.targetDialect || input.context.dbType || 'postgresql')
  if (input.action === 'convert') return convertDatabaseAiSqlMock(input.sourceSql, dialect)
  if (input.action === 'complete') {
    const base = stripDatabaseAiSqlTerminatorMock(input.sourceSql.trim() || `SELECT *\nFROM ${databaseAiTableRefMock(input, dialect)}`)
    const completed = /\bwhere\s*$/i.test(base)
      ? `${base} status = 'open'`
      : !/\bwhere\b/i.test(base) && /^\s*(select|with)\b/i.test(base)
        ? `${base}\nWHERE status = 'open'`
        : base
    return addDatabaseAiLimitMock(completed, dialect, 100)
  }
  if (input.action === 'optimize') {
    const base = stripDatabaseAiSqlTerminatorMock(input.sourceSql.trim() || `SELECT id, service, status, owner, updated_at\nFROM ${databaseAiTableRefMock(input, dialect)}`)
    return addDatabaseAiLimitMock(base.replace(/\bselect\s+\*/i, 'SELECT id, service, status, owner, updated_at'), dialect, 100)
  }
  if (input.action === 'nl2sql') {
    const tableRef = databaseAiTableRefMock(input, dialect)
    if (dialect === 'oracle') return `SELECT id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC\nFETCH FIRST 20 ROWS ONLY;`
    if (dialect === 'mssql') return `SELECT TOP (20) id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC;`
    return `SELECT id, service, status, owner, updated_at\nFROM ${tableRef}\nWHERE status = 'open'\nORDER BY updated_at DESC\nLIMIT 20;`
  }
  if (input.action === 'diagnose') {
    const tableRef = databaseAiTableRefMock(input, dialect)
    if (dialect === 'oracle') return `SELECT *\nFROM ${tableRef}\nFETCH FIRST 100 ROWS ONLY;`
    if (dialect === 'mssql') return `SELECT TOP (100) *\nFROM ${tableRef};`
    return `SELECT *\nFROM ${tableRef}\nLIMIT 100;`
  }
  return ensureDatabaseAiSqlTerminatedMock(input.sourceSql.trim() || 'SELECT 1')
}
const generateDatabaseAiDrawerTextMock = (input: {
  action: TestDatabaseAiDrawerAction
  sourceSql: string
  targetDialect?: TestDatabaseAiTargetDialect
  context: { contextSummary?: string; dbType?: TestDatabaseAiTargetDialect | ''; databaseName?: string; schemaName?: string; tableName?: string }
}) => {
  const dialect = normalizeDatabaseAiTargetDialectMock(input.targetDialect || input.context.dbType || 'postgresql')
  const sql = generateDatabaseAiDrawerSqlMock(input)
  const reasoning = [
    'Reasoning',
    '- Read the active database context and selected editor range through the aiopsterm backend boundary.',
    input.context.contextSummary ? `- Context: ${input.context.contextSummary}.` : '',
    '- 当前响应由 aiopsterm DB AI 本地后端生成，未连接远端数据库 AI 服务。',
    input.action === 'convert'
      ? `- Converted the SQL text to ${dialect === 'mssql' ? 'SQL Server' : dialect} syntax.`
      : input.action === 'complete'
        ? '- Completed the current statement with a bounded read-only predicate.'
        : input.action === 'optimize'
          ? '- Kept the query read-only and added a safer bounded projection for review.'
          : input.action === 'diagnose'
            ? '- Built a conservative read-only statement that can verify the referenced table.'
            : input.action === 'drop' || input.action === 'truncate'
              ? '- Preserved the destructive SQL as generated text only; execution remains blocked by the read-only guard.'
              : '- Kept the source SQL available for editor actions and review.'
  ]
    .filter(Boolean)
    .join('\n')
  return { reasoning, sql, text: `${reasoning}\n\n\`\`\`sql\n${sql}\n\`\`\`` }
}

const defaultKeywordHighlight = {
  'keyword-highlight': {
    enabled: true,
    applyTo: {
      output: true,
      input: false
    },
    rules: []
  }
}

const defaultKeywordHighlightContent = JSON.stringify(defaultKeywordHighlight, null, 2)

const defaultSecurityConfig = {
  security: {
    enableCommandSecurity: true,
    enableStrictMode: false,
    blacklistPatterns: [],
    whitelistPatterns: ['ls', 'pwd', 'whoami', 'date'],
    dangerousCommands: ['rm', 'format', 'shutdown'],
    maxCommandLength: 10000,
    securityPolicy: {
      blockCritical: true,
      askForMedium: true,
      askForHigh: true,
      askForBlacklist: false
    }
  }
}

const defaultSecurityConfigContent = JSON.stringify(defaultSecurityConfig, null, 2)

const defaultPrivacy = {
  telemetry: 'enabled',
  secretRedaction: 'disabled',
  dataSync: 'disabled'
}

const defaultAiPreferences = {
  enableExtendedThinking: true,
  thinkingBudgetTokens: 4096,
  autoExecuteReadOnlyCommands: false,
  commandOutputFilteringEnabled: true,
  kbSearchEnabled: true,
  experienceExtractionEnabled: true,
  managedAiAutoNamingEnabled: false,
  autoApproval: false,
  reasoningEffort: 'medium',
  needProxy: false,
  proxy: {
    type: 'HTTP',
    host: '127.0.0.1',
    port: 7890,
    enableProxyIdentity: false,
    username: '',
    password: ''
  },
  shellIntegrationTimeout: 3000
}

const defaultEditorSettings = {
  fontSize: 14,
  lineHeight: 0,
  fontFamily: 'cascadia-mono',
  tabSize: 4,
  wordWrap: 'off',
  minimap: true,
  mouseWheelZoom: true
}

const defaultSshProxyConfigs: any[] = []

const defaultSshAgentKeys: any[] = []

const defaultModelSettings = defaultModelSettingsSeedData()

const defaultLockedAiModels = [
  { id: 'gpt-5-pro', label: 'gpt-5-pro', detail: 'Subscription model', locked: true, checked: true, tier: 'VIP', type: 'standard', apiProvider: 'default' },
  { id: 'ops-large-context', label: 'ops-large-context', detail: 'Large context model', locked: true, checked: true, tier: 'VIP', type: 'standard', apiProvider: 'default' }
]

const cloneAiModelCatalog = (input?: { modelSettings?: typeof defaultModelSettings; localChatBackendAvailable?: boolean }) => {
  const settings = input?.modelSettings || defaultModelSettings
  const localChatBackendAvailable = input?.localChatBackendAvailable ?? true
  const configuredModelIds = new Set(Object.values(settings.providers || {}).map((provider: any) => String(provider?.modelId || '').trim()).filter(Boolean))
  const settingsModels = (settings.options || defaultModelSettings.options).map((model: any) => ({ ...model }))
  const chatModels = settingsModels
    .filter((model: any) => {
      if (!model.checked || model.locked) return false
      if (model.name === 'aiopsterm-local-agent') return localChatBackendAvailable === true
      return model.apiProvider === 'default' || configuredModelIds.has(model.name)
    })
    .map((model: any) => ({
      id: model.name,
      label: model.displayName || model.name,
      detail: model.name === 'aiopsterm-local-agent' ? 'Local aiopsterm development model' : `${model.apiProvider || 'custom'} configured model · Model ID: ${model.name}`,
      displayName: model.displayName,
      checked: model.checked,
      locked: model.locked,
      type: model.type,
      apiProvider: model.apiProvider
    }))
  return {
    chatModels,
    lockedChatModels: defaultLockedAiModels.map((model) => ({ ...model })),
    settingsModels
  }
}

const defaultKubernetesCatalog = {
  contexts: [
    { name: 'prod/admin', cluster: 'prod-cluster', namespace: 'default', server: 'https://prod.k8s.local:6443', isActive: true },
    { name: 'staging/devops', cluster: 'staging-cluster', namespace: 'staging', server: 'https://staging.k8s.local:6443', isActive: false }
  ],
  currentContext: 'prod/admin',
  clusters: [
    {
      id: 'k8s-1',
      name: 'prod-cluster',
      kubeconfig_path: '~/.kube/config',
      kubeconfig_content: null,
      context_name: 'prod/admin',
      server_url: 'https://prod.k8s.local:6443',
      auth_type: 'kubeconfig',
      is_active: 1,
      connection_status: 'connected' as const,
      auto_connect: 1,
      default_namespace: 'default',
      created_at: '2026-05-28 10:20',
      updated_at: '2026-06-03 09:30',
      source_type: 'local' as const,
      bastion_uuid: null,
      bastion_asset_address: null,
      bastion_asset_name: null,
      bastion_asset_id_last: null
    },
    {
      id: 'k8s-2',
      name: 'staging-cluster',
      kubeconfig_path: '~/.kube/staging',
      kubeconfig_content: null,
      context_name: 'staging/devops',
      server_url: 'https://staging.k8s.local:6443',
      auth_type: 'kubeconfig',
      is_active: 0,
      connection_status: 'disconnected' as const,
      auto_connect: 0,
      default_namespace: 'staging',
      created_at: '2026-05-28 11:20',
      updated_at: '2026-06-01 12:10',
      source_type: 'local' as const,
      bastion_uuid: null,
      bastion_asset_address: null,
      bastion_asset_name: null,
      bastion_asset_id_last: null
    },
    {
      id: 'k8s-3',
      name: 'jumpserver-prod',
      kubeconfig_path: null,
      kubeconfig_content: null,
      context_name: 'jumpserver/prod',
      server_url: '172.16.20.14:6443',
      auth_type: 'jumpserver',
      is_active: 0,
      connection_status: 'error' as const,
      auto_connect: 0,
      default_namespace: 'ops',
      created_at: '2026-05-30 15:00',
      updated_at: '2026-06-02 18:10',
      source_type: 'jumpserver' as const,
      bastion_uuid: 'org-1',
      bastion_asset_address: '172.16.20.14',
      bastion_asset_name: 'jumpserver-prod',
      bastion_asset_id_last: 1014
    }
  ],
  bastions: [
    { uuid: 'org-1', label: 'jumpserver-org', ip: 'bastion.internal' },
    { uuid: 'org-prod', label: 'prod-bastion', ip: '10.24.8.12' }
  ],
  namespaces: [
    { id: 'k8s-ns-prod-default', clusterId: 'k8s-1', name: 'default', status: 'Active', age: '92d' },
    { id: 'k8s-ns-prod-ops', clusterId: 'k8s-1', name: 'ops', status: 'Active', age: '77d' },
    { id: 'k8s-ns-prod-ingress', clusterId: 'k8s-1', name: 'ingress-nginx', status: 'Active', age: '64d' },
    { id: 'k8s-ns-staging', clusterId: 'k8s-2', name: 'staging', status: 'Active', age: '48d' },
    { id: 'k8s-ns-staging-ci', clusterId: 'k8s-2', name: 'ci', status: 'Active', age: '48d' },
    { id: 'k8s-ns-jump-ops', clusterId: 'k8s-3', name: 'ops', status: 'Active', age: '31d' }
  ],
  resources: [
    {
      id: 'k8s-pod-api-1',
      clusterId: 'k8s-1',
      kind: 'pods' as const,
      name: 'api-gateway-6d8c9bb7f6-l6j2m',
      namespace: 'default',
      status: 'Running',
      ready: '2/2',
      age: '3d',
      detail: 'REST ingress workload serving public API traffic.',
      node: 'prod-node-01',
      image: 'registry.internal/api-gateway:2.8.4',
      restarts: 0
    },
    {
      id: 'k8s-pod-worker-1',
      clusterId: 'k8s-1',
      kind: 'pods' as const,
      name: 'billing-worker-7f9d6f9dd9-rx8mm',
      namespace: 'ops',
      status: 'CrashLoopBackOff',
      ready: '0/1',
      age: '18h',
      detail: 'Background billing worker with repeated startup failures.',
      node: 'prod-node-03',
      image: 'registry.internal/billing-worker:1.15.2',
      restarts: 12
    },
    {
      id: 'k8s-pod-ingress-1',
      clusterId: 'k8s-1',
      kind: 'pods' as const,
      name: 'ingress-nginx-controller-66d8f7dbf6-vf9jg',
      namespace: 'ingress-nginx',
      status: 'Running',
      ready: '1/1',
      age: '21d',
      detail: 'Cluster ingress controller.',
      node: 'prod-node-02',
      image: 'registry.k8s.io/ingress-nginx/controller:v1.11.1',
      restarts: 1
    },
    {
      id: 'k8s-deploy-api',
      clusterId: 'k8s-1',
      kind: 'deployments' as const,
      name: 'api-gateway',
      namespace: 'default',
      status: 'Available',
      ready: '4/4',
      age: '38d',
      detail: 'RollingUpdate deployment for the public API gateway.',
      image: 'registry.internal/api-gateway:2.8.4',
      selector: 'app=api-gateway'
    },
    {
      id: 'k8s-deploy-worker',
      clusterId: 'k8s-1',
      kind: 'deployments' as const,
      name: 'billing-worker',
      namespace: 'ops',
      status: 'Progressing',
      ready: '2/3',
      age: '24d',
      detail: 'Worker deployment processing billing queue events.',
      image: 'registry.internal/billing-worker:1.15.2',
      selector: 'app=billing-worker'
    },
    {
      id: 'k8s-svc-api',
      clusterId: 'k8s-1',
      kind: 'services' as const,
      name: 'api-gateway',
      namespace: 'default',
      status: 'ClusterIP',
      ready: '10.96.12.40',
      age: '38d',
      detail: 'Internal service for api-gateway pods.',
      ports: '80/TCP, 443/TCP',
      selector: 'app=api-gateway'
    },
    {
      id: 'k8s-svc-ingress',
      clusterId: 'k8s-1',
      kind: 'services' as const,
      name: 'ingress-nginx-controller',
      namespace: 'ingress-nginx',
      status: 'LoadBalancer',
      ready: '10.96.32.10',
      age: '64d',
      detail: 'Ingress controller service exposing HTTP and HTTPS.',
      ports: '80:32080/TCP, 443:32443/TCP',
      selector: 'app.kubernetes.io/name=ingress-nginx'
    },
    {
      id: 'k8s-node-prod-1',
      clusterId: 'k8s-1',
      kind: 'nodes' as const,
      name: 'prod-node-01',
      namespace: 'cluster',
      status: 'Ready',
      ready: 'v1.29.3',
      age: '92d',
      detail: 'Control-plane capable production worker node.',
      node: '10.24.1.11'
    },
    {
      id: 'k8s-node-prod-2',
      clusterId: 'k8s-1',
      kind: 'nodes' as const,
      name: 'prod-node-02',
      namespace: 'cluster',
      status: 'Ready',
      ready: 'v1.29.3',
      age: '91d',
      detail: 'Production worker node running ingress and API workloads.',
      node: '10.24.1.12'
    },
    {
      id: 'k8s-pod-staging-api',
      clusterId: 'k8s-2',
      kind: 'pods' as const,
      name: 'staging-api-76f7d9cbf7-8l4xf',
      namespace: 'staging',
      status: 'Running',
      ready: '1/1',
      age: '9h',
      detail: 'Staging API pod for pre-release validation.',
      node: 'staging-node-01',
      image: 'registry.internal/api-gateway:2.9.0-rc1',
      restarts: 0
    },
    {
      id: 'k8s-deploy-staging-api',
      clusterId: 'k8s-2',
      kind: 'deployments' as const,
      name: 'staging-api',
      namespace: 'staging',
      status: 'Available',
      ready: '2/2',
      age: '12d',
      detail: 'Staging API deployment.',
      image: 'registry.internal/api-gateway:2.9.0-rc1',
      selector: 'app=staging-api'
    },
    {
      id: 'k8s-svc-staging-api',
      clusterId: 'k8s-2',
      kind: 'services' as const,
      name: 'staging-api',
      namespace: 'staging',
      status: 'ClusterIP',
      ready: '10.100.8.42',
      age: '12d',
      detail: 'Internal staging API service.',
      ports: '8080/TCP',
      selector: 'app=staging-api'
    },
    {
      id: 'k8s-node-staging-1',
      clusterId: 'k8s-2',
      kind: 'nodes' as const,
      name: 'staging-node-01',
      namespace: 'cluster',
      status: 'Ready',
      ready: 'v1.28.8',
      age: '48d',
      detail: 'Staging worker node.',
      node: '10.28.1.11'
    },
    {
      id: 'k8s-pod-jump-ops',
      clusterId: 'k8s-3',
      kind: 'pods' as const,
      name: 'ops-shell-0',
      namespace: 'ops',
      status: 'Pending',
      ready: '0/1',
      age: '42m',
      detail: 'JumpServer imported cluster workload waiting for scheduling.',
      node: '-',
      image: 'registry.internal/ops-shell:latest',
      restarts: 0
    }
  ],
  importContexts: [
    { name: 'prod/admin', cluster: 'prod-cluster', server: 'https://prod.k8s.local:6443', namespace: 'default' },
    { name: 'staging/devops', cluster: 'staging-cluster', server: 'https://staging.k8s.local:6443', namespace: 'staging' }
  ],
  activeClusterId: 'k8s-1',
  selectedClusterId: 'k8s-1',
  agentProxyConfig: {
    enabled: false,
    type: 'SOCKS5' as const,
    host: '127.0.0.1',
    port: 1080,
    enableProxyIdentity: false,
    username: '',
    password: '',
    updatedAt: ''
  }
}

type TestKubernetesConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error'
type TestKubernetesClusterSource = 'local' | 'jumpserver'
type TestKubernetesResourceKind = 'pods' | 'deployments' | 'services' | 'nodes'
type TestKubernetesResourceAction = 'get' | 'describe' | 'logs'
type TestKubernetesAgentProxyConfig = {
  enabled: boolean
  type: 'HTTP' | 'HTTPS' | 'SOCKS4' | 'SOCKS5'
  host: string
  port: number
  enableProxyIdentity: boolean
  username: string
  password: string
  updatedAt: string
}
type TestKubernetesCatalog = {
  contexts: Array<{ name: string; cluster: string; namespace: string; server: string; isActive: boolean }>
  currentContext: string
  clusters: Array<{
    id: string
    name: string
    kubeconfig_path: string | null
    kubeconfig_content: string | null
    context_name: string
    server_url: string
    auth_type: string
    is_active: number
    connection_status: TestKubernetesConnectionStatus
    auto_connect: number
    default_namespace: string
    created_at: string
    updated_at: string
    source_type: TestKubernetesClusterSource
    bastion_uuid: string | null
    bastion_asset_address: string | null
    bastion_asset_name: string | null
    bastion_asset_id_last: number | null
  }>
  bastions: Array<{ uuid: string; label: string; ip: string }>
  namespaces: Array<{ id: string; clusterId: string; name: string; status: string; age: string }>
  resources: Array<{
    id: string
    clusterId: string
    kind: TestKubernetesResourceKind
    name: string
    namespace: string
    status: string
    ready: string
    age: string
    detail: string
    node?: string
    image?: string
    ports?: string
    restarts?: number
    selector?: string
  }>
  importContexts: Array<{ name: string; cluster: string; server: string; namespace: string }>
  activeClusterId: string | null
  selectedClusterId: string | null
  agentProxyConfig: TestKubernetesAgentProxyConfig
}
type TestKubernetesCluster = TestKubernetesCatalog['clusters'][number]
type TestKubernetesContext = TestKubernetesCatalog['contexts'][number]

const cloneKubernetesCatalog = (catalog: TestKubernetesCatalog = kubernetesCatalogMock): TestKubernetesCatalog => ({
  contexts: catalog.contexts.map((context) => ({ ...context })),
  currentContext: catalog.contexts.find((context) => context.isActive)?.name || catalog.currentContext,
  clusters: catalog.clusters.map((cluster) => ({ ...cluster })),
  bastions: catalog.bastions.map((bastion) => ({ ...bastion })),
  namespaces: catalog.namespaces.map((namespace) => ({ ...namespace })),
  resources: catalog.resources.map((resource) => ({ ...resource })),
  importContexts: catalog.importContexts.map((context) => ({ ...context })),
  activeClusterId: catalog.clusters.find((cluster) => cluster.is_active === 1)?.id || null,
  selectedClusterId: catalog.selectedClusterId || catalog.clusters[0]?.id || null,
  agentProxyConfig: { ...catalog.agentProxyConfig }
})

let kubernetesCatalogMock: TestKubernetesCatalog = {
  contexts: defaultKubernetesCatalog.contexts.map((context) => ({ ...context })),
  currentContext: defaultKubernetesCatalog.currentContext,
  clusters: defaultKubernetesCatalog.clusters.map((cluster) => ({ ...cluster })),
  bastions: defaultKubernetesCatalog.bastions.map((bastion) => ({ ...bastion })),
  namespaces: defaultKubernetesCatalog.namespaces.map((namespace) => ({ ...namespace })),
  resources: defaultKubernetesCatalog.resources.map((resource) => ({ ...resource })),
  importContexts: defaultKubernetesCatalog.importContexts.map((context) => ({ ...context })),
  activeClusterId: defaultKubernetesCatalog.activeClusterId,
  selectedClusterId: defaultKubernetesCatalog.selectedClusterId,
  agentProxyConfig: { ...defaultKubernetesCatalog.agentProxyConfig }
}

const resetKubernetesCatalogMock = () => {
  kubernetesCatalogMock = {
    contexts: defaultKubernetesCatalog.contexts.map((context) => ({ ...context })),
    currentContext: defaultKubernetesCatalog.currentContext,
    clusters: defaultKubernetesCatalog.clusters.map((cluster) => ({ ...cluster })),
    bastions: defaultKubernetesCatalog.bastions.map((bastion) => ({ ...bastion })),
    namespaces: defaultKubernetesCatalog.namespaces.map((namespace) => ({ ...namespace })),
    resources: defaultKubernetesCatalog.resources.map((resource) => ({ ...resource })),
    importContexts: defaultKubernetesCatalog.importContexts.map((context) => ({ ...context })),
    activeClusterId: defaultKubernetesCatalog.activeClusterId,
    selectedClusterId: defaultKubernetesCatalog.selectedClusterId,
    agentProxyConfig: { ...defaultKubernetesCatalog.agentProxyConfig }
  }
  kubernetesTerminalSequenceMock = 1
  kubernetesTerminalSessionsMock = []
  kubernetesTerminalDataListenersMock.clear()
  kubernetesTerminalExitListenersMock.clear()
}

const k8sCatalogResultMock = (extra?: Record<string, unknown>) => ({ ok: true, data: { ...cloneKubernetesCatalog(), ...extra } })

const upsertKubernetesContextMock = (cluster: TestKubernetesCluster, isActive = cluster.is_active === 1) => {
  const context: TestKubernetesContext = {
    name: cluster.context_name,
    cluster: cluster.name,
    namespace: cluster.default_namespace,
    server: cluster.server_url,
    isActive
  }
  kubernetesCatalogMock.contexts = kubernetesCatalogMock.contexts.some((item) => item.name === context.name)
    ? kubernetesCatalogMock.contexts.map((item) => (item.name === context.name ? context : item))
    : [context, ...kubernetesCatalogMock.contexts]
  const importContext = { name: context.name, cluster: context.cluster, server: context.server, namespace: context.namespace }
  kubernetesCatalogMock.importContexts = kubernetesCatalogMock.importContexts.some((item) => item.name === importContext.name)
    ? kubernetesCatalogMock.importContexts.map((item) => (item.name === importContext.name ? importContext : item))
    : [importContext, ...kubernetesCatalogMock.importContexts]
}

const findKubernetesClusterMock = (id: string) => kubernetesCatalogMock.clusters.find((cluster) => cluster.id === id) || null
const findKubernetesResourceMock = (id: string) => kubernetesCatalogMock.resources.find((resource) => resource.id === id) || null

const k8sIdPartMock = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item'
const jumpserverKubernetesAssetAddressMock = (asset: TestAssetRecord) => trimMock(asset.host) || trimMock(asset.ip)
const jumpserverKubernetesAssetNameMock = (asset: TestAssetRecord, address: string) => trimMock(asset.title) || trimMock(asset.name) || address
const jumpserverKubernetesServerUrlMock = (address: string) => {
  if (/^https?:\/\//i.test(address)) return address
  if (/^\[[^\]]+\]:\d+$/.test(address) || /^[^:]+:\d+$/.test(address)) return address
  return `${address}:6443`
}
const numericAssetIdMock = (asset: TestAssetRecord) => {
  const rawId = [asset.id, asset.uuid].map(trimMock).find((value) => /^\d+$/.test(value))
  return rawId ? Number(rawId) : null
}
const isJumpserverKubernetesAssetMock = (asset: TestAssetRecord, organizationIds: Set<string>) => {
  if (asset.asset_type === 'organization' || asset.isLocalShell) return false
  if (!organizationIds.has(trimMock(asset.organizationId))) return false
  const address = jumpserverKubernetesAssetAddressMock(asset)
  if (!address) return false
  const tags = new Set((Array.isArray(asset.tags) ? asset.tags : []).map((tag) => tag.toLowerCase()))
  return asset.data_source === 'refresh' || tags.has('jumpserver') || tags.has('synced') || tags.has('k8s') || tags.has('kubernetes')
}
const upsertJumpserverKubernetesClustersMock = (bastion: TestKubernetesCatalog['bastions'][number], assets: TestAssetRecord[]) => {
  const existingByKey = new Map<string, TestKubernetesCluster>()
  const keyFor = (address: string, name: string) => `${bastion.uuid}\u0000${address}\u0000${name}`
  kubernetesCatalogMock.clusters
    .filter((cluster) => cluster.source_type === 'jumpserver' && cluster.bastion_uuid === bastion.uuid)
    .forEach((cluster) => {
      if (cluster.bastion_asset_address && cluster.bastion_asset_name) {
        existingByKey.set(keyFor(cluster.bastion_asset_address, cluster.bastion_asset_name), cluster)
      }
    })

  const updates = new Map<string, TestKubernetesCluster>()
  const inserted: TestKubernetesCluster[] = []
  const seenKeys = new Set<string>()
  let syncedCount = 0
  let updatedCount = 0

  assets.forEach((asset) => {
    const address = jumpserverKubernetesAssetAddressMock(asset)
    if (!address) return
    const name = jumpserverKubernetesAssetNameMock(asset, address)
    const key = keyFor(address, name)
    if (seenKeys.has(key)) return
    seenKeys.add(key)

    const existing = existingByKey.get(key)
    if (existing) {
      const next: TestKubernetesCluster = {
        ...existing,
        name,
        context_name: name,
        server_url: jumpserverKubernetesServerUrlMock(address),
        auth_type: 'jumpserver',
        default_namespace: existing.default_namespace || 'default',
        source_type: 'jumpserver',
        bastion_uuid: bastion.uuid,
        bastion_asset_address: address,
        bastion_asset_name: name,
        bastion_asset_id_last: numericAssetIdMock(asset),
        updated_at: '刚刚'
      }
      updates.set(existing.id, next)
      upsertKubernetesContextMock(next)
      updatedCount += 1
      return
    }

    const identity = trimMock(asset.uuid) || trimMock(asset.id) || `${address}-${name}`
    const cluster: TestKubernetesCluster = {
      id: `k8s-js-${k8sIdPartMock(bastion.uuid)}-${k8sIdPartMock(identity)}`,
      name,
      kubeconfig_path: null,
      kubeconfig_content: null,
      context_name: name,
      server_url: jumpserverKubernetesServerUrlMock(address),
      auth_type: 'jumpserver',
      is_active: 0,
      connection_status: 'disconnected',
      auto_connect: 0,
      default_namespace: 'default',
      created_at: '刚刚',
      updated_at: '刚刚',
      source_type: 'jumpserver',
      bastion_uuid: bastion.uuid,
      bastion_asset_address: address,
      bastion_asset_name: name,
      bastion_asset_id_last: numericAssetIdMock(asset)
    }
    inserted.push(cluster)
    upsertKubernetesContextMock(cluster, false)
    syncedCount += 1
  })

  kubernetesCatalogMock.clusters = [...inserted, ...kubernetesCatalogMock.clusters.map((cluster) => updates.get(cluster.id) || cluster)]
  return { syncedCount, updatedCount }
}

const k8sResourceTypeByKindMock: Record<TestKubernetesResourceKind, string> = {
  pods: 'pod',
  deployments: 'deployment',
  services: 'service',
  nodes: 'node'
}

const k8sResourceActionTitleMock: Record<TestKubernetesResourceAction, string> = {
  get: 'Get',
  describe: 'Describe',
  logs: 'Logs'
}

const normalizeKubernetesResourceActionMock = (action: TestKubernetesResourceAction | undefined): TestKubernetesResourceAction =>
  action === 'describe' || action === 'logs' || action === 'get' ? action : 'get'

const k8sResourceActionPlanMock = (resourceId: string, action?: TestKubernetesResourceAction) => {
  const resource = findKubernetesResourceMock(resourceId)
  if (!resource) return { ok: false, errorCode: 'K8S_RESOURCE_NOT_FOUND', errorMessage: 'Kubernetes resource not found.' }
  const cluster = findKubernetesClusterMock(resource.clusterId)
  if (!cluster) return { ok: false, errorCode: 'K8S_CLUSTER_NOT_FOUND', errorMessage: 'Kubernetes cluster not found.' }
  const normalizedAction = normalizeKubernetesResourceActionMock(action)
  if (normalizedAction === 'logs' && resource.kind !== 'pods') {
    return { ok: false, errorCode: 'K8S_RESOURCE_LOGS_POD_REQUIRED', errorMessage: 'Kubernetes logs are only available for pods.' }
  }
  const namespace = resource.kind === 'nodes' ? 'all' : resource.namespace
  const namespaceArg = resource.kind === 'nodes' ? '' : ` -n ${resource.namespace}`
  const type = k8sResourceTypeByKindMock[resource.kind]
  const command =
    normalizedAction === 'logs'
      ? `kubectl logs ${resource.name}${namespaceArg} --tail=120`
      : normalizedAction === 'describe'
        ? `kubectl describe ${type} ${resource.name}${namespaceArg}`
        : `kubectl get ${type} ${resource.name}${namespaceArg} -o wide`
  return {
    ok: true,
    data: {
      resourceId: resource.id,
      resourceName: resource.name,
      resourceKind: resource.kind,
      action: normalizedAction,
      title: `${k8sResourceActionTitleMock[normalizedAction]} ${resource.name}`,
      command,
      clusterId: cluster.id,
      clusterName: cluster.name,
      contextName: cluster.context_name,
      namespace
    }
  }
}

const k8sRefreshCommandMock = (kind: TestKubernetesResourceKind | 'all', namespace: string) => {
  if (kind === 'all') {
    return ['kubectl get namespaces', 'kubectl get pods --all-namespaces', 'kubectl get deployments --all-namespaces', 'kubectl get services --all-namespaces', 'kubectl get nodes'].join(' && ')
  }
  if (kind === 'nodes') return 'kubectl get nodes'
  return namespace === 'all' ? `kubectl get ${kind} --all-namespaces` : `kubectl get ${kind} -n ${namespace}`
}

const normalizeKubernetesCommandMock = (command: string) => command.trim().replace(/\s+/g, ' ')

const kubernetesSeedUnsupportedCommandMessageMock = (command: string) =>
  `Kubernetes development seed data cannot execute "${command}". Select a kubeconfig-backed cluster to run arbitrary kubectl commands.`

const kubernetesKindFromCommandTokenMock = (token: string): TestKubernetesResourceKind | null => {
  if (/^pods?$/.test(token)) return 'pods'
  if (/^deploy(ments?)?$/.test(token) || /^deployments?$/.test(token)) return 'deployments'
  if (/^svc$|^services?$/.test(token)) return 'services'
  if (/^nodes?$/.test(token)) return 'nodes'
  return null
}

const namespaceFromKubernetesCommandMock = (command: string, fallback: string) => {
  const namespaceMatch = command.match(/(?:-n|--namespace)(?:=|\s+)([^\s]+)/)
  return namespaceMatch?.[1] || fallback
}

const renderKubernetesListMock = (command: string, clusterId: string, namespace: string) => {
  const getKind = command.match(/^kubectl\s+get\s+([^\s]+)/)
  const kind = getKind ? kubernetesKindFromCommandTokenMock(getKind[1]) : null
  if (!kind) return ''
  const includeAll = command.includes('--all-namespaces') || command.includes(' -A')
  const targetNamespace = namespaceFromKubernetesCommandMock(command, namespace)
  const parts = command.split(/\s+/)
  const kindIndex = parts[0] === 'kubectl' && parts[1] === 'get' ? 2 : -1
  const requestedName = kindIndex >= 0 && parts[kindIndex + 1] && !parts[kindIndex + 1].startsWith('-') ? parts[kindIndex + 1] : ''
  const rows = kubernetesCatalogMock.resources
    .filter((resource) => resource.clusterId === clusterId && resource.kind === kind)
    .filter((resource) => kind === 'nodes' || includeAll || resource.namespace === targetNamespace)
    .filter((resource) => !requestedName || resource.name === requestedName)
    .map((resource) =>
      [
        kind !== 'nodes' && includeAll ? resource.namespace : '',
        resource.name,
        resource.ready,
        resource.status,
        kind === 'pods' ? String(resource.restarts || 0) : resource.node || resource.ports || resource.selector || '-',
        resource.age
      ]
        .filter(Boolean)
        .join('\t')
    )
    .join('\n')
  if (requestedName && !rows) return `Error from server (NotFound): ${k8sResourceTypeByKindMock[kind]}s "${requestedName}" not found`
  return rows
}

const findKubernetesCommandResourceMock = (clusterId: string, kind: TestKubernetesResourceKind, name: string, namespace: string) =>
  kubernetesCatalogMock.resources.find((resource) => resource.clusterId === clusterId && resource.kind === kind && resource.name === name && (kind === 'nodes' || resource.namespace === namespace))

const renderKubernetesLogsMock = (command: string, clusterId: string, namespace: string) => {
  const match = command.match(/^kubectl\s+logs\s+([^\s]+)/)
  if (!match) return ''
  const podName = match[1]
  const targetNamespace = namespaceFromKubernetesCommandMock(command, namespace)
  const resource = findKubernetesCommandResourceMock(clusterId, 'pods', podName, targetNamespace)
  if (!resource) return `Error from server (NotFound): pods "${podName}" not found`
  return [
    `2026-06-04T09:27:59Z info starting container ${resource.name}`,
    `2026-06-04T09:28:02Z info namespace=${resource.namespace} node=${resource.node || '-'}`,
    resource.status === 'CrashLoopBackOff' ? '2026-06-04T09:28:11Z error failed to load billing config: missing secret billing-api-token' : '',
    `2026-06-04T09:28:15Z info readiness probe ${resource.status === 'Running' ? 'passed' : 'pending'}`
  ]
    .filter(Boolean)
    .join('\n')
}

const renderKubernetesDescribeMock = (command: string, clusterId: string, namespace: string) => {
  const match = command.match(/^kubectl\s+describe\s+([^\s]+)\s+([^\s]+)/)
  if (!match) return ''
  const kind = kubernetesKindFromCommandTokenMock(match[1])
  if (!kind) return ''
  const name = match[2]
  const targetNamespace = kind === 'nodes' ? 'cluster' : namespaceFromKubernetesCommandMock(command, namespace)
  const resource = findKubernetesCommandResourceMock(clusterId, kind, name, targetNamespace)
  if (!resource) return `Error from server (NotFound): ${k8sResourceTypeByKindMock[kind]}s "${name}" not found`
  return [
    `Name: ${resource.name}`,
    `Namespace: ${resource.kind === 'nodes' ? '<cluster>' : resource.namespace}`,
    `Kind: ${k8sResourceTypeByKindMock[resource.kind]}`,
    `Status: ${resource.status}`,
    `Ready: ${resource.ready}`,
    resource.node ? `Node: ${resource.node}` : '',
    resource.image ? `Image: ${resource.image}` : '',
    resource.ports ? `Ports: ${resource.ports}` : '',
    resource.selector ? `Selector: ${resource.selector}` : '',
    resource.restarts !== undefined ? `Restarts: ${resource.restarts}` : '',
    `Age: ${resource.age}`,
    '',
    `Events: ${resource.detail}`
  ]
    .filter(Boolean)
    .join('\n')
}

const renderKubernetesSeedCommandMock = (input: {
  command: string
  clusterId?: string
  clusterName?: string
  namespace?: string
  contextName?: string
  defaultNamespace?: string
}) => {
  const command = normalizeKubernetesCommandMock(input.command)
  const cluster = findKubernetesClusterMock(input.clusterId || '') || {
    id: input.clusterId || '',
    name: input.clusterName || input.clusterId || 'unknown-cluster',
    context_name: input.contextName || 'unknown-context',
    default_namespace: input.defaultNamespace || 'default'
  }
  const namespace = input.namespace || cluster.default_namespace || 'default'
  const result = (output: string) => {
    const success = !output.startsWith('Error from server')
    return { output, success, error: success ? '' : output }
  }
  const unsupported = () => {
    const message = kubernetesSeedUnsupportedCommandMessageMock(command)
    return { output: message, success: false, error: message }
  }
  if (/^kubectl\s+config\s+current-context\b/.test(command)) return result(cluster.context_name)
  if (/^kubectl\s+version\b/.test(command)) {
    return result(['Client Version: v1.30.0-aiopsterm', 'Kustomize Version: v5.0.4', `Server Version: ${cluster.name || 'cluster'} api v1.29.4`].join('\n'))
  }
  if (/^kubectl\s+get\s+ns\b|^kubectl\s+get\s+namespaces\b/.test(command)) {
    return result(
      kubernetesCatalogMock.namespaces
        .filter((item) => item.clusterId === cluster.id)
        .map((item) => `${item.name}\t${item.status}\t${item.age}`)
        .join('\n')
    )
  }
  if (/^kubectl\s+get\s+/.test(command)) {
    const getKind = command.match(/^kubectl\s+get\s+([^\s]+)/)
    if (!getKind || !kubernetesKindFromCommandTokenMock(getKind[1])) return unsupported()
    return result(renderKubernetesListMock(command, cluster.id, namespace))
  }
  if (/^kubectl\s+logs\s+/.test(command)) return result(renderKubernetesLogsMock(command, cluster.id, namespace))
  if (/^kubectl\s+describe\s+/.test(command)) {
    const output = renderKubernetesDescribeMock(command, cluster.id, namespace)
    return output ? result(output) : unsupported()
  }
  return unsupported()
}

const refreshedKubernetesResourceCountMock = (clusterId: string, kind: TestKubernetesResourceKind | 'all', namespace: string) =>
  kubernetesCatalogMock.resources.filter((resource) => {
    if (resource.clusterId !== clusterId) return false
    if (kind !== 'all' && resource.kind !== kind) return false
    if (resource.kind !== 'nodes' && namespace !== 'all' && resource.namespace !== namespace) return false
    return true
  }).length

const findKubernetesTestContextMock = (contextName: string) => {
  const imported = kubernetesCatalogMock.importContexts.find((context) => context.name === contextName)
  if (imported) return imported
  const context = kubernetesCatalogMock.contexts.find((item) => item.name === contextName)
  if (context) return { name: context.name, cluster: context.cluster, server: context.server, namespace: context.namespace }
  const cluster = kubernetesCatalogMock.clusters.find((item) => item.context_name === contextName)
  if (!cluster) return null
  return {
    name: cluster.context_name,
    cluster: cluster.name,
    server: cluster.server_url,
    namespace: cluster.default_namespace
  }
}

const parseKubernetesContextsFromContentMock = (content: string) => {
  const lines = content.split(/\r?\n/)
  const clusters = new Map<string, string>()
  const contexts: TestKubernetesCatalog['importContexts'] = []
  const currentContext = lines.map((line) => {
    const match = line.match(/^\s*current-context\s*:\s*(.*)$/)
    return trimMock(match?.[1]).replace(/^['"]|['"]$/g, '')
  }).find(Boolean) || ''
  let section = ''
  let clusterName = ''
  let activeContext = ''
  let activeCluster = ''
  let activeNamespace = ''

  const valueAfter = (line: string, key: string) => {
    const match = line.match(new RegExp(`^\\s*${key}\\s*:\\s*(.*)$`))
    return trimMock(match?.[1]).replace(/^['"]|['"]$/g, '')
  }
  const flushContext = () => {
    if (!activeContext || !activeCluster) return
    contexts.push({
      name: activeContext,
      cluster: activeCluster,
      server: clusters.get(activeCluster) || '',
      namespace: activeNamespace || 'default'
    })
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ')
    if (/^\s*clusters\s*:\s*$/.test(line)) {
      flushContext()
      section = 'clusters'
      clusterName = ''
      activeContext = ''
      activeCluster = ''
      activeNamespace = ''
      continue
    }
    if (/^\s*contexts\s*:\s*$/.test(line)) {
      flushContext()
      section = 'contexts'
      clusterName = ''
      activeContext = ''
      activeCluster = ''
      activeNamespace = ''
      continue
    }
    if (section === 'clusters') {
      const name = line.match(/^\s*-\s+name\s*:\s*(.+)$/)
      if (name) {
        clusterName = trimMock(name[1])
        clusters.set(clusterName, '')
        continue
      }
      const server = valueAfter(line, 'server')
      if (clusterName && server) clusters.set(clusterName, server)
      continue
    }
    if (section === 'contexts') {
      const name = line.match(/^\s*-\s+name\s*:\s*(.+)$/)
      if (name) {
        flushContext()
        activeContext = trimMock(name[1])
        activeCluster = ''
        activeNamespace = ''
        continue
      }
      const cluster = valueAfter(line, 'cluster')
      if (cluster) activeCluster = cluster
      const namespace = valueAfter(line, 'namespace')
      if (namespace) activeNamespace = namespace
    }
  }
  flushContext()
  return {
    contexts: contexts.filter((context, index, list) => list.findIndex((item) => item.name === context.name) === index),
    currentContext
  }
}

const parseKubernetesContextFromContentMock = (content: string, contextName: string) =>
  parseKubernetesContextsFromContentMock(content).contexts.find((context) => context.name === contextName) || null

const defaultShortcuts = [
  { id: 'newTerminal', action: '新建终端', shortcut: 'Ctrl+Shift+T' },
  { id: 'toggleAi', action: '显示/隐藏 AI 侧边栏', shortcut: 'Ctrl+Shift+A' },
  { id: 'switchToSpecificTab', action: '切换到指定标签', shortcut: 'Alt', suffix: '1-9' },
  { id: 'quickCommand', action: '打开快捷命令', shortcut: 'Ctrl+Shift+P' }
]

const defaultRules = [
  { id: 'rule-1', content: '执行生产变更前必须先给出只读检查命令和回滚点。', enabled: true },
  { id: 'rule-2', content: '不要自动执行删除、重启、扩容、写文件或修改配置类命令。', enabled: true }
]

type TestSettingsShortcut = (typeof defaultShortcuts)[number]
type TestSettingsRule = (typeof defaultRules)[number]
type TestSettingsPreferences = {
  shortcuts: TestSettingsShortcut[]
  rules: TestSettingsRule[]
}

const isPlainObjectMock = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const trimMock = (value: unknown) => String(value || '').trim()
const shortcutModifierTokensMock = new Set(['ctrl', 'control', 'shift', 'alt', 'option', 'cmd', 'command', 'meta'])
const defaultShortcutsByIdMock = new Map(defaultShortcuts.map((shortcut) => [shortcut.id, shortcut]))

const cloneSettingsPreferencesMock = (preferences: TestSettingsPreferences): TestSettingsPreferences => ({
  shortcuts: preferences.shortcuts.map((shortcut) => ({ ...shortcut })),
  rules: preferences.rules.map((rule) => ({ ...rule }))
})

const isValidShortcutForActionMock = (actionId: string, shortcut: string) => {
  const parts = shortcut.split('+').map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return false
  if (actionId !== 'switchToSpecificTab') return true
  const hasDigit = parts.some((part) => /^\d$/.test(part))
  const hasModifier = parts.some((part) => shortcutModifierTokensMock.has(part.toLowerCase()))
  return !hasDigit && hasModifier
}

const resolveShortcutSeedMock = (source: unknown) => {
  if (!isPlainObjectMock(source)) return source
  if (isPlainObjectMock(source.linux)) return source.linux
  if (isPlainObjectMock(source.windows)) return source.windows
  if (isPlainObjectMock(source.mac)) return source.mac
  return source
}

const normalizeSettingsShortcutsMock = (source?: unknown): TestSettingsShortcut[] => {
  const resolved = resolveShortcutSeedMock(source)
  const shortcutsById = new Map<string, string>()
  if (Array.isArray(resolved)) {
    resolved.forEach((item) => {
      if (!isPlainObjectMock(item)) return
      const id = trimMock(item.id)
      const shortcut = trimMock(item.shortcut)
      if (!defaultShortcutsByIdMock.has(id) || !shortcut || shortcutsById.has(id) || !isValidShortcutForActionMock(id, shortcut)) return
      shortcutsById.set(id, shortcut)
    })
  } else if (isPlainObjectMock(resolved)) {
    Object.entries(resolved).forEach(([id, value]) => {
      const shortcut = trimMock(value)
      if (!defaultShortcutsByIdMock.has(id) || !shortcut || shortcutsById.has(id) || !isValidShortcutForActionMock(id, shortcut)) return
      shortcutsById.set(id, shortcut)
    })
  }
  return defaultShortcuts.map((defaultShortcut) => ({
    ...defaultShortcut,
    shortcut: shortcutsById.get(defaultShortcut.id) || defaultShortcut.shortcut
  }))
}

const normalizeSettingsRulesMock = (source?: unknown, customInstructions?: unknown): TestSettingsRule[] => {
  const rawRules = Array.isArray(source) ? source : defaultRules
  const seenIds = new Set<string>()
  const rules: TestSettingsRule[] = []
  rawRules.forEach((item, index) => {
    if (!isPlainObjectMock(item)) return
    const content = trimMock(item.content)
    if (!content) return
    let id = trimMock(item.id) || `rule-${index + 1}`
    while (seenIds.has(id)) id = `${id}-${index + 1}`
    seenIds.add(id)
    rules.push({
      id,
      content,
      enabled: item.enabled !== undefined ? Boolean(item.enabled) : true
    })
  })
  const migratedInstruction = trimMock(customInstructions)
  if (migratedInstruction) {
    let id = 'rule-custom-instructions'
    let suffix = 1
    while (seenIds.has(id)) {
      suffix += 1
      id = `rule-custom-instructions-${suffix}`
    }
    rules.unshift({
      id,
      content: migratedInstruction,
      enabled: true
    })
  }
  return rules
}

const normalizeSettingsPreferencesMock = (seed?: { shortcuts?: unknown; rules?: unknown; customInstructions?: unknown }): TestSettingsPreferences => ({
  shortcuts: normalizeSettingsShortcutsMock(seed?.shortcuts),
  rules: normalizeSettingsRulesMock(seed?.rules, seed?.customInstructions)
})

Object.assign(globalThis, {
  __setSettingsPreferencesStoreMock: (seed?: { shortcuts?: unknown; rules?: unknown; customInstructions?: unknown }) => {
    settingsPreferencesStoreMock = normalizeSettingsPreferencesMock(seed)
  },
  __resetSettingsPreferencesStoreMock: () => {
    settingsPreferencesStoreMock = null
  }
})

const defaultSkills = [
  {
    name: 'incident-triage',
    description: 'Collect symptoms, recent changes, and affected services.',
    enabled: true,
    editable: true,
    content: 'When incident triage is requested, collect scope, blast radius, and recent deployments first.',
    path: '/tmp/aiopsterm/skills/incident-triage/SKILL.md'
  },
  {
    name: 'k8s-rollout',
    description: 'Guide Kubernetes rollout inspection and rollback planning.',
    enabled: true,
    editable: true,
    content: 'Prefer kubectl describe, events, image pull checks, and rollback safety checks.',
    path: '/tmp/aiopsterm/skills/k8s-rollout/SKILL.md'
  }
]

const cloneDefaultSkills = () => defaultSkills.map((skill) => ({ ...skill }))
let skillsStoreMock = cloneDefaultSkills()
const cloneSkills = () => skillsStoreMock.map((skill) => ({ ...skill }))
const resetSkillsStoreMock = () => {
  skillsStoreMock = cloneDefaultSkills()
}
const createSkillWriteResultMock = (skill: (typeof defaultSkills)[number]) => {
  const bytes = Buffer.byteLength(skill.content, 'utf8')
  return {
    skill: { ...skill },
    filePath: skill.path,
    bytes,
    size: bytes,
    mtimeMs: Date.parse('2026-06-04T12:00:00+08:00')
  }
}
const createSkillImportResultMock = (skill: (typeof defaultSkills)[number]) => ({
  success: true,
  skillName: skill.name,
  skill: { ...skill },
  importedPath: skill.path,
  bytes: Buffer.byteLength(skill.content, 'utf8'),
  files: 1,
  importedAt: '2026-06-04T12:00:00+08:00'
})

const defaultMcpServers: McpServerUserConfig[] = [
  {
    name: 'filesystem',
    status: 'connected',
    disabled: false,
    tools: [
      {
        name: 'read_file',
        description: 'Read a workspace file for agent context.',
        enabled: true,
        parameters: [
          { name: 'path', description: 'Absolute file path.', required: true },
          { name: 'encoding', description: 'Optional text encoding.' }
        ]
      },
      {
        name: 'list_directory',
        description: 'List files under a directory.',
        enabled: true,
        parameters: [{ name: 'path', description: 'Directory path.', required: true }]
      }
    ],
    resources: [{ name: 'workspace-root', description: 'Current aiopsterm workspace.', uri: 'file:///workspace' }]
  },
  {
    name: 'ops-inventory',
    status: 'error',
    disabled: false,
    error: 'Token expired',
    tools: [
      {
        name: 'lookup_asset',
        description: 'Find a host by name, tag, or IP.',
        enabled: false,
        parameters: [{ name: 'query', description: 'Asset search query.', required: true }]
      }
    ],
    resources: []
  }
]

const defaultMcpToolStates = {
  'filesystem:read_file': true,
  'filesystem:list_directory': true,
  'ops-inventory:lookup_asset': false
}

const cloneMcpServerMock = (server: McpServerUserConfig): McpServerUserConfig => ({
  ...server,
  tools: server.tools.map((tool) => ({
    ...tool,
    parameters: tool.parameters.map((parameter) => ({ ...parameter }))
  })),
  resources: server.resources.map((resource) => ({ ...resource }))
})

const getMcpToolStatesMock = (servers: Array<{ name: string; tools: Array<{ name: string; enabled: boolean }> }>) =>
  Object.fromEntries(servers.flatMap((server) => server.tools.map((tool) => [`${server.name}:${tool.name}`, tool.enabled])))

type TestAssetRecord = {
  id: string
  uuid: string
  name: string
  title: string
  host: string
  ip: string
  group: string
  group_name: string
  status: 'online' | 'offline' | 'unknown'
  tags: string[]
  username: string
  port: number
  asset_type: 'person' | 'organization' | 'switch'
  auth_type: 'password' | 'keyBased'
  comment: string
  data_source: 'manual' | 'refresh' | 'import'
  favorite?: boolean
  folderUuid?: string
  organizationId?: string
  tunnelState?: 'created' | 'active'
  needProxy?: boolean
  proxyName?: string
  keychainId?: string
  jumpHostId?: string
  hasPassword?: boolean
  hasPrivateKey?: boolean
  isLocalShell?: boolean
}

type TestSshTunnelType = 'local_forward' | 'remote_forward' | 'dynamic_socks'

type TestSshTunnelRecord = {
  assetId: string
  tunnelId: string
  type: TestSshTunnelType
  state: 'created' | 'active'
  localPort?: number
  remoteHost?: string
  remotePort?: number
  startedAt?: string
  stoppedAt?: string
}

type TestAssetInput = Partial<TestAssetRecord> & {
  name: string
  host: string
  username?: string
  password?: string
  privateKey?: string
}

type TestAssetSecret = {
  password?: string
}

type TestAssetFolder = {
  uuid: string
  name: string
  description: string
  parentUuid?: string
  scope?: 'direct' | 'bastion'
}
type TestAssetFolderSaveInput = {
  uuid?: string
  name: string
  description?: string
  parentUuid?: string
  scope?: 'direct' | 'bastion'
}

type TestKeychainRecord = {
  id: string
  name: string
  type: 'rsa' | 'ed25519' | 'ecdsa'
  publicKey: string
  privateKey?: string
  passphrase?: string
  hasPrivateKey: boolean
  createdAt: number
  updatedAt: number
}

type TestKeychainInput = {
  id?: string
  name: string
  type?: 'rsa' | 'ed25519' | 'ecdsa'
  publicKey?: string
  privateKey?: string
  passphrase?: string
}

type TestTerminalCreateOptions = {
  kind?: 'local' | 'ssh'
  assetId?: string
  title?: string
  cols?: number
  rows?: number
  terminalType?: string
  ssh?: {
    host: string
    port?: number
    username: string
    forkFromConnectionId?: string
  }
}

type TestChatHistoryHostContext = {
  id: string
  kind: 'hosts'
  label: string
  detail?: string
}

type TestAiChatMessageInput = {
  role: 'user' | 'assistant' | 'system'
  text: string
}

type TestAiChatContextInput = {
  id: string
  kind: string
  label: string
  detail?: string
  relPath?: string
  mediaType?: string
}

type TestAiChatCommandInput = {
  id?: string
  label?: string
  command?: string
  path?: string
}

type TestChatHistoryMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  hosts?: TestChatHistoryHostContext[]
  state?: 'streaming' | 'done' | 'cancelled' | 'error'
  favorite?: boolean
  feedback?: 'up' | 'down'
  ask?: 'command' | 'mcp_tool_call' | 'mcp_resource_access' | 'followup'
  say?: 'command' | 'command_output' | 'search_result' | 'context_truncated'
  action?: 'approved' | 'rejected'
  commandExecution?: {
    ip: string
    command: string
    requiresApproval: boolean
    interactive: boolean
  }
  mcpToolCall?: {
    serverName: string
    toolName: string
    arguments?: Record<string, unknown>
  }
  mcpResourceAccess?: {
    serverName: string
    uri: string
  }
}

type TestChatConversationRecord = {
  id: string
  title: string
  summary: string
  updatedAt: string
  ts: number
  ipAddress?: string
  favorite?: boolean
}

type TestChatConversationUpdateInput = {
  id: string
  title?: string
  summary?: string
  favorite?: boolean
  messages?: TestChatHistoryMessage[]
}

type TestChatMessageMetadataInput = {
  conversationId: string
  messageId: string
  favorite?: boolean
  feedback?: 'up' | 'down' | null
}

const defaultChatHistoryState = () => ({
  selectedConversationId: 'conv-1',
  conversations: [
    {
      id: 'conv-1',
      title: '生产巡检',
      summary: '分析磁盘、负载和服务状态',
      updatedAt: '刚刚',
      ts: 1780488000000,
      ipAddress: '10.24.8.12'
    },
    {
      id: 'conv-2',
      title: 'K8s 发布失败',
      summary: '检查 Pod 事件和镜像拉取',
      updatedAt: '今天',
      ts: 1780488000000 - 1000 * 60 * 45,
      ipAddress: 'prod-cluster'
    },
    {
      id: 'conv-3',
      title: '数据库慢查询',
      summary: '梳理慢日志和索引建议',
      updatedAt: '昨天',
      ts: 1780488000000 - 1000 * 60 * 60 * 24,
      ipAddress: '10.32.6.9'
    }
  ] as TestChatConversationRecord[],
  messagesByConversationId: {
    'conv-1': [
      { id: 'hist-conv-1-system', role: 'system', text: '历史会话已从 aiopsterm 后端恢复。' },
      { id: 'hist-conv-1-user', role: 'user', text: '分析磁盘、负载和服务状态', hosts: [{ id: 'history-host-conv-1', kind: 'hosts', label: '10.24.8.12', detail: '生产巡检' }] },
      { id: 'hist-conv-1-assistant', role: 'assistant', text: '生产巡检历史包含磁盘容量、负载趋势和核心服务状态检查记录。', state: 'done' }
    ],
    'conv-2': [
      { id: 'hist-conv-2-system', role: 'system', text: '历史会话已从 aiopsterm 后端恢复。' },
      { id: 'hist-conv-2-user', role: 'user', text: '检查 Pod 事件和镜像拉取', hosts: [{ id: 'history-host-conv-2', kind: 'hosts', label: 'prod-cluster', detail: 'K8s 发布失败' }] },
      { id: 'hist-conv-2-assistant', role: 'assistant', text: 'K8s 发布失败历史包含 Pod 事件、镜像拉取状态和回滚检查记录。', state: 'done' }
    ],
    'conv-3': [
      { id: 'hist-conv-3-system', role: 'system', text: '历史会话已从 aiopsterm 后端恢复。' },
      { id: 'hist-conv-3-user', role: 'user', text: '梳理慢日志和索引建议', hosts: [{ id: 'history-host-conv-3', kind: 'hosts', label: '10.32.6.9', detail: '数据库慢查询' }] },
      { id: 'hist-conv-3-assistant', role: 'assistant', text: '数据库慢查询历史包含慢日志摘要、疑似缺失索引和 SQL 优化建议。', state: 'done' }
    ]
  } as Record<string, TestChatHistoryMessage[]>
})

let chatHistoryStateMock = defaultChatHistoryState()

const cloneChatConversation = (conversation: TestChatConversationRecord): TestChatConversationRecord => ({ ...conversation })
const cloneChatMessage = (message: TestChatHistoryMessage): TestChatHistoryMessage => ({
  ...message,
  hosts: message.hosts?.map((host) => ({ ...host })),
  commandExecution: message.commandExecution ? { ...message.commandExecution } : undefined,
  mcpToolCall: message.mcpToolCall
    ? {
        ...message.mcpToolCall,
        arguments: message.mcpToolCall.arguments ? { ...message.mcpToolCall.arguments } : undefined
      }
    : undefined,
  mcpResourceAccess: message.mcpResourceAccess ? { ...message.mcpResourceAccess } : undefined
})
const cloneChatMessages = (messages: TestChatHistoryMessage[]) => messages.map(cloneChatMessage)
const chatHistoryListResultMock = () => ({
  ok: true,
  data: {
    conversations: chatHistoryStateMock.conversations.map(cloneChatConversation),
    selectedConversationId: chatHistoryStateMock.selectedConversationId
  }
})
const resetChatHistoryStoreMock = () => {
  chatHistoryStateMock = defaultChatHistoryState()
  aiChatExchangeRequestSequenceMock = 1
  cancelledAiChatResponseKeysMock.clear()
  kubernetesTerminalSequenceMock = 1
}
const setChatHistoryStoreMock = (conversations: TestChatConversationRecord[], messagesByConversationId?: Record<string, TestChatHistoryMessage[]>, selectedConversationId?: string) => {
  chatHistoryStateMock = {
    conversations: conversations.map(cloneChatConversation),
    messagesByConversationId: Object.fromEntries(
      conversations.map((conversation) => [
        conversation.id,
        cloneChatMessages(
          messagesByConversationId?.[conversation.id] || [
            { id: `history-${conversation.id}-system`, role: 'system', text: '历史会话已从 aiopsterm 后端恢复。' },
            { id: `history-${conversation.id}-user`, role: 'user', text: conversation.summary || conversation.title },
            { id: `history-${conversation.id}-assistant`, role: 'assistant', text: `${conversation.title} backend restored transcript.`, state: 'done' }
          ]
        )
      ])
    ),
    selectedConversationId: selectedConversationId || conversations[0]?.id || ''
  }
}

const defaultAiTodoItems: AiTodoItem[] = []

const activeAiTodoItems: AiTodoItem[] = [
  { id: 'todo-1', content: '收集上下文', description: '读取终端输出、资产和知识库引用', status: 'completed' },
  {
    id: 'todo-2',
    content: '生成命令建议',
    description: '只生成需要确认的只读命令',
    status: 'in_progress',
    isFocused: true,
    subtasks: [
      { id: 'todo-2-1', content: '检查风险级别', description: '危险命令需要二次确认' },
      { id: 'todo-2-2', content: '生成回滚步骤' }
    ]
  },
  { id: 'todo-3', content: '等待确认', description: '用户确认后才进入执行阶段', status: 'pending' }
]

const cloneAiTodoItem = (todo: AiTodoItem): AiTodoItem => ({
  ...todo,
  subtasks: todo.subtasks?.map((subtask) => ({ ...subtask }))
})

let aiTodoItemsMock = defaultAiTodoItems.map(cloneAiTodoItem)

const setAiTodoItemsMock = (todos: AiTodoItem[]) => {
  aiTodoItemsMock = todos.map(cloneAiTodoItem)
}

const promptSummaryMock = (value: unknown) => {
  const text = String(value || '').trim()
  if (!text) return '根据当前请求生成运维步骤'
  return text.length > 48 ? `${text.slice(0, 48)}...` : text
}

const normalizeAiChatTextMock = (value: unknown) => String(value || '').trim()

const estimateAiChatTextTokensMock = (value: unknown) => {
  const text = normalizeAiChatTextMock(value).replace(/\s+/g, ' ')
  if (!text) return 0
  const cjkCount = text.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g)?.length || 0
  return Math.max(1, Math.ceil(cjkCount * 0.75 + (text.length - cjkCount) / 4))
}

const createAiChatContextUsageMock = (input: {
  requestId?: string
  assistantMessageId?: string
  prompt?: string
  messages?: TestAiChatMessageInput[]
  contexts?: TestAiChatContextInput[]
  skills?: Array<{ name: string; description?: string; content?: string }>
  command?: TestAiChatCommandInput | null
  outputText?: string
}) => {
  const tokensIn =
    estimateAiChatTextTokensMock(input.prompt) +
    (input.messages || []).reduce((sum, message) => sum + estimateAiChatTextTokensMock(message.text), 0) +
    (input.contexts || []).reduce((sum, context) => sum + estimateAiChatTextTokensMock(`${context.kind} ${context.label} ${context.detail || ''} ${context.relPath || ''}`), 0) +
    (input.skills || []).reduce((sum, skill) => sum + estimateAiChatTextTokensMock(`${skill.name} ${skill.description || ''} ${skill.content || ''}`), 0) +
    estimateAiChatTextTokensMock(`${input.command?.id || ''} ${input.command?.label || ''} ${input.command?.command || ''} ${input.command?.path || ''}`)
  const tokensOut = estimateAiChatTextTokensMock(input.outputText)
  const used = tokensIn + tokensOut
  const contextWindow = 128000
  return {
    used,
    contextWindow,
    percent: Math.min(100, Math.round((used / contextWindow) * 100)),
    tokensIn,
    tokensOut,
    cacheWrites: 0,
    cacheReads: 0,
    source: 'backend' as const,
    requestId: input.requestId,
    assistantMessageId: input.assistantMessageId
  }
}

const normalizeAiChatContextsMock = (contexts?: TestAiChatContextInput[]) =>
  (contexts || [])
    .map((context): TestAiChatContextInput | null => {
      const label = normalizeAiChatTextMock(context.label)
      const kind = normalizeAiChatTextMock(context.kind)
      if (!label || !kind) return null
      return {
        id: normalizeAiChatTextMock(context.id) || `${kind}:${label}`,
        kind,
        label,
        detail: normalizeAiChatTextMock(context.detail) || undefined,
        relPath: normalizeAiChatTextMock(context.relPath) || undefined,
        mediaType: normalizeAiChatTextMock(context.mediaType) || undefined
      }
    })
    .filter(Boolean) as TestAiChatContextInput[]

const normalizeAiChatCommandMock = (command?: TestAiChatCommandInput | null): TestAiChatCommandInput | null => {
  if (!command) return null
  const normalized = {
    id: normalizeAiChatTextMock(command.id) || undefined,
    label: normalizeAiChatTextMock(command.label) || undefined,
    command: normalizeAiChatTextMock(command.command) || undefined,
    path: normalizeAiChatTextMock(command.path) || undefined
  }
  return normalized.id || normalized.label || normalized.command ? normalized : null
}

const selectedAiChatSkillsMock = (contexts: TestAiChatContextInput[]) => {
  const selectedNames = new Set(
    contexts
      .filter((context) => context.kind === 'skills')
      .map((context) => (context.id.startsWith('skill:') ? context.id.slice('skill:'.length) : context.label))
      .filter(Boolean)
  )
  return cloneSkills()
    .filter((skill) => skill.enabled && selectedNames.has(skill.name))
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      content: skill.content
    }))
}

const commandDisplayMock = (command?: TestAiChatCommandInput | null) => normalizeAiChatTextMock(command?.label || command?.command || command?.id)

const buildAiChatExchangePromptMock = (
  text: string,
  contexts: TestAiChatContextInput[],
  skills: Array<{ name: string; description?: string; content?: string }>,
  command: TestAiChatCommandInput | null
) => {
  const contextLabel = contexts.length ? `\n\n上下文：${contexts.map((item) => `${item.kind}:${item.label}`).join('、')}` : ''
  const commandLabel = commandDisplayMock(command) ? `\n命令：${commandDisplayMock(command)}` : ''
  const selectedDocs = contexts.filter((item) => item.kind === 'docs' && item.relPath)
  const selectedImages = contexts.filter((item) => item.kind === 'images' && item.relPath)
  const knowledgeContext =
    selectedDocs.length || selectedImages.length
      ? `\n\nKnowledge Context:\n${[
          ...selectedDocs.map((doc) => `- doc: ${doc.label} (${doc.relPath})`),
          ...selectedImages.map((image) => `- image: ${image.label} (${image.relPath}, ${image.mediaType || 'image'})`)
        ].join('\n')}`
      : ''
  const skillContext = skills.length
    ? `\n\nSkill Instructions:\n${skills
        .map((skill) => `# Skill Activated: ${skill.name}\nDescription: ${skill.description || ''}\n\n${skill.content || ''}`.trimEnd())
        .join('\n\n')}`
    : ''
  return `${text}${contextLabel}${commandLabel}${knowledgeContext}${skillContext}`.trim()
}

const buildAiChatResponseMessagesMock = (messages: TestAiChatMessageInput[] | undefined, prompt: string): TestAiChatMessageInput[] => {
  const history = (messages || [])
    .slice(-12)
    .map((message): TestAiChatMessageInput | null => {
      const text = normalizeAiChatTextMock(message.text)
      if (!text) return null
      return { role: message.role, text }
    })
    .filter(Boolean) as TestAiChatMessageInput[]
  const last = history[history.length - 1]
  return last?.role === 'user' && last.text === prompt ? history : [...history, { role: 'user', text: prompt }]
}

const recordAiTodoRequestMock = (input: { text: string; hosts?: TestChatHistoryHostContext[] }, requestId: string, assistantMessageId: string) => {
  setAiTodoItemsMock([
    {
      id: 'todo-1',
      content: '收集上下文',
      description: input.hosts?.length ? `已绑定 ${input.hosts.length} 个主机上下文` : '已接收本次对话输入',
      status: 'completed'
    },
    {
      id: 'todo-2',
      content: '生成命令建议',
      description: `正在为「${promptSummaryMock(input.text)}」生成只读诊断步骤`,
      status: 'in_progress',
      isFocused: true,
      subtasks: [
        { id: 'todo-2-1', content: '检查风险级别', description: '危险命令需要二次确认' },
        { id: 'todo-2-2', content: `关联响应 ${assistantMessageId || requestId}` }
      ]
    },
    { id: 'todo-3', content: '等待确认', description: '用户确认后才进入执行阶段', status: 'pending' }
  ])
}

type TestAiTodoResponseInput = {
  requestId?: string
  assistantMessageId?: string
  prompt?: string
  messages?: TestAiChatMessageInput[]
  contexts?: TestAiChatContextInput[]
  skills?: Array<{ name: string; description?: string; content?: string }>
  command?: TestAiChatCommandInput | null
}

const recordAiTodoResponseMock = (input: TestAiTodoResponseInput, status: 'done' | 'cancelled' | 'error') => {
  const cancelled = status === 'cancelled'
  const failed = status === 'error'
  setAiTodoItemsMock([
    {
      id: 'todo-1',
      content: '收集上下文',
      description: input.contexts?.length ? `已整理 ${input.contexts.length} 个上下文` : '已整理会话输入',
      status: 'completed'
    },
    {
      id: 'todo-2',
      content: '生成命令建议',
      description: cancelled ? '生成已停止，可调整上下文后重试' : failed ? 'AI 响应生成失败' : '只读诊断步骤已生成',
      status: failed || cancelled ? 'in_progress' : 'completed',
      isFocused: failed || cancelled ? true : undefined,
      subtasks: [
        { id: 'todo-2-1', content: '检查风险级别', description: '危险命令需要二次确认' },
        { id: 'todo-2-2', content: input.command?.label || input.command?.command ? `参考命令 ${input.command.label || input.command.command}` : '生成回滚步骤' }
      ]
    },
    {
      id: 'todo-3',
      content: '等待确认',
      description: cancelled ? '当前响应已取消' : failed ? '修复模型或网络问题后重试' : '等待用户确认是否执行后续命令',
      status: failed || cancelled ? 'pending' : 'in_progress',
      isFocused: failed || cancelled ? undefined : true
    }
  ])
}

const aiTodoSnapshotResultMock = (): AiTodoSnapshotResult => {
  const todos = aiTodoItemsMock.map(cloneAiTodoItem)
  const focusedTodo = todos.find((todo) => todo.isFocused) || todos.find((todo) => todo.status === 'in_progress') || null
  return {
    ok: true,
    data: {
      todos,
      focusedTodoId: focusedTodo?.id || null,
      totalTodos: todos.length,
      completedTodos: todos.filter((todo) => todo.status === 'completed').length,
      source: 'backend',
      updatedAt: '刚刚'
    }
  }
}

const resetAiTodoSnapshotMock = () => {
  setAiTodoItemsMock(defaultAiTodoItems)
  vi.mocked(window.aiops.listAiTodoSnapshot).mockImplementation(async () => aiTodoSnapshotResultMock())
}

const setAiTodoSnapshotMock = (todos: AiTodoItem[]) => {
  setAiTodoItemsMock(todos)
  vi.mocked(window.aiops.listAiTodoSnapshot).mockImplementation(async () => aiTodoSnapshotResultMock())
}

const defaultAssetFolders: TestAssetFolder[] = [
  { uuid: 'direct-folder-prod', name: '生产', description: '生产直连主机', scope: 'direct' },
  { uuid: 'direct-folder-staging', name: '预发', description: '预发直连主机', scope: 'direct' },
  { uuid: 'direct-folder-db', name: '数据库', description: '数据库直连主机', parentUuid: 'direct-folder-prod', scope: 'direct' },
  { uuid: 'direct-folder-maintenance', name: '维护', description: '维护直连主机', scope: 'direct' },
  { uuid: 'custom-folder-a', name: '核心业务', description: '常用堡垒机业务资产', scope: 'bastion' },
  { uuid: 'custom-folder-b', name: '临时排障', description: '短期排障入口', scope: 'bastion' }
]

const defaultKeychains: TestKeychainRecord[] = [
  {
    id: 'key-1',
    name: 'prod-ed25519',
    type: 'ed25519',
    publicKey: 'ssh-ed25519 AAAA... prod',
    privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nssh-ed25519\n-----END OPENSSH PRIVATE KEY-----',
    passphrase: '',
    hasPrivateKey: true,
    createdAt: 1717200000000,
    updatedAt: 1717200000000
  },
  {
    id: 'key-2',
    name: 'staging-rsa',
    type: 'rsa',
    publicKey: 'ssh-rsa AAAA... staging',
    privateKey: '-----BEGIN RSA PRIVATE KEY-----\n-----END RSA PRIVATE KEY-----',
    passphrase: '',
    hasPrivateKey: true,
    createdAt: 1717200000000,
    updatedAt: 1717200000000
  }
]

const LOCAL_SHELL_ASSET_ID = 'local-127-1'

const localShellAsset: TestAssetRecord = {
  id: LOCAL_SHELL_ASSET_ID,
  uuid: LOCAL_SHELL_ASSET_ID,
  name: '127.0.0.1',
  title: '127.0.0.1',
  host: '127.0.0.1',
  ip: '127.0.0.1',
  group: '本地连接',
  group_name: '本地连接',
  status: 'online',
  tags: ['local'],
  username: 'local',
  port: 22,
  asset_type: 'person',
  auth_type: 'password',
  comment: '',
  data_source: 'manual',
  isLocalShell: true
}

const defaultAssets: TestAssetRecord[] = [
  localShellAsset,
  {
    id: 'asset-1',
    uuid: 'asset-1',
    name: 'prod-bastion',
    title: 'prod-bastion',
    host: '10.24.8.12',
    ip: '10.24.8.12',
    group: '生产',
    group_name: '生产',
    status: 'online',
    tags: ['linux', 'prod'],
    username: 'ops',
    port: 22,
    asset_type: 'person',
    auth_type: 'keyBased',
    keychainId: 'key-1',
    comment: '生产入口',
    data_source: 'manual',
    favorite: true,
    folderUuid: 'custom-folder-a',
    organizationId: 'org-1',
    hasPrivateKey: true
  },
  {
    id: 'asset-2',
    uuid: 'asset-2',
    name: 'staging-api',
    title: 'staging-api',
    host: '10.24.12.44',
    ip: '10.24.12.44',
    group: '预发',
    group_name: '预发',
    status: 'online',
    tags: ['linux', 'staging'],
    username: 'deploy',
    port: 22,
    asset_type: 'person',
    auth_type: 'keyBased',
    keychainId: 'key-2',
    comment: '预发 API',
    data_source: 'manual',
    tunnelState: 'active',
    hasPrivateKey: true
  },
  {
    id: 'asset-3',
    uuid: 'asset-3',
    name: 'mysql-primary',
    title: 'mysql-primary',
    host: '10.32.6.9',
    ip: '10.32.6.9',
    group: '数据库',
    group_name: '数据库',
    status: 'online',
    tags: ['mysql'],
    username: 'dba',
    port: 22,
    asset_type: 'person',
    auth_type: 'keyBased',
    keychainId: 'key-1',
    comment: '主库',
    data_source: 'manual',
    folderUuid: 'custom-folder-a',
    organizationId: 'org-1',
    hasPrivateKey: true
  },
  {
    id: 'asset-4',
    uuid: 'asset-4',
    name: 'legacy-node',
    title: 'legacy-node',
    host: '10.11.7.21',
    ip: '10.11.7.21',
    group: '维护',
    group_name: '维护',
    status: 'offline',
    tags: ['audit'],
    username: 'ops',
    port: 2222,
    asset_type: 'person',
    auth_type: 'password',
    comment: '待迁移',
    data_source: 'manual',
    hasPassword: true
  },
  {
    id: 'asset-5',
    uuid: 'org-1',
    name: 'jumpserver-org',
    title: 'jumpserver-org',
    host: 'bastion.internal',
    ip: 'bastion.internal',
    group: '企业',
    group_name: '企业',
    status: 'online',
    tags: ['jumpserver'],
    username: 'sync',
    port: 22,
    asset_type: 'organization',
    auth_type: 'keyBased',
    keychainId: 'key-1',
    comment: '同步资产',
    data_source: 'refresh',
    favorite: true,
    hasPrivateKey: true
  },
  {
    id: 'asset-6',
    uuid: 'org-prod',
    name: 'prod-jumpserver-org',
    title: 'prod-jumpserver-org',
    host: '10.24.8.12',
    ip: '10.24.8.12',
    group: '企业',
    group_name: '企业',
    status: 'online',
    tags: ['jumpserver'],
    username: 'sync',
    port: 22,
    asset_type: 'organization',
    auth_type: 'keyBased',
    keychainId: 'key-1',
    comment: '生产同步资产',
    data_source: 'refresh',
    hasPrivateKey: true
  }
]

const defaultAssetSecrets: Record<string, TestAssetSecret> = {
  'asset-4': {
    password: 'legacy-password'
  }
}

const cloneAsset = (asset: TestAssetRecord): TestAssetRecord => ({ ...asset, tags: [...asset.tags] })
const cloneAssetSecret = (secret: TestAssetSecret): TestAssetSecret => ({ ...secret })
const cloneAssetFolder = (folder: TestAssetFolder): TestAssetFolder => ({ ...folder })
const cloneKeychain = (keychain: TestKeychainRecord): TestKeychainRecord => ({ ...keychain })
const cloneQuickCommands = () => ({
  groups: defaultQuickCommands.groups.map((group) => ({ ...group })),
  snippets: defaultQuickCommands.snippets.map((snippet) => ({ ...snippet }))
})
const cloneQuickCommandSnapshot = (config: typeof defaultQuickCommands) => ({
  groups: config.groups.map((group) => ({ ...group })),
  snippets: config.snippets.map((snippet) => ({ ...snippet }))
})
const nextQuickCommandGroupIdMock = () => Math.max(0, ...quickCommandStoreMock.groups.map((group) => group.id)) + 1
const nextQuickCommandSnippetIdMock = () => Math.max(0, ...quickCommandStoreMock.snippets.map((snippet) => snippet.id)) + 1
const quickCommandMacroDefaultSleepThresholdMsMock = 500
const quickCommandMacroMaxCommandCountMock = 50
const quickCommandKeyMapMock = {
  esc: '\x1b',
  tab: '\t',
  return: '\r',
  backspace: '\b',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D'
}
const quickCommandCtrlKeyMapMock = {
  'ctrl+a': '\x01',
  'ctrl+b': '\x02',
  'ctrl+c': '\x03',
  'ctrl+d': '\x04',
  'ctrl+e': '\x05',
  'ctrl+f': '\x06',
  'ctrl+g': '\x07',
  'ctrl+h': '\x08',
  'ctrl+k': '\x0b',
  'ctrl+l': '\x0c',
  'ctrl+n': '\x0e',
  'ctrl+p': '\x10',
  'ctrl+r': '\x12',
  'ctrl+t': '\x14',
  'ctrl+u': '\x15',
  'ctrl+w': '\x17',
  'ctrl+z': '\x1a'
}
type QuickCommandParsedScriptMock =
  | { type: 'COMMAND'; payload: string }
  | { type: 'SLEEP'; payload: number }
  | { type: 'KEY'; payload: keyof typeof quickCommandKeyMapMock }
  | { type: 'CTRL'; payload: keyof typeof quickCommandCtrlKeyMapMock }
const isQuickCommandKeyMock = (value: string): value is keyof typeof quickCommandKeyMapMock => hasOwn(quickCommandKeyMapMock, value)
const isQuickCommandCtrlKeyMock = (value: string): value is keyof typeof quickCommandCtrlKeyMapMock => hasOwn(quickCommandCtrlKeyMapMock, value)
const parseQuickCommandScriptMock = (text: string): QuickCommandParsedScriptMock[] => {
  const commands: QuickCommandParsedScriptMock[] = []
  text.split(/\r\n|\n|\r/).forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return
    const sleepMatch = trimmed.match(/^sleep==(\d+)$/i)
    if (sleepMatch) {
      commands.push({ type: 'SLEEP', payload: Number(sleepMatch[1]) })
      return
    }
    const lower = trimmed.toLowerCase()
    if (lower.startsWith('ctrl+') && isQuickCommandCtrlKeyMock(lower)) {
      commands.push({ type: 'CTRL', payload: lower })
      return
    }
    if (isQuickCommandKeyMock(lower)) {
      commands.push({ type: 'KEY', payload: lower })
      return
    }
    commands.push({ type: 'COMMAND', payload: trimmed })
  })
  return commands
}
const planQuickCommandScriptMock = (
  scriptContent: string,
  autoExecute = true,
  fallbackSecurityCommand = 'Quick Command',
  metadata: { source: 'snippet' | 'inline'; snippetId: number | null; snippetName: string } = { source: 'inline', snippetId: null, snippetName: '' }
) => {
  const parsed = parseQuickCommandScriptMock(scriptContent)
  const commandItems = parsed.filter((item): item is Extract<QuickCommandParsedScriptMock, { type: 'COMMAND' }> => item.type === 'COMMAND')
  const context = {
    autoExecute,
    lastCommandPayload: commandItems.at(-1)?.payload,
    commandCount: commandItems.length,
    seenCommandCount: 0
  }
  const segments: Array<{ text: string; delayBeforeMs: number }> = []
  let buffer = ''
  let delayBeforeMs = 0
  const flush = () => {
    if (!buffer) return
    segments.push({ text: buffer, delayBeforeMs })
    buffer = ''
    delayBeforeMs = 0
  }
  parsed.forEach((item) => {
    if (item.type === 'SLEEP') {
      flush()
      delayBeforeMs += item.payload
      return
    }
    if (item.type === 'COMMAND') {
      context.seenCommandCount += 1
      const isLastCommand = item.payload === context.lastCommandPayload && context.seenCommandCount === context.commandCount
      buffer += `${item.payload}${isLastCommand && !context.autoExecute ? '' : '\n'}`
      return
    }
    buffer += item.type === 'KEY' ? quickCommandKeyMapMock[item.payload] : quickCommandCtrlKeyMapMock[item.payload]
  })
  flush()
  return {
    segments,
    shellText: segments.map((segment) => segment.text).join(''),
    securityCommand: commandItems[0]?.payload || fallbackSecurityCommand,
    commands: commandItems.map((item) => item.payload),
    source: metadata.source,
    snippetId: metadata.snippetId,
    snippetName: metadata.snippetName,
    autoExecute
  }
}

const buildQuickCommandMacroContentMock = (input: {
  entries: Array<{ command: string; timestamp: number }>
  sleepThresholdMs?: number
}) => {
  if (!Array.isArray(input.entries) || input.entries.length === 0) throw new Error('Macro recording entries are required')
  if (input.entries.length > quickCommandMacroMaxCommandCountMock) throw new Error('Macro recording command limit exceeded')
  const sleepThresholdMs = Number.isFinite(Number(input.sleepThresholdMs))
    ? Math.max(0, Math.round(Number(input.sleepThresholdMs)))
    : quickCommandMacroDefaultSleepThresholdMsMock
  const entries = input.entries.map((entry) => {
    const command = typeof entry.command === 'string' ? entry.command : ''
    const timestamp = Number(entry.timestamp)
    if (!command.trim() || command.includes('\n') || command.includes('\r') || !Number.isFinite(timestamp) || timestamp < 0) {
      throw new Error('Macro recording entries are invalid')
    }
    return { command, timestamp }
  })
  const lines: string[] = []
  entries.forEach((entry, index) => {
    const previous = entries[index - 1]
    if (previous) {
      const delay = entry.timestamp - previous.timestamp
      if (delay < 0) throw new Error('Macro recording timestamps must be ordered')
      if (delay >= sleepThresholdMs) lines.push(`sleep==${delay}`)
    }
    lines.push(entry.command)
  })
  return lines.join('\n')
}

const sanitizeKeychain = (keychain: TestKeychainRecord): TestKeychainRecord => ({
  ...keychain,
  privateKey: undefined,
  passphrase: undefined,
  hasPrivateKey: Boolean(keychain.privateKey || keychain.hasPrivateKey)
})
const listAssetGroupsMock = (input?: { assetTypes?: TestAssetRecord['asset_type'][] }) => {
  const groups = new Map<string, number>()
  assetStoreMock
    .filter((asset) => !asset.isLocalShell && (!input?.assetTypes?.length || input.assetTypes.includes(asset.asset_type)))
    .forEach((asset) => {
      const group = String(asset.group || asset.group_name || '未分组').trim()
      const name = !group || group === 'Hosts' ? '未分组' : group
      groups.set(name, (groups.get(name) || 0) + 1)
    })
  return [...groups.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([name, count]) => ({ key: `group-${name}`, name, count }))
}
const keychainFingerprintMock = (keychain: TestKeychainRecord) => {
  const source = keychain.publicKey || keychain.name || keychain.id
  return `SHA256:${createHash('sha256').update(source).digest('base64').replace(/=+$/, '')}`
}
const keychainToSshAgentOptionMock = (keychain: TestKeychainRecord): SshAgentKeychainOption => ({
  key: keychain.id,
  label: keychain.name,
  fingerprint: keychainFingerprintMock(keychain),
  keyType: keychain.type.toUpperCase()
})
const hasOwn = (source: object, key: string) => Object.prototype.hasOwnProperty.call(source, key)

let assetStoreMock = defaultAssets.map(cloneAsset)
let assetSecretStoreMock: Record<string, TestAssetSecret> = Object.fromEntries(Object.entries(defaultAssetSecrets).map(([id, secret]) => [id, cloneAssetSecret(secret)]))
let assetFolderStoreMock = defaultAssetFolders.map(cloneAssetFolder)
let assetFolderSequenceMock = 1
let keychainStoreMock = defaultKeychains.map(cloneKeychain)
let sshTunnelStoreMock = new Map<string, TestSshTunnelRecord>()
let quickCommandStoreMock = cloneQuickCommands()
let quickCommandGroupSequenceMock = 1
let quickCommandSnippetSequenceMock = 1
let settingsRuleSequenceMock = 1
let aliasStoreMock = cloneAliasCommands()
let settingsPreferencesStoreMock: TestSettingsPreferences | null = null
let fileSessionFolderSequenceMock = 1

const sortAssetsForAiContextMock = (assets: TestAssetRecord[]) =>
  [...assets].sort((first, second) => {
    if (first.asset_type !== second.asset_type) {
      if (first.asset_type === 'person') return -1
      if (second.asset_type === 'person') return 1
    }
    if (Boolean(first.favorite) !== Boolean(second.favorite)) return first.favorite ? -1 : 1
    if (first.status !== second.status) {
      if (first.status === 'online') return -1
      if (second.status === 'online') return 1
    }
    return (first.name || first.title || first.host).localeCompare(second.name || second.title || second.host, 'zh-CN', {
      numeric: true,
      sensitivity: 'base'
    })
  })

const getKnowledgeParentRelPathMock = (relPath: string) => {
  const parts = relPath.split('/').filter(Boolean)
  return parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
}

const flattenKnowledgeNodesForAiContextMock = (nodes: TestKnowledgeNode[] = knowledgeTreeMock, parentRelPath = '') => {
  const options: Array<{
    id: string
    kind: 'docs'
    label: string
    detail: string
    relPath: string
    parentRelPath: string
    contextType: 'dir' | 'doc'
  }> = []
  for (const node of nodes) {
    if (!node.relPath || !node.title) continue
    const isDir = node.type === 'dir'
    options.push({
      id: `${isDir ? 'kb-dir' : 'kb-doc'}:${node.relPath}`,
      kind: 'docs',
      label: node.title,
      detail: isDir ? 'dir' : node.relPath,
      relPath: node.relPath,
      parentRelPath: parentRelPath || getKnowledgeParentRelPathMock(node.relPath),
      contextType: isDir ? 'dir' : 'doc'
    })
    if (isDir && node.children?.length) {
      options.push(...flattenKnowledgeNodesForAiContextMock(node.children as TestKnowledgeNode[], node.relPath))
    }
  }
  return options.sort((first, second) => {
    if (first.contextType !== second.contextType) return first.contextType === 'dir' ? -1 : 1
    return first.label.localeCompare(second.label, 'zh-CN', { numeric: true, sensitivity: 'base' })
  })
}

const skillsForAiContextMock = () =>
  cloneSkills()
    .filter((skill) => skill.enabled && skill.name.trim())
    .map((skill) => ({
      id: `skill:${skill.name}`,
      kind: 'skills' as const,
      label: skill.name,
      detail: skill.description
    }))
    .sort((first, second) => first.label.localeCompare(second.label, 'zh-CN', { numeric: true, sensitivity: 'base' }))

const aiContextCatalogResultMock = () => {
  const hosts = [
    { id: 'opened-local', kind: 'hosts' as const, label: '127.0.0.1', detail: 'local shell', host: '127.0.0.1', username: '', assetName: 'Local terminal', isLocalShell: true },
    ...sortAssetsForAiContextMock(assetStoreMock)
      .filter((asset) => !asset.isLocalShell && (asset.host || asset.ip || asset.name))
      .map((asset) => ({
        id: asset.id,
        kind: 'hosts' as const,
        label: asset.host || asset.ip || asset.name,
        detail: asset.name || asset.title || asset.group_name,
        host: asset.host || asset.ip || asset.name,
        port: Number(asset.port) || 22,
        username: asset.username || 'root',
        assetName: asset.name || asset.title || asset.host || asset.ip
      }))
  ]
  const chats = chatHistoryStateMock.conversations.map((conversation) => ({
    id: `chat:${conversation.id}`,
    kind: 'chats' as const,
    label: conversation.title,
    detail: conversation.summary || conversation.ipAddress || conversation.updatedAt
  }))
  const defaultRemote = hosts.find((host) => host.id !== 'opened-local')
  return {
    ok: true,
    data: {
      categories: [
        { id: 'hosts' as const, label: '主机', options: hosts.map((host) => ({ ...host })) },
        { id: 'docs' as const, label: '文档', options: flattenKnowledgeNodesForAiContextMock() },
        { id: 'skills' as const, label: '技能', options: skillsForAiContextMock() },
        { id: 'chats' as const, label: '历史会话', options: chats.map((chat) => ({ ...chat })) }
      ],
      openedHosts: hosts.slice(0, 4).map((host) => ({ ...host })),
      selectedDefaults: [hosts[0], defaultRemote].filter(Boolean).map((context) => ({ ...(context as (typeof hosts)[number]) }))
    }
  }
}

const removeFileExtensionForAiCommandMock = (filename: string) => {
  const lastDot = filename.lastIndexOf('.')
  return lastDot === -1 ? filename : filename.slice(0, lastDot)
}

const aiCommandCatalogResultMock = () => ({
  ok: true,
  data: {
    commands: listKnowledgeDirMock('commands')
      .filter((entry) => entry.type === 'file' && entry.relPath?.trim())
      .map((entry) => {
        const filename = entry.name?.trim() || getKnowledgeName(entry.relPath)
        const name = removeFileExtensionForAiCommandMock(filename)
        return {
          id: entry.relPath,
          label: `/${name}`,
          name,
          path: entry.relPath,
          command: `/${name}`
        }
      })
      .sort((first, second) => first.name.localeCompare(second.name, 'zh-CN', { numeric: true, sensitivity: 'base' }))
  }
})
type TestFileSessionKind = 'local' | 'remote'
type TestFileSessionInfo = {
  id: string
  label: string
  host: string
  username?: string
  group: string
  kind: TestFileSessionKind
  rootPath: string
  status: 'active' | 'idle' | 'error'
  favorite?: boolean
  assetType?: 'local' | 'person' | 'organization' | 'custom_folder'
  folderUuid?: string
  organizationId?: string
  jumpHostId?: string
  comment?: string
  errorMsg?: string
}
type TestFileSessionFolderRecord = {
  uuid: string
  name: string
  description: string
  parentUuid?: string
  scope?: 'direct' | 'bastion'
}
type TestFileSessionFolderSaveInput = {
  uuid?: string
  name: string
  description?: string
  parentUuid?: string
  scope?: 'direct' | 'bastion'
}
type TestFileSessionCatalog = {
  sessions: TestFileSessionInfo[]
  folders: TestFileSessionFolderRecord[]
}
type TestFileSessionTerminalContext = {
  kind: 'local' | 'ssh'
  panelId?: string
  panelTitle?: string
  panelStatus?: 'ready' | 'running' | 'closed'
  sessionId?: string
  cwd?: string
  ssh?: {
    connectionId?: string
    host?: string
    port?: number
    username?: string
    assetId?: string
    assetName?: string
    assetType?: string
    organizationId?: string
    jumpHostId?: string
    authType?: string
    createdAt?: number
    forkFromConnectionId?: string
  }
}
type TestFileEntry = {
  name: string
  path: string
  type: 'directory' | 'file' | 'link'
  size: number
  modifiedAt: number
  mode: string
}
const defaultFileSessionFolders: TestFileSessionFolderRecord[] = [
  { uuid: 'custom-folder-a', name: '核心业务', description: '常用远程文件资产', scope: 'bastion' },
  { uuid: 'custom-folder-b', name: '临时排障', description: '短期调试入口', scope: 'bastion' }
]
const defaultFileSessions: TestFileSessionInfo[] = [
  {
    id: 'local',
    label: 'Local',
    host: '127.0.0.1',
    group: '本地连接',
    kind: 'local',
    rootPath: '/',
    status: 'active',
    assetType: 'local'
  },
  {
    id: 'asset-1',
    label: 'prod-bastion',
    host: '10.24.8.12',
    group: '最近连接',
    kind: 'remote',
    rootPath: '/home/deploy',
    status: 'active',
    favorite: false,
    assetType: 'person',
    comment: '生产入口'
  },
  {
    id: 'asset-2',
    label: 'staging-api',
    host: '10.24.12.44',
    group: '主机',
    kind: 'remote',
    rootPath: '/home/deploy',
    status: 'idle',
    favorite: false,
    assetType: 'person',
    folderUuid: 'custom-folder-a',
    comment: '预发文件'
  }
]
let fileEntriesMock: TestFileEntry[] = []
let fileTransferTasksMock: any[] = []
let fileTransferTaskSequenceMock = 1
let fileSessionCatalogMock: TestFileSessionCatalog = {
  sessions: defaultFileSessions.map((session) => ({ ...session })),
  folders: defaultFileSessionFolders.map((folder) => ({ ...folder }))
}

const resetAssetStoreMock = () => {
  assetStoreMock = defaultAssets.map(cloneAsset)
  assetSecretStoreMock = Object.fromEntries(Object.entries(defaultAssetSecrets).map(([id, secret]) => [id, cloneAssetSecret(secret)]))
  assetFolderStoreMock = defaultAssetFolders.map(cloneAssetFolder)
  assetFolderSequenceMock = 1
  keychainStoreMock = defaultKeychains.map(cloneKeychain)
  sshTunnelStoreMock = new Map()
  quickCommandStoreMock = cloneQuickCommands()
  quickCommandGroupSequenceMock = 1
  quickCommandSnippetSequenceMock = 1
  settingsRuleSequenceMock = 1
  aliasStoreMock = cloneAliasCommands()
  settingsPreferencesStoreMock = null
  fileSessionFolderSequenceMock = 1
  fileEntriesMock = []
  fileTransferTasksMock = []
  fileTransferTaskSequenceMock = 1
}

const cloneFileSessionCatalogMock = (): TestFileSessionCatalog => ({
  sessions: fileSessionCatalogMock.sessions.map((session) => ({ ...session })),
  folders: fileSessionCatalogMock.folders.map((folder) => ({ ...folder }))
})

const isDefaultFileSessionMock = (session: TestFileSessionInfo) => {
  const seed = defaultFileSessions.find((item) => item.id === session.id)
  return Boolean(seed && JSON.stringify(seed) === JSON.stringify(session))
}

const defaultFileSessionByIdMock = (id: string) => defaultFileSessions.find((item) => item.id === id)

const isUserChangedFileSessionFieldMock = <K extends keyof TestFileSessionInfo>(session: TestFileSessionInfo | undefined, field: K) => {
  if (!session) return false
  const seed = defaultFileSessionByIdMock(session.id)
  return !seed || JSON.stringify(session[field]) !== JSON.stringify(seed[field])
}

const rootPathForAssetUsernameMock = (username?: string) => {
  const name = String(username || '').trim()
  return name && name !== 'local' ? `/home/${name}` : '/'
}

const assetFileSessionCatalogMock = (): TestFileSessionCatalog => {
  const existingById = new Map(fileSessionCatalogMock.sessions.map((session) => [session.id, session]))
  const local = existingById.get('local') || defaultFileSessions[0]
  const assetSessions = assetStoreMock
    .filter((asset) => !asset.isLocalShell && asset.id && (asset.host || asset.ip))
    .map((asset) => {
      const existing = existingById.get(asset.id)
      const isOrganization = asset.asset_type === 'organization'
      return normalizeFileSessionMock({
        id: asset.id,
        label: asset.title || asset.name || asset.host || asset.ip,
        host: asset.host || asset.ip,
        username: asset.username,
        group: isUserChangedFileSessionFieldMock(existing, 'group') && existing?.group ? existing.group : asset.group_name || asset.group || (isOrganization ? '堡垒机资源' : '主机'),
        kind: 'remote',
        rootPath: isUserChangedFileSessionFieldMock(existing, 'rootPath') && existing?.rootPath ? existing.rootPath : rootPathForAssetUsernameMock(asset.username),
        status: isUserChangedFileSessionFieldMock(existing, 'status') && existing?.status ? existing.status : asset.status === 'offline' ? 'idle' : 'active',
        favorite: isUserChangedFileSessionFieldMock(existing, 'favorite') && typeof existing?.favorite === 'boolean' ? existing.favorite : Boolean(asset.favorite),
        assetType: isOrganization ? 'organization' : 'person',
        folderUuid: asset.folderUuid,
        organizationId: isOrganization ? asset.uuid || asset.id : asset.organizationId,
        jumpHostId: asset.jumpHostId,
        comment: isUserChangedFileSessionFieldMock(existing, 'comment') && existing?.comment ? existing.comment : asset.comment || undefined
      } as TestFileSessionInfo)
    })
    .filter((session): session is TestFileSessionInfo => Boolean(session))
  const assetIds = new Set(assetStoreMock.map((asset) => asset.id))
  const customSessions = fileSessionCatalogMock.sessions.filter((session) => session.id !== 'local' && !assetIds.has(session.id) && !isDefaultFileSessionMock(session))
  return {
    sessions: [{ ...local }, ...assetSessions, ...customSessions].map((session) => ({ ...session })),
    folders: assetFolderStoreMock.map((folder) => ({
      uuid: folder.uuid,
      name: folder.name,
      description: folder.description,
      ...(folder.parentUuid ? { parentUuid: folder.parentUuid } : {}),
      ...(folder.scope ? { scope: folder.scope } : {})
    }))
  }
}

const assetFolderToFileFolderMock = (folder: TestAssetFolder): TestFileSessionFolderRecord => ({
  uuid: folder.uuid,
  name: folder.name,
  description: folder.description,
  ...(folder.parentUuid ? { parentUuid: folder.parentUuid } : {}),
  ...(folder.scope ? { scope: folder.scope } : {})
})

const resetFileSessionCatalogMock = () => {
  fileSessionCatalogMock = {
    sessions: defaultFileSessions.map((session) => ({ ...session })),
    folders: defaultFileSessionFolders.map((folder) => ({ ...folder }))
  }
  fileSessionFolderSequenceMock = 1
}

const fileSessionResultMock = <T>(data: T) => ({ ok: true as const, data })

const normalizeFileSessionMock = (session: TestFileSessionInfo): TestFileSessionInfo | null => {
  const id = String(session.id || '').trim()
  const label = String(session.label || '').trim()
  const host = String(session.host || '').trim()
  const rootPath = String(session.rootPath || '').trim()
  if (!id || !label || !host || !rootPath) return null
  return {
    id,
    label,
    host,
    ...(session.username ? { username: String(session.username) } : {}),
    group: String(session.group || (session.kind === 'local' ? '本地连接' : '资产')).trim(),
    kind: session.kind === 'local' ? 'local' : 'remote',
    rootPath,
    status: session.status === 'idle' || session.status === 'error' ? session.status : 'active',
    ...(typeof session.favorite === 'boolean' ? { favorite: session.favorite } : {}),
    ...(session.assetType === 'local' || session.assetType === 'person' || session.assetType === 'organization' || session.assetType === 'custom_folder'
      ? { assetType: session.assetType }
      : {}),
    ...(session.folderUuid ? { folderUuid: String(session.folderUuid) } : {}),
    ...(session.organizationId ? { organizationId: String(session.organizationId) } : {}),
    ...(session.jumpHostId ? { jumpHostId: String(session.jumpHostId) } : {}),
    ...(session.comment ? { comment: String(session.comment) } : {}),
    ...(session.errorMsg ? { errorMsg: String(session.errorMsg) } : {})
  }
}

const stringFromSftpPayloadMock = (payload: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = payload[key]
    if (value === undefined || value === null) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

const terminalContextStringMock = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const terminalContextStatusMock = (status: TestFileSessionTerminalContext['panelStatus']) => (status === 'closed' ? 'idle' : 'active')
const terminalContextAssetTypeMock = (assetType?: string): TestFileSessionInfo['assetType'] =>
  terminalContextStringMock(assetType).toLowerCase().includes('organization') ? 'organization' : 'person'

const normalizeFileDirMock = (path: string) => String(path || '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/'
const dirnameFileMock = (path: string) => {
  const normalized = normalizeFileDirMock(path)
  const index = normalized.lastIndexOf('/')
  return index <= 0 ? '/' : normalized.slice(0, index)
}
const basenameFileMock = (path: string) => normalizeFileDirMock(path).split('/').filter(Boolean).at(-1) || path
const fileTransferTaskHostsMock = (options?: any) => ({
  ...(options?.fromHost || options?.host ? { fromHost: options.fromHost || options.host } : {}),
  ...(options?.toHost || options?.host ? { toHost: options.toHost || options.host } : {})
})
const createFileTransferTaskMock = (input: any) => {
  const status = input.status === 'running' || input.status === 'success' || input.status === 'failed' || input.status === 'error' ? input.status : 'success'
  const createTaskId = () => `transfer-test-${fileTransferTaskSequenceMock++}`
  return {
    id: createTaskId(),
    type: input.type === 'download' || input.type === 'upload' || input.type === 'r2r' ? input.type : 'r2r',
    name: String(input.name || '').trim(),
    source: String(input.source || '').trim(),
    target: String(input.target || '').trim(),
    progress: typeof input.progress === 'number' ? Math.max(0, Math.min(100, Math.round(input.progress))) : status === 'success' ? 100 : 0,
    speed: String(input.speed || (status === 'success' ? '完成' : 'pending')),
    status,
    ...(input.stage === 'scanning' || input.stage === 'pending' ? { stage: input.stage } : {}),
    ...(input.isGroup ? { isGroup: true } : {}),
    ...(input.fromHost ? { fromHost: input.fromHost } : {}),
    ...(input.toHost ? { toHost: input.toHost } : {}),
    ...(typeof input.totalFiles === 'number' ? { totalFiles: input.totalFiles } : {}),
    ...(typeof input.finishedFiles === 'number' ? { finishedFiles: input.finishedFiles } : {}),
    ...(Array.isArray(input.children)
      ? {
          children: input.children.map((child: any) => ({
            ...child,
            id: createTaskId(),
            progress: typeof child.progress === 'number' ? Math.max(0, Math.min(100, Math.round(child.progress))) : 0
          }))
        }
      : {})
  }
}
const ensureFileDirMock = (directory: string) => {
  const dir = normalizeFileDirMock(directory)
  if (fileEntriesMock.some((entry) => dirnameFileMock(entry.path) === dir)) return
  const base = dir === '/' ? '' : dir
  fileEntriesMock.push(
    { name: 'boot', path: `${base}/boot`.replace(/\/+/g, '/'), type: 'directory', size: 0, modifiedAt: Date.now(), mode: 'drwxr-xr-x' },
    { name: '.hidden', path: `${base}/.hidden`.replace(/\/+/g, '/'), type: 'file', size: 128, modifiedAt: Date.now(), mode: '-rw-r--r--' },
    { name: 'release-note.md', path: `${base}/release-note.md`.replace(/\/+/g, '/'), type: 'file', size: 2048, modifiedAt: Date.now(), mode: '-rw-r--r--' }
  )
}

const normalizeAssetInputMock = (input: TestAssetInput, existing?: TestAssetRecord): TestAssetRecord => {
  const id = input.id || existing?.id || `asset-test-${assetStoreMock.length + 1}`
  const name = String(input.name || existing?.name || input.host || 'asset').trim()
  const host = String(input.host || existing?.host || '127.0.0.1').trim()
  const group = String(input.group || input.group_name || existing?.group || '未分组').trim() || '未分组'
  return {
    id,
    uuid: existing?.uuid || input.uuid || id,
    name,
    title: String(input.title || input.name || existing?.title || name).trim(),
    host,
    ip: String(input.ip || input.host || existing?.ip || host).trim(),
    group,
    group_name: String(input.group_name || input.group || existing?.group_name || group).trim(),
    status: input.status || existing?.status || 'online',
    tags: Array.isArray(input.tags) ? input.tags.filter(Boolean) : existing?.tags ? [...existing.tags] : [],
    username: String(input.username || existing?.username || 'root').trim(),
    port: Number(input.port || existing?.port || 22),
    asset_type: input.asset_type || existing?.asset_type || 'person',
    auth_type: input.auth_type || existing?.auth_type || 'password',
    comment: input.comment ?? existing?.comment ?? '',
    data_source: input.data_source || existing?.data_source || 'manual',
    favorite: input.favorite ?? existing?.favorite ?? false,
    folderUuid: hasOwn(input, 'folderUuid') ? input.folderUuid : existing?.folderUuid,
    organizationId: hasOwn(input, 'organizationId') ? input.organizationId : existing?.organizationId,
    tunnelState: hasOwn(input, 'tunnelState') ? input.tunnelState : existing?.tunnelState,
    needProxy: input.needProxy ?? existing?.needProxy ?? false,
    proxyName: hasOwn(input, 'proxyName') ? input.proxyName : existing?.proxyName,
    keychainId: hasOwn(input, 'keychainId') ? input.keychainId : existing?.keychainId,
    jumpHostId: hasOwn(input, 'jumpHostId') ? input.jumpHostId : existing?.jumpHostId,
    hasPassword: hasOwn(input, 'password') ? Boolean(input.password) : Boolean(input.hasPassword || existing?.hasPassword),
    hasPrivateKey: hasOwn(input, 'privateKey') ? Boolean(input.privateKey) : Boolean(input.keychainId || input.hasPrivateKey || existing?.hasPrivateKey)
  }
}

const normalizeAssetFolderInputMock = (input: TestAssetFolderSaveInput, existing?: TestAssetFolder): TestAssetFolder => {
  const parentUuid = String(hasOwn(input, 'parentUuid') ? input.parentUuid || '' : existing?.parentUuid || '').trim()
  const scope = (hasOwn(input, 'scope') ? input.scope : existing?.scope) || 'bastion'
  return {
    uuid: existing?.uuid || input.uuid || `folder-test-${assetFolderStoreMock.length + 1}`,
    name: String(input.name || existing?.name || 'folder').trim(),
    description: String(input.description ?? existing?.description ?? '').trim(),
    ...(parentUuid ? { parentUuid } : {}),
    scope: scope === 'direct' ? 'direct' : 'bastion'
  }
}

const assetFolderScopeMock = (folder: Pick<TestAssetFolder, 'scope'>) => (folder.scope === 'direct' ? 'direct' : 'bastion')

const validateAssetFolderParentMock = (folder: TestAssetFolder) => {
  if (!folder.parentUuid) return null
  if (folder.parentUuid === folder.uuid) return 'Folder cannot be its own parent'
  const parent = assetFolderStoreMock.find((item) => item.uuid === folder.parentUuid)
  if (!parent) return 'Parent folder not found'
  if (assetFolderScopeMock(parent) !== assetFolderScopeMock(folder)) return 'Folder parent scope mismatch'
  return null
}

const assetSnapshotMock = () => ({
  assets: assetStoreMock.map(cloneAsset),
  folders: assetFolderStoreMock.map(cloneAssetFolder)
})

const syncAssetSecretMock = (asset: TestAssetRecord, input: TestAssetInput) => {
  const existingSecret = assetSecretStoreMock[asset.id] || {}
  const nextSecret: TestAssetSecret = { ...existingSecret }
  if (hasOwn(input, 'password')) {
    if (typeof input.password === 'string' && input.password) nextSecret.password = input.password
    else delete nextSecret.password
  }
  if (nextSecret.password) {
    assetSecretStoreMock[asset.id] = nextSecret
  } else {
    delete assetSecretStoreMock[asset.id]
  }
}

const refreshOrganizationAssetsMock = (input?: { organizationId?: string }) => {
  const organizations = assetStoreMock.filter(
    (asset) =>
      asset.asset_type === 'organization' &&
      (!input?.organizationId || asset.id === input.organizationId || asset.uuid === input.organizationId)
  )
  if (input?.organizationId && organizations.length === 0) {
    return { ok: false as const, errorCode: 'ASSET_BACKEND_ERROR', errorMessage: `Organization asset not found: ${input.organizationId}` }
  }
  let created = 0
  let updated = 0
  organizations.forEach((organization, index) => {
    const draft = refreshedAssetForOrganizationMock(organization, index)
    const existingIndex = assetStoreMock.findIndex((asset) => asset.id === draft.id)
    const asset = normalizeAssetInputMock(draft, existingIndex >= 0 ? assetStoreMock[existingIndex] : undefined)
    assetStoreMock =
      existingIndex >= 0 ? assetStoreMock.map((item) => (item.id === asset.id ? asset : item)) : [...assetStoreMock, asset]
    if (existingIndex >= 0) updated += 1
    else created += 1
  })
  return {
    ok: true as const,
    data: {
      ...assetSnapshotMock(),
      ...(input?.organizationId && organizations[0] ? { organizationId: organizations[0].uuid || organizations[0].id } : {}),
      refreshed: created + updated,
      created,
      updated
    }
  }
}

const localFileContentMock = (filePath: string) => {
  const localPath = String(filePath || '')
  if (localPath.endsWith('external-reference-assets.json')) {
    return JSON.stringify([
      { username: 'ops', ip: '10.24.8.12', label: 'prod-bastion-imported', group_name: '生产', port: 22 },
      { username: 'ops', ip: '10.55.0.9', label: 'imported-json', group_name: 'Imported', port: 2200 }
    ])
  }
  if (localPath.endsWith('MobaXterm.mxtsessions')) {
    return [
      '[Bookmarks]',
      'moba-prod=#109#0%10.88.1.5%22%mobauser%%-1%10.88.1.1%2200%jumpuser%-1%2224%-1%_ProfileDir_/keys/moba.pem'
    ].join('\n')
  }
  if (localPath.endsWith('unit-rsa.pem')) {
    return '-----BEGIN RSA PRIVATE KEY-----\nunit import\n-----END RSA PRIVATE KEY-----'
  }
  if (localPath.endsWith('drop-ed25519.key')) {
    return '-----BEGIN OPENSSH PRIVATE KEY-----\nssh-ed25519\n-----END OPENSSH PRIVATE KEY-----'
  }
  return [
    'apiVersion: v1',
    'kind: Config',
    'current-context: prod/admin',
    'clusters:',
    '- name: prod-cluster',
    '  cluster:',
    '    server: https://prod.k8s.local:6443',
    '- name: staging-cluster',
    '  cluster:',
    '    server: https://staging.k8s.local:6443',
    'contexts:',
    '- name: prod/admin',
    '  context:',
    '    cluster: prod-cluster',
    '    namespace: default',
    '- name: staging/devops',
    '  context:',
    '    cluster: staging-cluster',
    '    namespace: staging'
  ].join('\n')
}

const assetImportFileNameMock = (filePath: string) => filePath.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || filePath

const readAssetImportDraftsMock = (input?: { filePath?: string }) => {
  const filePath = String(input?.filePath || '').trim()
  if (!filePath) throw new Error('导入文件路径不能为空。')
  const fileName = assetImportFileNameMock(filePath)
  const drafts = parseAssetImportContent(localFileContentMock(filePath), fileName)
  if (!drafts.length) throw new Error('导入文件没有可识别的主机。')
  return { filePath, fileName, drafts }
}

const findAssetImportDuplicateMock = (draft: ImportedAssetDraft) =>
  assetStoreMock.find((asset) => !asset.isLocalShell && asset.host === draft.host && asset.username === draft.username && Number(asset.port) === Number(draft.port))

const assetImportPreviewRecordMock = (draft: ImportedAssetDraft, index: number) => {
  const duplicate = findAssetImportDuplicateMock(draft)
  return {
    previewId: `import-${index}-${draft.host}-${draft.port}`,
    duplicateId: duplicate?.id,
    duplicateTitle: duplicate?.title,
    title: draft.title,
    host: draft.host,
    username: draft.username,
    group: draft.group,
    port: draft.port,
    auth_type: draft.auth_type,
    asset_type: draft.asset_type,
    comment: draft.comment,
    needProxy: draft.needProxy,
    proxyName: draft.proxyName
  }
}

const assetImportInputMock = (draft: ImportedAssetDraft, existing?: TestAssetRecord): TestAssetInput => ({
  ...(existing ? { id: existing.id } : {}),
  name: draft.title,
  title: draft.title,
  host: draft.host,
  ip: draft.host,
  group: draft.group,
  group_name: draft.group,
  status: 'online',
  tags: ['imported'],
  username: draft.username,
  port: draft.port,
  asset_type: draft.asset_type,
  auth_type: draft.auth_type,
  comment: draft.comment,
  password: draft.password,
  needProxy: draft.needProxy,
  proxyName: draft.proxyName,
  data_source: existing?.data_source || 'manual'
})

const normalizeSshTunnelTypeMock = (type?: TestSshTunnelType): TestSshTunnelType =>
  type === 'local_forward' || type === 'remote_forward' || type === 'dynamic_socks' ? type : 'local_forward'

const setAssetTunnelStateMock = (assetId: string, tunnelState: TestAssetRecord['tunnelState']) => {
  const asset = assetStoreMock.find((item) => item.id === assetId)
  if (!asset) return null
  const nextAsset = { ...asset, tunnelState }
  assetStoreMock = assetStoreMock.map((item) => (item.id === assetId ? nextAsset : item))
  return nextAsset
}

const findTunnelAssetMock = (assetId?: string) => {
  const id = String(assetId || '').trim()
  const asset = assetStoreMock.find((item) => item.id === id)
  if (!asset) return null
  if (asset.isLocalShell) throw new Error('本地连接不支持 SSH 隧道')
  if (asset.asset_type !== 'person') throw new Error('只有 SSH 主机资产支持隧道')
  return asset
}

const tunnelResultMock = (tunnel: TestSshTunnelRecord, message: string) => ({
  ok: true as const,
  data: {
    ...assetSnapshotMock(),
    tunnel: { ...tunnel },
    message
  }
})

const refreshedAssetForOrganizationMock = (organization: TestAssetRecord, index: number): TestAssetInput => {
  const baseName = organization.title || organization.name || organization.host || 'organization'
  const hostOctet = 15 + index
  return {
    id: `${organization.id}-synced`,
    name: `${baseName}-synced-asset`,
    title: `${baseName}-synced-asset`,
    host: `10.90.0.${hostOctet}`,
    ip: `10.90.0.${hostOctet}`,
    group: organization.group || organization.group_name || '企业',
    group_name: organization.group_name || organization.group || '企业',
    status: 'online',
    tags: ['jumpserver', 'synced'],
    username: 'jump',
    port: 22,
    asset_type: 'person',
    auth_type: 'keyBased',
    comment: '刷新来源资产',
    data_source: 'refresh',
    organizationId: organization.uuid || organization.id,
    keychainId: organization.keychainId
  }
}

const detectKeyTypeMock = (privateKey = '', publicKey = ''): 'rsa' | 'ed25519' | 'ecdsa' => {
  const publicAlgorithm = publicKey.trim().split(/\s+/)[0]?.toLowerCase()
  if (publicAlgorithm === 'ssh-ed25519') return 'ed25519'
  if (publicAlgorithm === 'ssh-rsa') return 'rsa'
  if (publicAlgorithm?.startsWith('ecdsa-')) return 'ecdsa'
  if (privateKey.includes('BEGIN EC PRIVATE KEY') || privateKey.includes('ecdsa-sha2')) return 'ecdsa'
  if (privateKey.includes('ssh-ed25519')) return 'ed25519'
  if (privateKey.includes('BEGIN RSA PRIVATE KEY') || privateKey.includes('ssh-rsa')) return 'rsa'
  return 'rsa'
}

const normalizeKeychainInputMock = (input: TestKeychainInput, existing?: TestKeychainRecord): TestKeychainRecord => {
  const now = Date.now()
  const privateKey = String(input.privateKey ?? existing?.privateKey ?? '').trim()
  return {
    id: input.id || existing?.id || `key-test-${Date.now()}-${keychainStoreMock.length}`,
    name: String(input.name || existing?.name || 'keychain').trim(),
    type: input.type || detectKeyTypeMock(privateKey, input.publicKey || existing?.publicKey || ''),
    publicKey: String(input.publicKey ?? existing?.publicKey ?? '').trim(),
    privateKey,
    passphrase: input.passphrase ?? existing?.passphrase ?? '',
    hasPrivateKey: Boolean(privateKey || existing?.hasPrivateKey),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }
}

const defaultMcpConfigContent = JSON.stringify(
  {
    mcpServers: {
      filesystem: {
        type: 'stdio',
        disabled: false,
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '~'],
        timeout: 60
      },
      'ops-inventory': {
        type: 'stdio',
        disabled: false,
        command: 'ops-inventory',
        args: [],
        timeout: 60
      }
    }
  },
  null,
  2
)

let mcpServersMock = defaultMcpServers.map(cloneMcpServerMock)
let mcpConfigContentMock = defaultMcpConfigContent

const createDefaultConfigMock = () => ({
  language: 'zh-CN',
  theme: 'dark',
  defaultMode: 'terminal',
  leftPanelOpen: true,
  rightPanelOpen: true,
  agentsLeftOpen: true,
  leftPanelWidth: 286,
  rightPanelWidth: 360,
  agentsLeftWidth: 286,
  modelProvider: 'local',
  modelEndpoint: '',
  modelName: 'aiopsterm-local-agent',
  watermark: 'open',
  background: {
    mode: 'none',
    image: '',
    opacity: 0.68,
    brightness: 0.92,
    lastCustomImage: ''
  },
  terminal: {
    terminalType: 'xterm-256color',
    fontFamily: '"DejaVu Sans Mono", "Noto Sans Mono", "Liberation Mono", monospace',
    fontSize: 12,
    scrollBack: 1000,
    cursorStyle: 'block',
    cursorBlink: true,
    lineHeight: 1,
    pinchZoomStatus: true,
    showCloseButton: true,
    sshAgentsStatus: false,
    middleMouseEvent: 'paste',
    rightMouseEvent: 'contextMenu'
  },
  workspacePreferences: defaultWorkspacePreferencesSeedData(),
  editorSettings: defaultEditorSettings,
  sshProxyConfigs: defaultSshProxyConfigs,
  sshAgentKeys: defaultSshAgentKeys,
  extensionSettings: defaultExtensionSettings,
  keywordHighlight: defaultKeywordHighlight,
  securityConfig: defaultSecurityConfig,
  privacy: defaultPrivacy,
  aiPreferences: defaultAiPreferences,
  notifications: {
    desktopNotifications: true,
    controlNotificationBell: true
  },
  modelSettings: defaultModelSettings,
  shortcuts: defaultShortcuts,
  rules: defaultRules,
  skills: cloneSkills(),
  mcpServers: mcpServersMock.map(cloneMcpServerMock),
  mcpToolStates: getMcpToolStatesMock(mcpServersMock),
  quickCommands: defaultQuickCommands,
  knowledgeBase: defaultKnowledgeBase,
  aliasCommands: defaultAliasCommands,
  onboarding: {
    version: 2,
    guideTabAutoOpened: false,
    completedModules: {
      interfaceGuide: false,
      systemSettings: false,
      addAndConnectHost: false,
      aiChat: false
    }
  }
})

let configStoreMock = createDefaultConfigMock()

const resetConfigStoreMock = () => {
  configStoreMock = createDefaultConfigMock()
}

const resetMcpStoreMock = () => {
  mcpServersMock = defaultMcpServers.map(cloneMcpServerMock)
  mcpConfigContentMock = defaultMcpConfigContent
  resetConfigStoreMock()
}

const applyMcpConfigContentMock = (content: string) => {
  const parsed = JSON.parse(content) as {
    mcpServers?: Record<string, { disabled?: boolean; autoApprove?: unknown }>
  }
  const entries = Object.entries(parsed.mcpServers || {})
  const existing = new Map(mcpServersMock.map((server) => [server.name, server]))
  mcpServersMock = entries.map(([name, config]) => {
    const fallback = defaultMcpServers.find((server) => server.name === name)
    const source = existing.get(name) || (fallback ? cloneMcpServerMock(fallback) : null)
    const approved = new Set(Array.isArray(config.autoApprove) ? config.autoApprove.filter((item): item is string => typeof item === 'string') : [])
    return {
      name,
      status: config.disabled ? 'disabled' : source?.status && source.status !== 'disabled' ? source.status : 'connected',
      disabled: Boolean(config.disabled),
      ...(source?.error && !config.disabled ? { error: source.error } : {}),
      tools:
        source?.tools.map((tool) => ({
          ...tool,
          autoApprove: approved.has(tool.name),
          parameters: tool.parameters.map((parameter) => ({ ...parameter }))
        })) || [],
      resources: source?.resources.map((resource) => ({ ...resource })) || []
    }
  })
  mcpConfigContentMock = JSON.stringify(parsed, null, 2)
  return {
    mcpConfig: parsed,
    mcpServers: mcpServersMock.map(cloneMcpServerMock),
    mcpToolStates: getMcpToolStatesMock(mcpServersMock)
  }
}

const currentMcpConfigMutationDataMock = () => ({
  mcpConfig: (JSON.parse(mcpConfigContentMock) as { mcpServers?: Record<string, unknown> }) || { mcpServers: {} },
  mcpServers: mcpServersMock.map(cloneMcpServerMock),
  mcpToolStates: getMcpToolStatesMock(mcpServersMock)
})

const callMcpToolMock = async (serverName: string, toolName: string, args?: Record<string, unknown>) => {
  const server = mcpServersMock.find((item) => item.name === serverName)
  if (!server) return { ok: false, errorCode: 'MCP_TOOL_SERVER_NOT_FOUND', errorMessage: `MCP server not found: ${serverName}` }
  if (server.disabled) return { ok: false, errorCode: 'MCP_TOOL_SERVER_DISABLED', errorMessage: `MCP server "${serverName}" is disabled.` }
  const tool = server.tools.find((item) => item.name === toolName)
  if (!tool) return { ok: false, errorCode: 'MCP_TOOL_NOT_FOUND', errorMessage: `MCP tool not found: ${serverName}:${toolName}` }
  if (!tool.enabled) return { ok: false, errorCode: 'MCP_TOOL_DISABLED', errorMessage: `MCP tool "${serverName}:${toolName}" is disabled.` }
  return {
    ok: true,
    data: {
      serverName,
      toolName,
      ...(args ? { arguments: { ...args } } : {}),
      content: [{ type: 'text', text: `MCP tool ${serverName}:${toolName} executed.` }],
      isError: false,
      durationMs: 1
    }
  }
}

const readMcpResourceMock = async (serverName: string, uri: string) => {
  const server = mcpServersMock.find((item) => item.name === serverName)
  if (!server) return { ok: false, errorCode: 'MCP_RESOURCE_SERVER_NOT_FOUND', errorMessage: `MCP server not found: ${serverName}` }
  if (server.disabled) return { ok: false, errorCode: 'MCP_RESOURCE_SERVER_DISABLED', errorMessage: `MCP server "${serverName}" is disabled.` }
  const resource = server.resources.find((item) => item.uri === uri)
  if (!resource) return { ok: false, errorCode: 'MCP_RESOURCE_NOT_FOUND', errorMessage: `MCP resource not found: ${serverName}:${uri}` }
  return {
    ok: true,
    data: {
      serverName,
      uri,
      contents: [{ uri, mimeType: 'text/plain', text: `MCP resource ${uri}` }],
      durationMs: 1
    }
  }
}

const handleAiMcpToolCallActionMock = async (input: { conversationId: string; messageId: string; autoApprove?: boolean }, approve: boolean) => {
  const conversation = chatHistoryStateMock.conversations.find((item) => item.id === input.conversationId)
  if (!conversation) return { ok: false, errorCode: 'CHAT_HISTORY_NOT_FOUND', errorMessage: 'Conversation not found.' }
  const messages = cloneChatMessages(chatHistoryStateMock.messagesByConversationId[input.conversationId] || [])
  const message = messages.find((item) => item.id === input.messageId)
  if (!message?.mcpToolCall || message.ask !== 'mcp_tool_call') {
    return { ok: false, errorCode: 'AI_MCP_TOOL_CALL_NOT_FOUND', errorMessage: 'AI MCP tool call message was not found.' }
  }
  if (!approve) {
    message.action = 'rejected'
    message.state = 'done'
    chatHistoryStateMock.messagesByConversationId[input.conversationId] = cloneChatMessages(messages)
    return {
      ok: true,
      data: {
        status: 'rejected' as const,
        conversation: cloneChatConversation(conversation),
        messages: cloneChatMessages(messages)
      }
    }
  }
  let mcpConfig: ReturnType<typeof applyMcpConfigContentMock> | undefined
  if (input.autoApprove) {
    const parsed = JSON.parse(mcpConfigContentMock) as { mcpServers?: Record<string, { autoApprove?: unknown }> }
    const serverConfig = parsed.mcpServers?.[message.mcpToolCall.serverName]
    if (!serverConfig) return { ok: false, errorCode: 'MCP_CONFIG_INVALID', errorMessage: 'MCP server config not found.' }
    const approved = new Set(Array.isArray(serverConfig.autoApprove) ? serverConfig.autoApprove.filter((item): item is string => typeof item === 'string') : [])
    approved.add(message.mcpToolCall.toolName)
    serverConfig.autoApprove = [...approved]
    mcpConfig = applyMcpConfigContentMock(JSON.stringify(parsed, null, 2))
  }
  const toolResult = await callMcpToolMock(message.mcpToolCall.serverName, message.mcpToolCall.toolName, message.mcpToolCall.arguments)
  message.action = 'approved'
  message.say = 'command_output'
  message.state = toolResult.ok && toolResult.data && !toolResult.data.isError ? 'done' : 'error'
  message.text = toolResult.ok && toolResult.data ? String(toolResult.data.content[0]?.text || '') : toolResult.errorMessage || 'MCP tool call failed.'
  chatHistoryStateMock.messagesByConversationId[input.conversationId] = cloneChatMessages(messages)
  return {
    ok: true,
    data: {
      status: 'approved' as const,
      conversation: cloneChatConversation(conversation),
      messages: cloneChatMessages(messages),
      ...(toolResult.ok && toolResult.data
        ? { toolCall: toolResult.data }
        : { toolCallError: { errorCode: toolResult.errorCode, errorMessage: toolResult.errorMessage || 'MCP tool call failed.' } }),
      ...(mcpConfig ? { mcpConfig } : {})
    }
  }
}

const handleAiMcpResourceAccessActionMock = async (input: { conversationId: string; messageId: string }, approve: boolean) => {
  const conversation = chatHistoryStateMock.conversations.find((item) => item.id === input.conversationId)
  if (!conversation) return { ok: false, errorCode: 'CHAT_HISTORY_NOT_FOUND', errorMessage: 'Conversation not found.' }
  const messages = cloneChatMessages(chatHistoryStateMock.messagesByConversationId[input.conversationId] || [])
  const message = messages.find((item) => item.id === input.messageId)
  if (!message?.mcpResourceAccess || message.ask !== 'mcp_resource_access') {
    return { ok: false, errorCode: 'AI_MCP_RESOURCE_ACCESS_NOT_FOUND', errorMessage: 'AI MCP resource access message was not found.' }
  }
  if (!approve) {
    message.action = 'rejected'
    message.state = 'done'
    chatHistoryStateMock.messagesByConversationId[input.conversationId] = cloneChatMessages(messages)
    return {
      ok: true,
      data: {
        status: 'rejected' as const,
        conversation: cloneChatConversation(conversation),
        messages: cloneChatMessages(messages)
      }
    }
  }
  const resourceResult = await readMcpResourceMock(message.mcpResourceAccess.serverName, message.mcpResourceAccess.uri)
  message.action = 'approved'
  message.say = 'command_output'
  message.state = resourceResult.ok && resourceResult.data ? 'done' : 'error'
  message.text = resourceResult.ok && resourceResult.data ? String(resourceResult.data.contents[0]?.text || '') : resourceResult.errorMessage || 'MCP resource access failed.'
  chatHistoryStateMock.messagesByConversationId[input.conversationId] = cloneChatMessages(messages)
  return {
    ok: true,
    data: {
      status: 'approved' as const,
      conversation: cloneChatConversation(conversation),
      messages: cloneChatMessages(messages),
      ...(resourceResult.ok && resourceResult.data
        ? { resourceAccess: resourceResult.data }
        : { resourceAccessError: { errorCode: resourceResult.errorCode, errorMessage: resourceResult.errorMessage || 'MCP resource access failed.' } })
    }
  }
}

let systemTheme: 'dark' | 'light' = 'light'
const matchMediaListeners = new Set<(event: MediaQueryListEvent) => void>()

const createMatchMediaResult = (query: string) => ({
  matches:
    query.includes('prefers-color-scheme: dark') ? systemTheme === 'dark' : query.includes('prefers-color-scheme: light') ? systemTheme === 'light' : false,
  media: query,
  onchange: null,
  addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
    matchMediaListeners.add(listener)
  }),
  removeListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
    matchMediaListeners.delete(listener)
  }),
  addEventListener: vi.fn((_event: string, listener: (event: MediaQueryListEvent) => void) => {
    matchMediaListeners.add(listener)
  }),
  removeEventListener: vi.fn((_event: string, listener: (event: MediaQueryListEvent) => void) => {
    matchMediaListeners.delete(listener)
  }),
  dispatchEvent: vi.fn()
})

Object.assign(globalThis, {
  __setSystemThemeMock: (theme: 'dark' | 'light') => {
    systemTheme = theme
    const event = { matches: theme === 'dark', media: '(prefers-color-scheme: dark)' } as MediaQueryListEvent
    matchMediaListeners.forEach((listener) => listener(event))
  },
  __resetChatHistoryStoreMock: resetChatHistoryStoreMock,
  __setChatHistoryStoreMock: setChatHistoryStoreMock,
  __resetAiTodoSnapshotMock: resetAiTodoSnapshotMock,
  __setAiTodoSnapshotMock: setAiTodoSnapshotMock,
  __setActiveAiTodoSnapshotMock: () => setAiTodoSnapshotMock(activeAiTodoItems),
  __resetAssetStoreMock: resetAssetStoreMock,
  __resetKubernetesCatalogMock: resetKubernetesCatalogMock,
	  __resetFileSessionCatalogMock: resetFileSessionCatalogMock,
	  __resetDatabaseTableRowsMock: resetDatabaseTableRowsMock,
	  __resetDatabaseSqlExecutionMock: () => {
	    databaseSqlExecutionSeqMock = 0
	  },
	  __resetExtensionPluginStoreMock: resetExtensionPluginStoreMock,
  __setExtensionPluginStoreMock: setExtensionPluginStoreMock,
  __loadExtensionPluginStoreFixtureMock: () => setExtensionPluginStoreMock([...defaultExtensionPluginCatalog, ...extensionPluginStoreFixtureCatalog]),
  __resetConfigStoreMock: resetConfigStoreMock,
  __resetUserAccountStoreMock: resetUserAccountStoreMock,
  __resetSkillsStoreMock: resetSkillsStoreMock,
  __setUserAccountProfileMock: (patch: Partial<TestUserProfile>) => applyUserProfileMock(patch),
  __resetMcpStoreMock: resetMcpStoreMock,
  __resetFileEntriesMock: () => {
    fileEntriesMock = []
    fileTransferTasksMock = []
    fileTransferTaskSequenceMock = 1
    resetExtensionPluginStoreMock()
  }
})

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(createMatchMediaResult)
})

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  writable: true,
  value: vi.fn(() => ({
    measureText: () => ({ width: 8 }),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: [] })),
    putImageData: vi.fn(),
    createImageData: vi.fn(() => []),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    fillText: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn()
  }))
})

Object.defineProperty(navigator, 'clipboard', {
  writable: true,
  value: {
    readText: vi.fn(async () => 'clipboard-command'),
    writeText: vi.fn(async () => undefined)
  }
})

Object.defineProperty(window, 'aiops', {
  writable: true,
  value: {
    platform: vi.fn(async () => 'linux'),
    shell: vi.fn(async () => '/bin/bash'),
    checkUpdate: vi.fn(async () => ({
      available: false,
      channel: 'local',
      isUpdateAvailable: false,
      versionInfo: { version: '0.1.0', channel: 'local' },
      updateInfo: null
    })),
    downloadAppUpdate: vi.fn(async (version: string) => {
      emitAppUpdateProgressMock({ status: 'downloading', version, percent: 40 })
      emitAppUpdateProgressMock({ status: 'downloaded', version, percent: 100 })
      return {
        ok: true,
        data: {
          version,
          status: 'downloaded' as const,
          percent: 100 as const,
          filePath: `/tmp/aiopsterm-test-updates/${version}.bin`,
          size: 1024,
          sha256: createHash('sha256').update(version).digest('hex'),
          message: `Update ${version} downloaded by test backend.`
        }
      }
    }),
    installAppUpdate: vi.fn(async (version?: string) => ({
      ok: true,
      data: {
        version: version || '0.1.1',
        status: 'install-requested' as const,
        filePath: `/tmp/aiopsterm-test-updates/${version || '0.1.1'}.bin`,
        size: 1024,
        sha256: createHash('sha256').update(version || '0.1.1').digest('hex'),
        handoff: {
          kind: 'os-open' as const,
          accepted: true as const
        },
        requestedAt: '2026-06-09T10:00:00.000Z',
        message: `Update ${version || '0.1.1'} install requested by test backend.`
      }
    })),
    onAppUpdateProgress: vi.fn((listener: (event: TestAppUpdateProgressEvent) => void) => {
      appUpdateProgressListeners.add(listener)
      return () => {
        appUpdateProgressListeners.delete(listener)
      }
    }),
    listChatConversations: vi.fn(async () => chatHistoryListResultMock()),
    listAiTodoSnapshot: vi.fn(async () => aiTodoSnapshotResultMock()),
    listAiContextCatalog: vi.fn(async () => aiContextCatalogResultMock()),
    listAiCommandCatalog: vi.fn(async () => aiCommandCatalogResultMock()),
    listAgentHookInstallers: vi.fn(async () => ({
      ok: true,
      data: {
        installers: [
          {
            source: 'codex' as const,
            label: 'Codex',
            binaryName: 'codex',
            binaryPath: '/usr/bin/codex',
            configPath: '/home/test/.codex/hooks.json',
            configExists: false,
            installed: false,
            scriptPath: '/opt/aiopsterm/resources/aiopsterm-agent-hook.js',
            extraConfigPath: '/home/test/.codex/config.toml',
            warnings: []
          },
          {
            source: 'claude-code' as const,
            label: 'Claude Code',
            binaryName: 'claude',
            binaryPath: '/home/test/.local/bin/claude',
            configPath: '/home/test/.claude/settings.json',
            configExists: false,
            installed: false,
            scriptPath: '/opt/aiopsterm/resources/aiopsterm-agent-hook.js',
            warnings: []
          }
        ]
      }
    })),
    installAgentHook: vi.fn(async (input: { source: 'codex' | 'claude-code' }) => ({
      ok: true,
      data: {
        operation: 'install' as const,
        source: input.source,
        status: {
          source: input.source,
          label: input.source === 'codex' ? 'Codex' : 'Claude Code',
          binaryName: input.source === 'codex' ? 'codex' : 'claude',
          binaryPath: input.source === 'codex' ? '/usr/bin/codex' : '/home/test/.local/bin/claude',
          configPath: input.source === 'codex' ? '/home/test/.codex/hooks.json' : '/home/test/.claude/settings.json',
          configExists: true,
          installed: true,
          scriptPath: '/opt/aiopsterm/resources/aiopsterm-agent-hook.js',
          ...(input.source === 'codex' ? { extraConfigPath: '/home/test/.codex/config.toml' } : {}),
          warnings: []
        },
        snapshot: {
          installers: [
            {
              source: 'codex' as const,
              label: 'Codex',
              binaryName: 'codex',
              binaryPath: '/usr/bin/codex',
              configPath: '/home/test/.codex/hooks.json',
              configExists: true,
              installed: input.source === 'codex',
              scriptPath: '/opt/aiopsterm/resources/aiopsterm-agent-hook.js',
              extraConfigPath: '/home/test/.codex/config.toml',
              warnings: []
            },
            {
              source: 'claude-code' as const,
              label: 'Claude Code',
              binaryName: 'claude',
              binaryPath: '/home/test/.local/bin/claude',
              configPath: '/home/test/.claude/settings.json',
              configExists: true,
              installed: input.source === 'claude-code',
              scriptPath: '/opt/aiopsterm/resources/aiopsterm-agent-hook.js',
              warnings: []
            }
          ]
        }
      }
    })),
    uninstallAgentHook: vi.fn(async (input: { source: 'codex' | 'claude-code' }) => ({
      ok: true,
      data: {
        operation: 'uninstall' as const,
        source: input.source,
        status: {
          source: input.source,
          label: input.source === 'codex' ? 'Codex' : 'Claude Code',
          binaryName: input.source === 'codex' ? 'codex' : 'claude',
          binaryPath: input.source === 'codex' ? '/usr/bin/codex' : '/home/test/.local/bin/claude',
          configPath: input.source === 'codex' ? '/home/test/.codex/hooks.json' : '/home/test/.claude/settings.json',
          configExists: true,
          installed: false,
          scriptPath: '/opt/aiopsterm/resources/aiopsterm-agent-hook.js',
          ...(input.source === 'codex' ? { extraConfigPath: '/home/test/.codex/config.toml' } : {}),
          warnings: []
        },
        snapshot: {
          installers: [
            {
              source: 'codex' as const,
              label: 'Codex',
              binaryName: 'codex',
              binaryPath: '/usr/bin/codex',
              configPath: '/home/test/.codex/hooks.json',
              configExists: true,
              installed: false,
              scriptPath: '/opt/aiopsterm/resources/aiopsterm-agent-hook.js',
              extraConfigPath: '/home/test/.codex/config.toml',
              warnings: []
            },
            {
              source: 'claude-code' as const,
              label: 'Claude Code',
              binaryName: 'claude',
              binaryPath: '/home/test/.local/bin/claude',
              configPath: '/home/test/.claude/settings.json',
              configExists: true,
              installed: false,
              scriptPath: '/opt/aiopsterm/resources/aiopsterm-agent-hook.js',
              warnings: []
            }
          ]
        }
      }
    })),
    listManagedAiSessions: vi.fn(async () => ({
      ok: true,
      data: {
        sessions: []
      }
    })),
    getAgentHibernationConfig: vi.fn(async () => ({
      ok: true,
      data: {
        config: {
          enabled: false,
          idleSeconds: 300,
          maxLiveTerminals: 12,
          confirmationSeconds: 60
        }
      }
    })),
    setAgentHibernationConfig: vi.fn(async (input: { enabled?: boolean; idleSeconds?: number; maxLiveTerminals?: number; confirmationSeconds?: number } = {}) => ({
      ok: true,
      data: {
        config: {
          enabled: input.enabled === true,
          idleSeconds: Number.isFinite(input.idleSeconds) ? Number(input.idleSeconds) : 300,
          maxLiveTerminals: Number.isFinite(input.maxLiveTerminals) ? Number(input.maxLiveTerminals) : 12,
          confirmationSeconds: Number.isFinite(input.confirmationSeconds) ? Number(input.confirmationSeconds) : 60
        }
      }
    })),
    hibernateManagedAiSession: vi.fn(async () => ({
      ok: true,
      data: {
        session: {
          id: 'codex-session-1',
          source: 'codex',
          title: 'Codex',
          summary: '',
          state: 'idle',
          lastEvent: 'stop',
          lastActivityAt: 1,
          createdAt: 1,
          updatedAt: 1,
          requestKind: 'telemetry',
          decisionMode: 'telemetry',
          hibernated: true,
          events: [],
          decisions: []
        },
        snapshot: { sessions: [] },
        config: {
          enabled: true,
          idleSeconds: 300,
          maxLiveTerminals: 12,
          confirmationSeconds: 60
        }
      }
    })),
    wakeManagedAiSession: vi.fn(async () => ({
      ok: true,
      data: {
        session: {
          id: 'codex-session-1',
          source: 'codex',
          title: 'Codex',
          summary: '',
          state: 'idle',
          lastEvent: 'stop',
          lastActivityAt: 1,
          createdAt: 1,
          updatedAt: 1,
          requestKind: 'telemetry',
          decisionMode: 'telemetry',
          events: [],
          decisions: []
        },
        snapshot: { sessions: [] },
        config: {
          enabled: true,
          idleSeconds: 300,
          maxLiveTerminals: 12,
          confirmationSeconds: 60
        }
      }
    })),
    replyManagedAiSession: vi.fn(async () => ({
      ok: true,
      data: {
        snapshot: {
          sessions: []
        }
      }
    })),
    renameManagedAiSession: vi.fn(async () => ({
      ok: true,
      data: {
        snapshot: {
          sessions: []
        }
      }
    })),
    clearManagedAiSession: vi.fn(async () => ({
      ok: true,
      data: {
        snapshot: {
          sessions: []
        }
      }
    })),
    bulkManagedAiSessions: vi.fn(async () => ({
      ok: true,
      data: {
        changed: 0,
        snapshot: {
          sessions: []
        }
      }
    })),
    createChatConversation: vi.fn(async () => {
      const conversation: TestChatConversationRecord = {
        id: `conv-test-${Date.now()}-${chatHistoryStateMock.conversations.length}`,
        title: '新会话',
        summary: '等待输入运维目标',
        updatedAt: '刚刚',
        ts: Math.max(Date.now(), ...chatHistoryStateMock.conversations.map((item) => item.ts), 0) + 1
      }
      chatHistoryStateMock.conversations.unshift(conversation)
      chatHistoryStateMock.selectedConversationId = conversation.id
      chatHistoryStateMock.messagesByConversationId[conversation.id] = []
      return {
        ok: true,
        data: {
          conversation: cloneChatConversation(conversation),
          conversations: chatHistoryStateMock.conversations.map(cloneChatConversation),
          selectedConversationId: chatHistoryStateMock.selectedConversationId
        }
      }
    }),
    updateChatConversation: vi.fn(async (input: TestChatConversationUpdateInput) => {
      const id = String(input.id || '').trim()
      const conversation = chatHistoryStateMock.conversations.find((item) => item.id === id)
      if (!conversation) return { ok: false, errorCode: 'CHAT_HISTORY_NOT_FOUND', errorMessage: 'Conversation not found.' }
      if (input.title !== undefined) {
        const title = String(input.title || '').trim()
        if (!title) return { ok: false, errorCode: 'CHAT_HISTORY_TITLE_REQUIRED', errorMessage: 'Conversation title is required.' }
        conversation.title = title
      }
      if (input.summary !== undefined) conversation.summary = String(input.summary || conversation.summary).trim() || conversation.summary
      if (input.favorite !== undefined) conversation.favorite = Boolean(input.favorite)
      let savedMessages = false
      if (Array.isArray(input.messages) && input.messages.length) {
        chatHistoryStateMock.messagesByConversationId[id] = cloneChatMessages(input.messages)
        savedMessages = true
      }
      conversation.updatedAt = '刚刚'
      conversation.ts = Math.max(Date.now(), ...chatHistoryStateMock.conversations.map((item) => item.ts), 0) + 1
      if (savedMessages) chatHistoryStateMock.selectedConversationId = id
      return {
        ok: true,
        data: {
          conversation: cloneChatConversation(conversation),
          conversations: chatHistoryStateMock.conversations.map(cloneChatConversation),
          selectedConversationId: chatHistoryStateMock.selectedConversationId
        }
      }
    }),
    deleteChatConversation: vi.fn(async (id: string) => {
      const exists = chatHistoryStateMock.conversations.some((conversation) => conversation.id === id)
      if (!exists) return { ok: false, errorCode: 'CHAT_HISTORY_NOT_FOUND', errorMessage: 'Conversation not found.' }
      chatHistoryStateMock.conversations = chatHistoryStateMock.conversations.filter((conversation) => conversation.id !== id)
      delete chatHistoryStateMock.messagesByConversationId[id]
      if (chatHistoryStateMock.selectedConversationId === id) {
        chatHistoryStateMock.selectedConversationId = chatHistoryStateMock.conversations[0]?.id || ''
      }
      return {
        ok: true,
        data: {
          deletedId: id,
          conversations: chatHistoryStateMock.conversations.map(cloneChatConversation),
          selectedConversationId: chatHistoryStateMock.selectedConversationId
        }
      }
    }),
    restoreChatConversation: vi.fn(async (id: string) => {
      const conversation = chatHistoryStateMock.conversations.find((item) => item.id === id)
      if (!conversation) return { ok: false, errorCode: 'CHAT_HISTORY_NOT_FOUND', errorMessage: 'Conversation not found.' }
      chatHistoryStateMock.selectedConversationId = id
      return {
        ok: true,
        data: {
          conversation: cloneChatConversation(conversation),
          messages: cloneChatMessages(chatHistoryStateMock.messagesByConversationId[id] || [])
        }
      }
    }),
    saveChatMessageMetadata: vi.fn(async (input: TestChatMessageMetadataInput) => {
      const conversationId = String(input.conversationId || '').trim()
      const messageId = String(input.messageId || '').trim()
      const conversation = chatHistoryStateMock.conversations.find((item) => item.id === conversationId)
      if (!conversation) return { ok: false, errorCode: 'CHAT_HISTORY_NOT_FOUND', errorMessage: 'Conversation not found.' }
      const messages = chatHistoryStateMock.messagesByConversationId[conversationId] || []
      const message = messages.find((item) => item.id === messageId)
      if (!message) return { ok: false, errorCode: 'CHAT_HISTORY_MESSAGE_NOT_FOUND', errorMessage: 'Message not found.' }
      if (input.favorite !== undefined) message.favorite = Boolean(input.favorite)
      if (input.feedback !== undefined) {
        if (input.feedback === 'up' || input.feedback === 'down') {
          message.feedback = input.feedback
        } else {
          delete message.feedback
        }
      }
      chatHistoryStateMock.messagesByConversationId[conversationId] = messages
      return {
        ok: true,
        data: {
          conversation: cloneChatConversation(conversation),
          messages: cloneChatMessages(messages)
        }
      }
    }),
    createAiChatExchangeRequest: vi.fn(
      async (input: {
        text: string
        hosts?: TestChatHistoryHostContext[]
        messages?: TestAiChatMessageInput[]
        contexts?: TestAiChatContextInput[]
        command?: TestAiChatCommandInput | null
        model?: string
        mode?: 'agent' | 'command' | 'chat'
      }) => {
        const text = normalizeAiChatTextMock(input.text)
        const contexts = normalizeAiChatContextsMock(input.contexts)
        const command = normalizeAiChatCommandMock(input.command)
        const skills = selectedAiChatSkillsMock(contexts)
        const prompt = buildAiChatExchangePromptMock(text, contexts, skills, command)
        if (!prompt) return { ok: false, errorCode: 'empty_prompt', errorMessage: 'Prompt is required' }
        const requestId = `aichat-request-test-${aiChatExchangeRequestSequenceMock++}`
        const assistantMessageId = `${requestId}-assistant`
        const responseInput = {
          requestId,
          assistantMessageId,
          prompt,
          messages: buildAiChatResponseMessagesMock(input.messages, prompt),
          contexts,
          skills,
          command,
          model: normalizeAiChatTextMock(input.model) || undefined,
          mode: input.mode
        }
        recordAiTodoRequestMock({ ...input, text: prompt }, requestId, assistantMessageId)
        return {
          ok: true,
          data: {
            requestId,
            userMessage: {
              id: `${requestId}-user`,
              role: 'user' as const,
              text: prompt,
              hosts: input.hosts?.map((host) => ({ ...host }))
            },
            assistantMessage: {
              id: assistantMessageId,
              role: 'assistant' as const,
              text: '正在请求 aiopsterm AI 后端...',
              state: 'streaming' as const
            },
            responseInput,
            contextUsage: createAiChatContextUsageMock({
              requestId,
              assistantMessageId,
              prompt,
              messages: responseInput.messages,
              contexts,
              skills,
              command
            })
          }
        }
      }
    ),
    getUserAccount: vi.fn(async () => ({
      ok: true as const,
      data: userAccountSnapshotMock()
    })),
    openUserLogin: vi.fn(async () => {
      return userExternalActionSuccessMock('login', 'https://accounts.aiopsterm.local/login')
    }),
    openUserAccountCenter: vi.fn(async () => userExternalActionSuccessMock('account-center', 'https://accounts.aiopsterm.local/account-center')),
    loginUserAccount: vi.fn(
      async (
        input:
          | { method: 'account'; username: string; password: string }
          | { method: 'email'; email: string; code: string }
          | { method: 'mobile'; mobile: string; code: string }
      ) => {
        if (input.method === 'account') {
          const username = trimUserTextMock(input.username)
          if (!username || !input.password) return userErrorMock('USER_LOGIN_REQUIRED', '请输入用户名和密码')
          const credential = findUserCredentialMock(username)
          if (!credential || !verifyUserCredentialPasswordMock(credential, input.password)) {
            return userErrorMock('USER_LOGIN_INVALID', '用户名或密码不正确')
          }
          if (credential.requiresDeviceVerification) {
            applyUserProfileMock({
              username: credential.username,
              needDeviceVerification: true,
              localDatabaseReady: false
            })
            return {
              ok: false as const,
              data: userAccountSnapshotMock(),
              errorCode: 'USER_DEVICE_VERIFICATION_REQUIRED',
              errorMessage: '当前设备需要验证后才能登录'
            }
          }
          loginUserProfileMock({
            username: credential.username,
            name: userProfileStoreMock.name || credential.username,
            authProvider: 'local',
            registrationCode: 9,
            lastLoginMethod: 'account'
          })
          return userSuccessMock('账号登录成功，本地数据库初始化完成')
        }

        if (input.method === 'email') {
          const email = trimUserTextMock(input.email)
          const code = trimUserTextMock(input.code).replace(/\s+/g, '')
          if (!email || !code) return userErrorMock('USER_EMAIL_LOGIN_REQUIRED', '请输入邮箱和验证码')
          if (!isValidUserEmailMock(email)) return userErrorMock('USER_EMAIL_INVALID', '邮箱格式不正确')
          const verificationError = verifyUserCodeMock('login', 'email', email, code)
          if (verificationError) return verificationError
          loginUserProfileMock({
            email,
            username: email.split('@')[0] || userProfileStoreMock.username,
            authProvider: 'local',
            registrationCode: 2,
            lastLoginMethod: 'email'
          })
          clearUserCodeCooldownMock('login', 'email', email)
          return userSuccessMock('邮箱登录成功，本地数据库初始化完成')
        }

        const mobile = trimUserTextMock(input.mobile)
        const code = trimUserTextMock(input.code).replace(/\s+/g, '')
        if (!mobile || !code) return userErrorMock('USER_MOBILE_LOGIN_REQUIRED', '请输入手机号和验证码')
        if (!isValidUserMobileMock(mobile)) return userErrorMock('USER_MOBILE_INVALID', '手机号格式不正确')
        const verificationError = verifyUserCodeMock('login', 'mobile', mobile, code)
        if (verificationError) return verificationError
        loginUserProfileMock({
          mobile,
          authProvider: 'local',
          registrationCode: 7,
          lastLoginMethod: 'mobile'
        })
        clearUserCodeCooldownMock('login', 'mobile', mobile)
        return userSuccessMock('手机号登录成功，本地数据库初始化完成')
      }
    ),
    logoutUserAccount: vi.fn(async () => {
      applyUserProfileMock({
        skippedLogin: true,
        localDatabaseReady: false,
        needDeviceVerification: false
      })
      return userSuccessMock('已退出登录')
    }),
    skipUserLogin: vi.fn(async () => {
      loginUserProfileMock({
        uid: 999999999,
        name: 'Guest',
        username: 'guest',
        email: 'guest@example.local',
        mobile: '',
        authProvider: 'local',
        registrationCode: 9,
        lastLoginMethod: 'skip'
      })
      return userSuccessMock('已跳过登录，使用本地访客状态')
    }),
    sendUserLoginCode: vi.fn(async (input: { kind: 'email' | 'mobile'; value: string }) => {
      const value = trimUserTextMock(input.value)
      if (input.kind === 'email' && !isValidUserEmailMock(value)) return userErrorMock('USER_EMAIL_INVALID', '邮箱格式不正确')
      if (input.kind === 'mobile' && !isValidUserMobileMock(value)) return userErrorMock('USER_MOBILE_INVALID', '手机号格式不正确')
      return issueUserCodeCooldownMock('login', input.kind, value, `${input.kind === 'email' ? '邮箱' : '手机'}登录验证码已发送`)
    }),
    prepareUserAvatarImage: vi.fn(async (input: { filePath: string }) => {
      const filePath = trimUserTextMock(input.filePath)
      if (!filePath) return userErrorMock('USER_AVATAR_PATH_REQUIRED', '请选择头像图片')
      const name = filePath.split(/[/\\]/).pop() || 'avatar.png'
      const assetFileName = `${createHash('sha256').update(filePath).digest('hex')}.png`
      return {
        ok: true as const,
        data: {
          filePath,
          name,
          mimeType: 'image/png',
          size: 6,
          dataUrl: 'data:image/png;base64,avatar',
          avatarImageUrl: `aiopsterm-user-avatar://${assetFileName}`,
          assetFileName,
          message: '头像图片已读取'
        }
      }
    }),
    updateUserProfile: vi.fn(
      async (
        input: Partial<
          Pick<TestUserProfile, 'name' | 'username' | 'email' | 'mobile' | 'avatarInitials' | 'avatarImageUrl' | 'avatarUpdatedAt'>
        >
      ) => {
        const validation = validateUserProfileUpdateMock(input)
        if (validation) return userErrorMock('USER_PROFILE_INVALID', validation)
        const nextAvatarInitials = trimUserTextMock(input.avatarInitials).toUpperCase().slice(0, 3)
        const avatarChanged = input.avatarImageUrl !== undefined || input.avatarInitials !== undefined
        const previousUsername = userProfileStoreMock.username
        const nextUsername = input.username !== undefined ? trimUserTextMock(input.username) : userProfileStoreMock.username
        const nextAvatarImageUrl = input.avatarImageUrl !== undefined ? trimUserTextMock(input.avatarImageUrl) : userProfileStoreMock.avatarImageUrl
        if (input.avatarImageUrl !== undefined && nextAvatarImageUrl && !userAvatarAssetUrlPatternMock.test(nextAvatarImageUrl)) {
          return userErrorMock('USER_AVATAR_ASSET_INVALID', '头像图片必须来自后端头像上传结果')
        }
        if (!userProfileStoreMock.skippedLogin) renameCurrentUserCredentialMock(previousUsername, nextUsername)
        applyUserProfileMock({
          name: input.name !== undefined ? trimUserTextMock(input.name) : userProfileStoreMock.name,
          username: nextUsername,
          avatarInitials: nextAvatarInitials || userProfileStoreMock.avatarInitials,
          avatarImageUrl: nextAvatarImageUrl,
          avatarUpdatedAt: avatarChanged ? userTimestampMock() : userProfileStoreMock.avatarUpdatedAt
        })
        return userSuccessMock(avatarChanged ? '头像更新成功' : '个人信息已保存')
      }
    ),
    resetUserPassword: vi.fn(async (input: { password: string }) => {
      if (!canResetUserPasswordMock()) return userErrorMock('USER_PASSWORD_RESET_FORBIDDEN', 'SSO 用户不能修改密码')
      if (input.password.length < 6) return userErrorMock('USER_PASSWORD_TOO_SHORT', '密码长度不能小于6位')
      if (userPasswordScoreMock(input.password) < 1) return userErrorMock('USER_PASSWORD_WEAK', '请具有弱以上的密码强度')
      const updatedAt = userTimestampMock()
      if (!userProfileStoreMock.skippedLogin && userProfileStoreMock.username) {
        upsertUserCredentialMock(userProfileStoreMock.username, input.password, { updatedAt })
      }
      applyUserProfileMock({ passwordUpdatedAt: updatedAt })
      return userSuccessMock('密码重置成功')
    }),
    sendUserContactCode: vi.fn(async (input: { kind: 'email' | 'mobile'; value: string }) => {
      const value = trimUserTextMock(input.value)
      const validation = validateUserContactMock(input.kind, value)
      if (validation) return userErrorMock(input.kind === 'email' ? 'USER_EMAIL_INVALID' : 'USER_MOBILE_INVALID', validation)
      return issueUserCodeCooldownMock('contact', input.kind, value, `${input.kind === 'email' ? '邮箱' : '手机'}验证码已发送`)
    }),
    bindUserContact: vi.fn(async (input: { kind: 'email' | 'mobile'; value: string; code: string }) => {
      const value = trimUserTextMock(input.value)
      const code = trimUserTextMock(input.code).replace(/\s+/g, '')
      const validation = validateUserContactMock(input.kind, value)
      if (validation) return userErrorMock(input.kind === 'email' ? 'USER_EMAIL_INVALID' : 'USER_MOBILE_INVALID', validation)
      if (!code) return userErrorMock('USER_CONTACT_CODE_REQUIRED', `请输入${input.kind === 'email' ? '邮箱' : '手机'}验证码`)
      const verificationError = verifyUserCodeMock('contact', input.kind, value, code)
      if (verificationError) return verificationError
      applyUserProfileMock({ [input.kind]: value })
      clearUserCodeCooldownMock('contact', input.kind, value)
      return userSuccessMock(input.kind === 'email' ? '邮箱绑定成功' : '手机号绑定成功')
    }),
    deactivateUserAccount: vi.fn(async (input: { uid: number }) => {
      const uid = Number(input?.uid)
      if (!Number.isFinite(uid) || uid <= 0) return userErrorMock('USER_DEACTIVATE_UID_REQUIRED', '无法确定当前用户账号')
      if (userProfileStoreMock.skippedLogin || userProfileStoreMock.lastLoginMethod === 'skip' || !userProfileStoreMock.uid) {
        return userErrorMock('USER_DEACTIVATE_LOGIN_REQUIRED', '请先登录账号')
      }
      if (uid !== userProfileStoreMock.uid) return userErrorMock('USER_DEACTIVATE_UID_MISMATCH', '当前用户账号不匹配')
      deactivateUserAccountStoreMock()
      return userSuccessMock('账号已停用，当前登录状态已清除')
    }),
    revokeTrustedDevice: vi.fn(async (id: number) => {
      const deviceId = Number(id)
      const device = trustedDeviceStoreMock.find((item) => item.id === deviceId)
      if (!device) return userErrorMock('TRUSTED_DEVICE_NOT_FOUND', 'Trusted device not found.')
      if (device.current) return userErrorMock('TRUSTED_DEVICE_CURRENT', 'Current trusted device cannot be revoked.')
      trustedDeviceStoreMock = trustedDeviceStoreMock.filter((item) => item.id !== deviceId)
      return {
        ok: true as const,
        data: {
          deviceId,
          trustedDevices: trustedDeviceStoreMock.map(cloneTrustedDeviceMock),
          message: '可信设备已移除'
        }
      }
    }),
    getProtocolPrefix: vi.fn(async () => 'aiopsterm://'),
    handleProtocolUrl: vi.fn(async (url: string) => ({
      success: url.startsWith('aiopsterm://'),
      payload: url.startsWith('aiopsterm://')
        ? {
            url,
            action: 'open',
            target: 'workspace',
            module: 'workspace',
            acceptedAt: Date.now()
          }
        : undefined
    })),
    consumeDeepLinks: vi.fn(async () => []),
    onDeepLink: vi.fn(() => () => undefined),
    openExternalUrl: vi.fn(async () => undefined),
    openSettingsDocumentation: vi.fn(async (input?: { page?: string; locale?: string }) => ({
      path: input && 'documentPath' in input ? `/tmp/aiopsterm/docs/${(input as { documentPath: string }).documentPath}` : `/tmp/aiopsterm/docs/${input?.locale || 'zh-CN'}/${input?.page || 'index'}.md`,
      title: input && 'documentPath' in input ? 'Usage Docs' : input?.page === 'general' ? (input.locale === 'en-US' ? 'General Settings' : '通用设置') : 'aiopsterm Docs',
      content:
        input && 'documentPath' in input
          ? '# Usage Docs\n'
          : input?.page === 'general'
            ? input.locale === 'en-US'
              ? '# General Settings\n\nTheme controls the app theme.'
              : '# 通用设置\n\n主题控制应用主题。'
            : '# aiopsterm Docs\n\n[Usage Docs](usage/index.md)\n'
    })),
    submitSettingsFeedbackReport: vi.fn(async () => ({ path: '/tmp/aiopsterm/feedback/aiopsterm-feedback.md' })),
    openLogDir: vi.fn(async () => ({ path: '/tmp/aiopsterm/logs' })),
    writeRuntimeLog: vi.fn(async (_level: string, event: string) => ({ ok: true, data: { event } })),
    minimizeWindow: vi.fn(async () => undefined),
    maximizeWindow: vi.fn(async () => undefined),
    unmaximizeWindow: vi.fn(async () => undefined),
    isMaximized: vi.fn(async () => false),
    closeWindow: vi.fn(async () => undefined),
    onMaximized: vi.fn(() => () => undefined),
    onUnmaximized: vi.fn(() => () => undefined),
    getConfig: vi.fn(async () => JSON.parse(JSON.stringify(configStoreMock))),
    saveConfig: vi.fn(async (patch) => {
      configStoreMock = {
        ...configStoreMock,
        ...patch,
        background: { ...configStoreMock.background, ...(patch?.background || {}) },
        terminal: { ...configStoreMock.terminal, ...(patch?.terminal || {}) },
        workspacePreferences: { ...configStoreMock.workspacePreferences, ...(patch?.workspacePreferences || {}) },
        editorSettings: { ...configStoreMock.editorSettings, ...(patch?.editorSettings || {}) },
        aiPreferences: { ...configStoreMock.aiPreferences, ...(patch?.aiPreferences || {}), proxy: { ...configStoreMock.aiPreferences.proxy, ...(patch?.aiPreferences?.proxy || {}) } },
        notifications: { ...configStoreMock.notifications, ...(patch?.notifications || {}) },
        modelSettings: patch?.modelSettings || configStoreMock.modelSettings,
        shortcuts: patch?.shortcuts || configStoreMock.shortcuts,
        rules: patch?.rules || configStoreMock.rules,
        skills: patch?.skills || configStoreMock.skills,
        mcpServers: patch?.mcpServers || configStoreMock.mcpServers,
        mcpToolStates: patch?.mcpToolStates || configStoreMock.mcpToolStates,
        onboarding: patch?.onboarding ? { ...configStoreMock.onboarding, ...patch.onboarding, completedModules: { ...configStoreMock.onboarding.completedModules, ...(patch.onboarding.completedModules || {}) } } : configStoreMock.onboarding
      }
      return JSON.parse(JSON.stringify(configStoreMock))
    }),
    applyPrivacyRuntimeSettings: vi.fn(async (input: { nextPrivacy: typeof defaultPrivacy }) => ({
      ok: true as const,
      data: {
        telemetry: input.nextPrivacy.telemetry,
        dataSync: input.nextPrivacy.dataSync,
        dataSyncRuntime: input.nextPrivacy.dataSync === 'enabled' ? ('local-file' as const) : ('disabled' as const),
        syncStatus: input.nextPrivacy.dataSync === 'enabled' ? ('synced' as const) : ('disabled' as const),
        syncRunId: input.nextPrivacy.dataSync === 'enabled' ? 'sync-test-runtime' : '',
        syncedScopes: input.nextPrivacy.dataSync === 'enabled' ? (['config'] as const) : [],
        stateFilePath: '/tmp/aiopsterm/data-sync-runtime.json',
        lastSyncAt: input.nextPrivacy.dataSync === 'enabled' ? '2026-06-10T00:00:00.000Z' : '',
        appliedAt: '2026-06-10T00:00:00.000Z',
        message: '隐私运行时设置已应用'
      }
    })),
    applyKnowledgeSearchRuntimeSetting: vi.fn(async (input: { nextEnabled: boolean }) => ({
      ok: true as const,
      data: {
        enabled: input.nextEnabled,
        appliedAt: '2026-06-10T00:00:00.000Z',
        source: 'settings' as const,
        message: input.nextEnabled ? '知识库搜索运行时已启用' : '知识库搜索运行时已禁用'
      }
    })),
    getSettingsPreferences: vi.fn(async () => {
      if (!settingsPreferencesStoreMock) {
        settingsPreferencesStoreMock = normalizeSettingsPreferencesMock()
      }
      return { ok: true, data: cloneSettingsPreferencesMock(settingsPreferencesStoreMock) }
    }),
    saveSettingsRule: vi.fn(async (input: { id?: string; content: string; enabled?: boolean }) => {
      if (!settingsPreferencesStoreMock) settingsPreferencesStoreMock = normalizeSettingsPreferencesMock()
      const content = trimMock(input.content)
      if (!content) return { ok: false, errorCode: 'SETTINGS_RULE_REQUIRED', errorMessage: 'Rule content is required.' }
      const incomingId = trimMock(input.id)
      const existing = incomingId ? settingsPreferencesStoreMock.rules.find((rule) => rule.id === incomingId) : undefined
      const id = existing?.id || `rule-test-${settingsRuleSequenceMock++}`
      const saved = {
        id,
        content,
        enabled: input.enabled !== undefined ? Boolean(input.enabled) : existing?.enabled !== undefined ? existing.enabled : true
      }
      settingsPreferencesStoreMock = {
        shortcuts: settingsPreferencesStoreMock.shortcuts.map((shortcut) => ({ ...shortcut })),
        rules: [saved, ...settingsPreferencesStoreMock.rules.filter((rule) => rule.id !== id)]
      }
      return { ok: true, data: { ...cloneSettingsPreferencesMock(settingsPreferencesStoreMock), message: '规则已保存' } }
    }),
    deleteSettingsRule: vi.fn(async (id: string) => {
      if (!settingsPreferencesStoreMock) settingsPreferencesStoreMock = normalizeSettingsPreferencesMock()
      const deleted = settingsPreferencesStoreMock.rules.find((rule) => rule.id === id)
      if (!deleted) return { ok: false, errorCode: 'SETTINGS_RULE_NOT_FOUND', errorMessage: 'Rule not found.' }
      settingsPreferencesStoreMock = {
        shortcuts: settingsPreferencesStoreMock.shortcuts.map((shortcut) => ({ ...shortcut })),
        rules: settingsPreferencesStoreMock.rules.filter((rule) => rule.id !== id)
      }
      return { ok: true, data: { ...cloneSettingsPreferencesMock(settingsPreferencesStoreMock), deleted: { ...deleted } } }
    }),
    saveSettingsShortcut: vi.fn(async (input: { id: string; shortcut: string }) => {
      if (!settingsPreferencesStoreMock) settingsPreferencesStoreMock = normalizeSettingsPreferencesMock()
      const id = trimMock(input.id)
      const shortcut = trimMock(input.shortcut)
      const defaultShortcut = defaultShortcutsByIdMock.get(id)
      if (!defaultShortcut || !shortcut || !isValidShortcutForActionMock(id, shortcut)) {
        return { ok: false, errorCode: 'SETTINGS_SHORTCUT_INVALID', errorMessage: 'Shortcut is invalid.' }
      }
      const duplicate = settingsPreferencesStoreMock.shortcuts.find((item) => item.id !== id && item.shortcut === shortcut)
      if (duplicate) return { ok: false, errorCode: 'SETTINGS_SHORTCUT_DUPLICATE', errorMessage: 'Shortcut already exists.' }
      settingsPreferencesStoreMock = {
        shortcuts: settingsPreferencesStoreMock.shortcuts.map((item) => (item.id === id ? { ...defaultShortcut, shortcut } : { ...item })),
        rules: settingsPreferencesStoreMock.rules.map((rule) => ({ ...rule }))
      }
      return { ok: true, data: { ...cloneSettingsPreferencesMock(settingsPreferencesStoreMock), message: '快捷键已保存' } }
    }),
    resetSettingsShortcuts: vi.fn(async () => {
      if (!settingsPreferencesStoreMock) settingsPreferencesStoreMock = normalizeSettingsPreferencesMock()
      settingsPreferencesStoreMock = {
        shortcuts: defaultShortcuts.map((shortcut) => ({ ...shortcut })),
        rules: settingsPreferencesStoreMock.rules.map((rule) => ({ ...rule }))
      }
      return { ok: true, data: { ...cloneSettingsPreferencesMock(settingsPreferencesStoreMock), message: '快捷键已全部重置' } }
    }),
    getSecurityConfigPath: vi.fn(async () => '/tmp/aiopsterm/security-config.json'),
    readSecurityConfig: vi.fn(async () => defaultSecurityConfigContent),
    writeSecurityConfig: vi.fn(async (content: string) => ({ ok: true, data: { securityConfig: JSON.parse(content) } })),
    onSecurityConfigFileChanged: vi.fn(() => () => undefined),
    getKeywordHighlightConfigPath: vi.fn(async () => '/tmp/aiopsterm/keyword-highlight.json'),
    readKeywordHighlightConfig: vi.fn(async () => defaultKeywordHighlightContent),
    writeKeywordHighlightConfig: vi.fn(async (content: string) => ({ ok: true, data: { keywordHighlight: JSON.parse(content) } })),
    onKeywordHighlightConfigFileChanged: vi.fn(() => () => undefined),
    getMcpConfigPath: vi.fn(async () => '/tmp/aiopsterm/setting/mcp_settings.json'),
    getMcpServers: vi.fn(async () => mcpServersMock.map(cloneMcpServerMock)),
    readMcpConfig: vi.fn(async () => mcpConfigContentMock),
    writeMcpConfig: vi.fn(async (content: string) => {
      return { ok: true, data: applyMcpConfigContentMock(content) }
    }),
    toggleMcpServer: vi.fn(async (serverName: string, disabled: boolean) => {
      const server = mcpServersMock.find((item) => item.name === serverName)
      if (!server) return { ok: false, errorCode: 'MCP_SERVER_TOGGLE_FAILED', errorMessage: `MCP server not found: ${serverName}` }
      server.disabled = disabled
      server.status = disabled ? 'disabled' : server.error ? 'error' : 'connected'
      const parsed = JSON.parse(mcpConfigContentMock) as { mcpServers?: Record<string, { disabled?: boolean }> }
      const serverConfig = parsed.mcpServers?.[serverName]
      if (serverConfig) {
        serverConfig.disabled = disabled
        mcpConfigContentMock = JSON.stringify(parsed, null, 2)
      }
      return { ok: true, data: currentMcpConfigMutationDataMock() }
    }),
    deleteMcpServer: vi.fn(async (serverName: string) => {
      if (!mcpServersMock.some((server) => server.name === serverName)) {
        return { ok: false, errorCode: 'MCP_SERVER_DELETE_FAILED', errorMessage: `MCP server not found: ${serverName}` }
      }
      mcpServersMock = mcpServersMock.filter((server) => server.name !== serverName)
      const parsed = JSON.parse(mcpConfigContentMock) as { mcpServers?: Record<string, unknown> }
      if (parsed.mcpServers) {
        delete parsed.mcpServers[serverName]
        mcpConfigContentMock = JSON.stringify(parsed, null, 2)
      }
      return { ok: true, data: currentMcpConfigMutationDataMock() }
    }),
    setMcpToolState: vi.fn(async (serverName: string, toolName: string, enabled: boolean) => {
      const tool = mcpServersMock.find((server) => server.name === serverName)?.tools.find((item) => item.name === toolName)
      if (!tool) return { ok: false, errorCode: 'MCP_TOOL_STATE_FAILED', errorMessage: `MCP tool not found: ${serverName}:${toolName}` }
      tool.enabled = enabled
      return { ok: true, data: currentMcpConfigMutationDataMock() }
    }),
    setMcpToolAutoApprove: vi.fn(async (serverName: string, toolName: string, autoApprove: boolean) => {
      const tool = mcpServersMock.find((server) => server.name === serverName)?.tools.find((item) => item.name === toolName)
      if (!tool) throw new Error(`MCP tool not found: ${serverName}:${toolName}`)
      const parsed = JSON.parse(mcpConfigContentMock) as { mcpServers?: Record<string, { autoApprove?: unknown }> }
      const serverConfig = parsed.mcpServers?.[serverName]
      if (!serverConfig) throw new Error(`MCP server config not found: ${serverName}`)
      const approved = new Set(Array.isArray(serverConfig.autoApprove) ? serverConfig.autoApprove.filter((item): item is string => typeof item === 'string') : [])
      if (autoApprove) {
        approved.add(toolName)
      } else {
        approved.delete(toolName)
      }
      if (approved.size) {
        serverConfig.autoApprove = [...approved]
      } else {
        delete serverConfig.autoApprove
      }
      return { ok: true, data: applyMcpConfigContentMock(JSON.stringify(parsed, null, 2)) }
    }),
    callMcpTool: vi.fn(callMcpToolMock),
    approveAiMcpToolCall: vi.fn((input: { conversationId: string; messageId: string; autoApprove?: boolean }) => handleAiMcpToolCallActionMock(input, true)),
    rejectAiMcpToolCall: vi.fn((input: { conversationId: string; messageId: string; autoApprove?: boolean }) => handleAiMcpToolCallActionMock(input, false)),
    approveAiMcpResourceAccess: vi.fn((input: { conversationId: string; messageId: string }) => handleAiMcpResourceAccessActionMock(input, true)),
    rejectAiMcpResourceAccess: vi.fn((input: { conversationId: string; messageId: string }) => handleAiMcpResourceAccessActionMock(input, false)),
    readMcpResource: vi.fn(readMcpResourceMock),
    onMcpConfigFileChanged: vi.fn(() => () => undefined),
    getSkills: vi.fn(async () => cloneSkills()),
    getEnabledSkills: vi.fn(async () => cloneSkills().filter((skill) => skill.enabled)),
    setSkillEnabled: vi.fn(async (skillName: string, enabled: boolean) => {
      skillsStoreMock = skillsStoreMock.map((skill) => (skill.name === skillName ? { ...skill, enabled } : skill))
      const skill = skillsStoreMock.find((item) => item.name === skillName)
      if (!skill) throw new Error(`Skill not found: ${skillName}`)
      return {
        skill: { ...skill },
        skills: cloneSkills(),
        enabled: skill.enabled,
        updatedAt: '2026-06-04T12:00:00+08:00'
      }
    }),
    getSkillsUserPath: vi.fn(async () => '/tmp/aiopsterm/skills'),
    reloadSkills: vi.fn(async () => cloneSkills()),
    createSkill: vi.fn(async (metadata, content) => {
      const created = {
        name: metadata.name,
        description: metadata.description,
        enabled: true,
        editable: true,
        content,
        path: `/tmp/aiopsterm/skills/${metadata.name}/SKILL.md`
      }
      skillsStoreMock = [created, ...skillsStoreMock.filter((skill) => skill.name !== metadata.name)]
      return createSkillWriteResultMock(created)
    }),
    deleteSkill: vi.fn(async (skillName: string) => {
      const deleted = skillsStoreMock.find((skill) => skill.name === skillName)
      if (!deleted) throw new Error(`Skill not found: ${skillName}`)
      skillsStoreMock = skillsStoreMock.filter((skill) => skill.name !== skillName)
      return {
        skillName,
        deleted: true,
        deletedPath: deleted.path.replace(/\/SKILL\.md$/, ''),
        remainingSkills: cloneSkills(),
        deletedAt: '2026-06-04T12:00:00+08:00'
      }
    }),
    openSkillsFolder: vi.fn(async () => ({ path: '/tmp/aiopsterm/skills' })),
    importSkillZip: vi.fn(async () => {
      const skill = {
        name: 'imported-skill',
        description: 'Imported skill',
        enabled: true,
        editable: true,
        content: 'Imported content',
        path: '/tmp/aiopsterm/skills/imported-skill/SKILL.md'
      }
      skillsStoreMock = [skill, ...skillsStoreMock.filter((item) => item.name !== skill.name)]
      return createSkillImportResultMock(skill)
    }),
    readSkillContent: vi.fn(async (skillName: string) => {
      const skill = skillsStoreMock.find((item) => item.name === skillName)
      return {
        metadata: {
          name: skillName,
          description: skill?.description || ''
        },
        content: skill?.content || ''
      }
    }),
    updateSkill: vi.fn(async (skillName: string, metadata, content) => {
      skillsStoreMock = skillsStoreMock.map((skill) =>
        skill.name === skillName
          ? {
              ...skill,
              name: metadata.name,
              description: metadata.description,
              content
            }
          : skill
      )
      const skill = skillsStoreMock.find((item) => item.name === skillName)
      if (!skill) throw new Error(`Skill not found: ${skillName}`)
      return createSkillWriteResultMock(skill)
    }),
    exportSkillZip: vi.fn(async (skillName: string) => ({ success: true, skillName, filePath: `/tmp/${skillName}.zip`, bytes: 256, exportedAt: '2026-06-04T12:00:00+08:00' })),
    onSkillsUpdate: vi.fn(() => () => undefined),
    getPathForFile: vi.fn((file: File & { path?: string }) => String(file?.path || '')),
    showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/tmp/imported-note.md'] })),
    showSaveDialog: vi.fn(async (options?: { defaultPath?: string }) => ({ canceled: false, filePath: `/tmp/${options?.defaultPath || 'downloaded-file'}` })),
    exportChat: vi.fn(async (input: AiChatExportInput) => {
      const markdown = buildChatExportMarkdown(input, new Date('2026-06-04T12:00:00+08:00'))
      return {
        ok: true,
        data: {
          exported: input.messages.length,
          fileName: sanitizeChatExportFileName(input.title),
          filePath: '/tmp/ai-chat-export.md',
          bytes: Buffer.byteLength(markdown, 'utf8'),
          markdown
        }
      }
    }),
    exportDatabaseRows: vi.fn(async (input: DatabaseExportInput) => {
      const csv = buildDatabaseExportCsv(input)
      return {
        ok: true,
        data: {
          exported: input.rows.length,
          fileName: sanitizeDatabaseExportFileName(input, new Date('2026-06-04T12:00:00+08:00')),
          filePath: '/tmp/database-export.csv',
          bytes: Buffer.byteLength(csv, 'utf8'),
          csv
        }
      }
    }),
    getDatabasePageComment: vi.fn(async (input: DatabasePageCommentKey) => {
      const existing = databasePageCommentsMock.get(databasePageCommentKeyMock(input))
      return {
        ok: true as const,
        data: {
          record: existing || {
            ...input,
            comment: '',
            updatedAt: 0
          }
        }
      }
    }),
    saveDatabasePageComment: vi.fn(async (input: { key: DatabasePageCommentKey; comment: string }) => {
      const record = {
        ...input.key,
        comment: input.comment,
        updatedAt: Date.now()
      }
      databasePageCommentsMock.set(databasePageCommentKeyMock(input.key), record)
      return {
        ok: true as const,
        data: {
          record,
          message: input.comment.trim() ? 'Comment saved' : 'Comment cleared'
        }
      }
    }),
    saveCustomBackground: vi.fn(async (srcAbsPath: string) => {
      const name = srcAbsPath.split(/[/\\]/).pop() || 'custom-bg.png'
      return {
        filePath: `/tmp/aiopsterm/backgrounds/${name}`,
        url: `aiopsterm-background://local/${encodeURIComponent(name)}`,
        name,
        size: 128,
        bytes: 128,
        mtimeMs: 1717200000000
      }
    }),
    readLocalFile: vi.fn(async (filePath: string) => {
      const localPath = String(filePath || '')
      const content = localFileContentMock(localPath)
      return {
        content,
        mtimeMs: 1717200000000,
        size: content.length
      }
    }),
    writeLocalFile: vi.fn(async (filePath: string, content: string) => ({
      ok: true,
      data: {
        filePath,
        bytes: new TextEncoder().encode(String(content ?? '')).byteLength,
        size: new TextEncoder().encode(String(content ?? '')).byteLength,
        mtimeMs: 1717200000000
      }
    })),
    readFileContent: vi.fn(async (filePath: string) => ({
      ok: true,
      data: {
        content: filePath.endsWith('release-note.md') ? '# Staging release\n\nLoaded through backend file content boundary.\n' : `backend content for ${filePath}\n`,
        action: 'edit' as const,
        size: filePath.length + 64,
        mtimeMs: 1717200000000
      }
    })),
    writeFileContent: vi.fn(async (filePath: string, content: string, options?: any) => ({
      ok: true,
      data: {
        size: content.length,
        mtimeMs: 1717200001000,
        task: createFileTransferTaskMock({
          type: 'r2r',
          name: `save ${basenameFileMock(filePath)}`,
          source: filePath,
          target: filePath,
          progress: 100,
          speed: '已保存',
          status: 'success',
          ...fileTransferTaskHostsMock(options)
        })
      }
    })),
    stageChatAttachment: vi.fn(async ({ taskId, srcAbsPath }: { taskId: string; srcAbsPath: string }) => {
      const name = srcAbsPath.split(/[/\\]/).pop() || 'attachment.txt'
      return {
        mode: 'local' as const,
        taskId,
        srcAbsPath,
        refPath: `aiopsterm://chat-attachment/${encodeURIComponent(taskId)}/${encodeURIComponent(name)}`,
        name,
        size: 128,
        stagedPath: `/tmp/aiopsterm/chat-attachments/${taskId}/${name}`
      }
    }),
    validateChatImageAttachment: vi.fn(async (input: Parameters<typeof validateChatImageAttachment>[0]) => validateChatImageAttachment(input)),
    prepareChatImageAttachment: vi.fn(async (input: Parameters<typeof prepareChatImageAttachment>[0]) => prepareChatImageAttachment(input)),
    prepareChatImageAttachmentFromFile: vi.fn(async (input: { filePath: string; name?: string }) => {
      const filePath = String(input.filePath || '').trim()
      if (!filePath) {
        return {
          ok: false as const,
          errorCode: 'CHAT_IMAGE_FILE_PATH_REQUIRED',
          errorMessage: '请选择图片文件。'
        }
      }
      if (filePath.endsWith('.txt')) {
        return {
          ok: false as const,
          errorCode: 'CHAT_IMAGE_UNSUPPORTED_TYPE',
          errorMessage: '不支持的图片类型：note.txt'
        }
      }
      const name = input.name || filePath.split(/[/\\]/).pop() || 'image.png'
      return prepareChatImageAttachment({
        mediaType: name.endsWith('.webp') ? 'image/webp' : name.endsWith('.gif') ? 'image/gif' : name.endsWith('.jpg') || name.endsWith('.jpeg') ? 'image/jpeg' : 'image/png',
        data: Buffer.from(filePath).toString('base64'),
        name,
        size: filePath.length
      })
    }),
    prepareChatImageAttachmentFromClipboard: vi.fn(async (input?: { name?: string }) =>
      prepareChatImageAttachment({
        mediaType: 'image/png',
        data: Buffer.from('clipboard-image').toString('base64'),
        name: input?.name || 'clipboard.png',
        size: 15
      })
    ),
    kbCheckPath: vi.fn(async (absPath: string) => ({ exists: true, isDirectory: absPath.endsWith('/folder'), isFile: !absPath.endsWith('/folder') })),
    kbEnsureRoot: vi.fn(async () => ({ success: true })),
    kbGetRoot: vi.fn(async () => ({ root: '/tmp/aiopsterm/knowledgebase' })),
    kbListDir: vi.fn(async (relDir: string) => listKnowledgeDirMock(relDir)),
    kbReadFile: vi.fn(async (relPath: string, encoding?: 'utf-8' | 'base64') => {
      const isDefaultImage = relPath === 'images/interface.png'
      return {
        content: encoding === 'base64' ? (isDefaultImage ? DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_BASE64 : Buffer.from(relPath).toString('base64')) : `content:${relPath}`,
        mtimeMs: 1717200000000,
        ...(encoding === 'base64' ? { mimeType: isDefaultImage ? DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_MIME : 'application/octet-stream', isImage: relPath.endsWith('.png') } : {})
      }
    }),
    kbWriteFile: vi.fn(async (relPath: string, content: string, encoding?: 'utf-8' | 'base64') => {
      const bytes = encoding === 'base64' ? Buffer.from(String(content || ''), 'base64').byteLength : new TextEncoder().encode(String(content ?? '')).byteLength
      return { relPath, type: 'file' as const, size: bytes, bytes, mtimeMs: 1717200000000 }
    }),
    kbPasteImageFromClipboard: vi.fn(async (relDir?: string, name?: string) => {
      const fileName = name || 'pasted-image-2026-06-09T12-34-56.png'
      const node = createKnowledgeNodeMock('file', relDir || '', fileName)
      return {
        relPath: node.relPath,
        fileName,
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,cGFzdGVkLWltYWdl',
        size: 12,
        mtimeMs: 1717200000000
      }
    }),
    kbMkdir: vi.fn(async (relDir: string, name: string) => {
      const node = createKnowledgeNodeMock('dir', relDir, name)
      return { relPath: node.relPath, type: 'dir' as const, mtimeMs: 1717200000000 }
    }),
    kbCreateFile: vi.fn(async (relDir: string, name: string, content = '') => {
      const node = createKnowledgeNodeMock('file', relDir, name)
      const size = new TextEncoder().encode(String(content ?? '')).byteLength
      return { relPath: node.relPath, type: 'file' as const, size, mtimeMs: 1717200000000 }
    }),
    kbRename: vi.fn(async (relPath: string, newName: string) => {
      const node = findKnowledgeNodeMock(relPath)
      if (!node) throw new Error(`Missing node: ${relPath}`)
      const nextRelPath = createKnowledgeRelPath(getKnowledgeParent(relPath), newName)
      updateKnowledgeNodePathsMock(node, relPath, nextRelPath)
      return { relPath: nextRelPath, type: node.type, size: node.type === 'file' ? node.size || 0 : undefined, mtimeMs: 1717200000000 }
    }),
    kbDelete: vi.fn(async (relPath: string) => {
      const node = removeKnowledgeNodeMock(relPath)
      if (!node) throw new Error(`Missing node: ${relPath}`)
      return { success: true, relPath, type: node.type, deleted: true as const }
    }),
    kbMove: vi.fn(async (srcRelPath: string, dstRelDir: string) => {
      const node = removeKnowledgeNodeMock(srcRelPath)
      if (!node) throw new Error(`Missing node: ${srcRelPath}`)
      updateKnowledgeNodePathsMock(node, srcRelPath, createKnowledgeRelPath(dstRelDir, node.title))
      insertKnowledgeNodeMock(dstRelDir, node)
      return { relPath: node.relPath, type: node.type, size: node.type === 'file' ? node.size || 0 : undefined, mtimeMs: 1717200000000 }
    }),
    kbCopy: vi.fn(async (srcRelPath: string, dstRelDir: string) => {
      const node = findKnowledgeNodeMock(srcRelPath)
      if (!node) throw new Error(`Missing node: ${srcRelPath}`)
      const cloned = cloneKnowledgeNodeWithPaths(node, dstRelDir)
      insertKnowledgeNodeMock(dstRelDir, cloned)
      return { relPath: cloned.relPath, type: cloned.type, size: cloned.type === 'file' ? cloned.size || 0 : undefined, mtimeMs: 1717200000000 }
    }),
    kbImportFile: vi.fn(async (srcAbsPath: string, dstRelDir: string) => {
      const name = getKnowledgeName(srcAbsPath)
      const node = createKnowledgeNodeMock('file', dstRelDir, name)
      return { jobId: 'kb-import-file', relPath: node.relPath, type: 'file' as const, size: node.size || 0, mtimeMs: 1717200000000 }
    }),
    kbImportFolder: vi.fn(async (srcAbsPath: string, dstRelDir: string) => {
      const name = getKnowledgeName(srcAbsPath)
      const node = createKnowledgeNodeMock('dir', dstRelDir, name)
      return { jobId: 'kb-import-folder', relPath: node.relPath, type: 'dir' as const, mtimeMs: 1717200000000 }
    }),
    kbSearch: vi.fn(async (query: string) =>
      query.trim()
        ? [
            {
              path: 'commands/diagnose.md',
              startLine: 2,
              endLine: 8,
              score: 1.2,
              snippet: 'Generate a read-only diagnosis plan from the current terminal, asset, and knowledge context.',
              matchCount: 2
            }
          ]
        : []
    ),
    kbSearchStatus: vi.fn(async () => ({ totalFiles: 3, totalChunks: 3, provider: 'aiopsterm-local', model: 'lexical', updatedAt: 1717200000000 })),
    kbReindex: vi.fn(async () => ({ files: 3, chunks: 3 })),
    onKbTransferProgress: vi.fn(() => () => undefined),
    listAssets: vi.fn(async () => assetSnapshotMock()),
    listAssetGroups: vi.fn(async (input?: { assetTypes?: TestAssetRecord['asset_type'][] }) => listAssetGroupsMock(input)),
    renameAssetGroup: vi.fn(async (input: { oldName: string; newName: string; assetTypes?: TestAssetRecord['asset_type'][] }) => {
      const oldName = String(input.oldName || '').trim()
      const newName = String(input.newName || '').trim()
      if (!oldName || !newName) return { ok: false, errorCode: 'ASSET_BACKEND_ERROR', errorMessage: 'Asset group name is required' }
      let updated = 0
      assetStoreMock = assetStoreMock.map((asset) => {
        if (asset.isLocalShell || (input.assetTypes?.length && !input.assetTypes.includes(asset.asset_type)) || (asset.group || asset.group_name) !== oldName) return asset
        updated += 1
        return { ...asset, group: newName, group_name: newName }
      })
      if (!updated) return { ok: false, errorCode: 'ASSET_BACKEND_ERROR', errorMessage: `Asset group not found: ${oldName}` }
      return { ok: true, data: { assets: assetStoreMock.map(cloneAsset), folders: assetFolderStoreMock.map(cloneAssetFolder) } }
    }),
    deleteAssetGroup: vi.fn(async (input: { name: string; fallbackName?: string; assetTypes?: TestAssetRecord['asset_type'][] }) => {
      const name = String(input.name || '').trim()
      const fallbackName = String(input.fallbackName || '未分组').trim() || '未分组'
      if (!name) return { ok: false, errorCode: 'ASSET_BACKEND_ERROR', errorMessage: 'Asset group name is required' }
      let updated = 0
      assetStoreMock = assetStoreMock.map((asset) => {
        if (asset.isLocalShell || (input.assetTypes?.length && !input.assetTypes.includes(asset.asset_type)) || (asset.group || asset.group_name) !== name) return asset
        updated += 1
        return { ...asset, group: fallbackName, group_name: fallbackName }
      })
      if (!updated) return { ok: false, errorCode: 'ASSET_BACKEND_ERROR', errorMessage: `Asset group not found: ${name}` }
      return { ok: true, data: { assets: assetStoreMock.map(cloneAsset), folders: assetFolderStoreMock.map(cloneAssetFolder) } }
    }),
    saveAsset: vi.fn(async (input: TestAssetInput) => {
      if (input.id === LOCAL_SHELL_ASSET_ID) {
        return { ok: false, errorCode: 'ASSET_BACKEND_ERROR', errorMessage: '本地连接是系统资产，不能编辑或删除' }
      }
      const index = assetStoreMock.findIndex((asset) => asset.id === input.id)
      const asset = normalizeAssetInputMock(input, index >= 0 ? assetStoreMock[index] : undefined)
      syncAssetSecretMock(asset, input)
      assetStoreMock = index >= 0 ? assetStoreMock.map((item) => (item.id === asset.id ? asset : item)) : [...assetStoreMock, asset]
      return { ok: true, data: cloneAsset(asset) }
    }),
    getAssetEditableSecret: vi.fn(async (id: string) => {
      const assetId = String(id || '').trim()
      const asset = assetStoreMock.find((item) => item.id === assetId)
      if (!asset || asset.isLocalShell) {
        return { ok: false, errorCode: 'ASSET_BACKEND_ERROR', errorMessage: '资产不存在或不可编辑' }
      }
      const secret = assetSecretStoreMock[assetId] || {}
      return {
        ok: true,
        data: {
          assetId,
          ...(secret.password ? { password: secret.password } : {})
        }
      }
    }),
    testAssetConnection: vi.fn(async (input: { assetId?: string; asset?: TestAssetInput }) => {
      const existing = input.assetId ? assetStoreMock.find((asset) => asset.id === input.assetId) : undefined
      if (existing?.isLocalShell) {
        return { ok: false, errorCode: 'ASSET_SSH_UNSUPPORTED_TARGET', errorMessage: '本地连接不支持 SSH 连通性测试' }
      }
      const asset = normalizeAssetInputMock(input.asset || existing || ({ name: '', host: '' } as TestAssetInput), existing)
      if (!asset.host || !asset.username || !Number.isInteger(Number(asset.port)) || Number(asset.port) < 1 || Number(asset.port) > 65535) {
        return { ok: false, errorCode: 'ASSET_SSH_TARGET_REQUIRED', errorMessage: 'SSH 测试需要地址、用户名和 1-65535 的端口' }
      }
      return {
        ok: true,
        data: {
          assetId: existing?.id || input.assetId,
          endpoint: `${asset.username}@${asset.host}:${asset.port}`,
          host: asset.host,
          port: asset.port,
          username: asset.username,
          authType: asset.auth_type,
          authSource: asset.auth_type === 'password' ? 'password' : 'keychain',
          durationMs: 12,
          ...(asset.needProxy && asset.proxyName ? { proxyName: asset.proxyName } : {})
        }
      }
    }),
    deleteAsset: vi.fn(async (id: string) => {
      if (id === LOCAL_SHELL_ASSET_ID) {
        return { ok: false, errorCode: 'ASSET_BACKEND_ERROR', errorMessage: '本地连接是系统资产，不能编辑或删除' }
      }
      assetStoreMock = assetStoreMock.filter((asset) => asset.id !== id)
      delete assetSecretStoreMock[id]
      return { ok: true, data: { id } }
    }),
    refreshOrganizationAssets: vi.fn(async (input?: { organizationId?: string }) => refreshOrganizationAssetsMock(input)),
    previewAssetImport: vi.fn(async (input: { filePath: string }) => {
      try {
        const { filePath, fileName, drafts } = readAssetImportDraftsMock(input)
        const assets = drafts.map(assetImportPreviewRecordMock)
        return {
          ok: true,
          data: {
            filePath,
            fileName,
            assets,
            duplicateCount: assets.filter((asset) => asset.duplicateId).length
          }
        }
      } catch (error) {
        return {
          ok: false,
          errorCode: 'ASSET_IMPORT_FAILED',
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      }
    }),
    confirmAssetImport: vi.fn(async (input: { filePath: string; overwrite?: boolean }) => {
      try {
        const { filePath, fileName, drafts } = readAssetImportDraftsMock(input)
        let imported = 0
        let skipped = 0
        let created = 0
        let updated = 0

        drafts.forEach((draft) => {
          const existing = findAssetImportDuplicateMock(draft)
          if (existing && !input.overwrite) {
            skipped += 1
            return
          }
          const importDraftInput = assetImportInputMock(draft, existing)
          const asset = normalizeAssetInputMock(importDraftInput, existing)
          syncAssetSecretMock(asset, importDraftInput)
          assetStoreMock = existing ? assetStoreMock.map((item) => (item.id === asset.id ? asset : item)) : [...assetStoreMock, asset]
          imported += 1
          if (existing) updated += 1
          else created += 1
        })

        return {
          ok: true,
          data: {
            ...assetSnapshotMock(),
            imported,
            skipped,
            created,
            updated,
            filePath,
            fileName
          }
        }
      } catch (error) {
        return {
          ok: false,
          errorCode: 'ASSET_IMPORT_FAILED',
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      }
    }),
    exportAssets: vi.fn(async (input: { assetIds: string[] }) => {
      const selectedIds = new Set((Array.isArray(input.assetIds) ? input.assetIds : []).map((id) => String(id || '').trim()).filter(Boolean))
      const exportable = assetStoreMock.filter(
        (asset) => selectedIds.has(asset.id) && !asset.isLocalShell && asset.asset_type !== 'organization' && asset.host && asset.username
      )
      if (!exportable.length) {
        return {
          ok: false,
          errorCode: 'ASSET_EXPORT_EMPTY',
          errorMessage: '没有可导出的主机。'
        }
      }
      return {
        ok: true,
        data: {
          exported: exportable.length,
          fileName: 'external-reference-assets-2024-06-01.json',
          filePath: '/tmp/assets-export.json',
          bytes: Buffer.byteLength(JSON.stringify(
            exportable.map((asset) => ({
              username: asset.username,
              password: '',
              ip: asset.host || asset.ip,
              label: asset.title || asset.name || asset.host,
              group_name: asset.group_name || asset.group || '',
              auth_type: asset.auth_type || 'password',
              ...(asset.keychainId ? { keyChain: asset.keychainId } : {}),
              port: asset.port || 22,
              asset_type: asset.asset_type || 'person',
              needProxy: Boolean(asset.needProxy),
              proxyName: asset.proxyName || '',
              ...(asset.comment ? { comment: asset.comment } : {})
            })),
            null,
            2
          ), 'utf8')
        }
      }
    }),
    startSshTunnel: vi.fn(
      async (input: { assetId: string; type?: TestSshTunnelType; localPort?: number; remoteHost?: string; remotePort?: number; tunnelId?: string }) => {
        try {
          const asset = findTunnelAssetMock(input.assetId)
          if (!asset) return { ok: false, errorCode: 'SSH_TUNNEL_ASSET_NOT_FOUND', errorMessage: '隧道主机不存在' }
          const type = normalizeSshTunnelTypeMock(input.type)
          const tunnel: TestSshTunnelRecord = {
            assetId: asset.id,
            tunnelId: String(input.tunnelId || `tunnel-${asset.id}`),
            type,
            state: 'active',
            ...(Number.isFinite(input.localPort) ? { localPort: Number(input.localPort) } : {}),
            ...(type === 'dynamic_socks'
              ? {}
              : {
                  remoteHost: String(input.remoteHost || asset.host || asset.ip).trim(),
                  remotePort: Number.isFinite(input.remotePort) ? Number(input.remotePort) : asset.port
                }),
            startedAt: new Date(1717200000000).toISOString()
          }
          sshTunnelStoreMock.set(tunnel.tunnelId, tunnel)
          setAssetTunnelStateMock(asset.id, 'active')
          return tunnelResultMock(tunnel, `隧道已连接 ${asset.name}`)
        } catch (error) {
          return {
            ok: false,
            errorCode: 'SSH_TUNNEL_START_FAILED',
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        }
      }
    ),
    stopSshTunnel: vi.fn(async (input: { assetId?: string; tunnelId?: string }) => {
      try {
        const assetId = String(input.assetId || '').trim()
        const tunnelId = String(input.tunnelId || `tunnel-${assetId}`)
        const activeTunnel = sshTunnelStoreMock.get(tunnelId)
        const asset = findTunnelAssetMock(assetId || activeTunnel?.assetId)
        if (!asset) return { ok: false, errorCode: 'SSH_TUNNEL_ASSET_NOT_FOUND', errorMessage: '隧道主机不存在' }
        const tunnel: TestSshTunnelRecord = {
          ...(activeTunnel || { assetId: asset.id, tunnelId, type: 'local_forward' as const }),
          assetId: asset.id,
          tunnelId,
          state: 'created',
          stoppedAt: new Date(1717200001000).toISOString()
        }
        sshTunnelStoreMock.delete(tunnelId)
        setAssetTunnelStateMock(asset.id, 'created')
        return tunnelResultMock(tunnel, `隧道已停止 ${asset.name}`)
      } catch (error) {
        return {
          ok: false,
          errorCode: 'SSH_TUNNEL_STOP_FAILED',
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      }
    }),
    saveAssetFolder: vi.fn(async (folder: TestAssetFolderSaveInput) => {
      const name = String(folder.name || '').trim()
      if (!name) return { ok: false, errorCode: 'ASSET_FOLDER_NAME_REQUIRED', errorMessage: 'Folder name is required.' }
      const existing = folder.uuid ? assetFolderStoreMock.find((item) => item.uuid === folder.uuid) : undefined
      const normalized: TestAssetFolder = normalizeAssetFolderInputMock({ ...folder, name }, existing)
      if (!existing && !folder.uuid) normalized.uuid = `folder-test-${assetFolderSequenceMock++}`
      const parentError = validateAssetFolderParentMock(normalized)
      if (parentError) return { ok: false, errorCode: 'ASSET_FOLDER_PARENT_INVALID', errorMessage: parentError }
      assetFolderStoreMock = assetFolderStoreMock.some((item) => item.uuid === normalized.uuid)
        ? assetFolderStoreMock.map((item) => (item.uuid === normalized.uuid ? normalized : item))
        : [...assetFolderStoreMock, normalized]
      return { ok: true, data: cloneAssetFolder(normalized) }
    }),
    deleteAssetFolder: vi.fn(async (uuid: string) => {
      assetFolderStoreMock = assetFolderStoreMock.filter((folder) => folder.uuid !== uuid)
      assetStoreMock = assetStoreMock.map((asset) => (asset.folderUuid === uuid ? { ...asset, folderUuid: undefined } : asset))
      return { ok: true, data: { uuid } }
    }),
    listKeychains: vi.fn(async () => keychainStoreMock.map(sanitizeKeychain)),
    listSshAgentKeychainOptions: vi.fn(async () =>
      keychainStoreMock.filter((keychain) => keychain.hasPrivateKey || keychain.privateKey).map(keychainToSshAgentOptionMock)
    ),
    getKeychain: vi.fn(async (id: string) => keychainStoreMock.find((keychain) => keychain.id === id) || null),
    saveKeychain: vi.fn(async (input: TestKeychainInput) => {
      const index = keychainStoreMock.findIndex((keychain) => keychain.id === input.id)
      const keychain = normalizeKeychainInputMock(input, index >= 0 ? keychainStoreMock[index] : undefined)
      const duplicate = keychainStoreMock.find((item) => item.name === keychain.name && item.id !== keychain.id)
      if (duplicate) return { ok: false, errorCode: 'KEYCHAIN_DUPLICATE', errorMessage: `Keychain already exists: ${keychain.name}` }
      keychainStoreMock = index >= 0 ? keychainStoreMock.map((item) => (item.id === keychain.id ? keychain : item)) : [...keychainStoreMock, keychain]
      return { ok: true, data: sanitizeKeychain(keychain) }
    }),
    deleteKeychain: vi.fn(async (id: string) => {
      keychainStoreMock = keychainStoreMock.filter((keychain) => keychain.id !== id)
      assetStoreMock = assetStoreMock.map((asset) => (asset.keychainId === id ? { ...asset, keychainId: undefined, hasPrivateKey: false } : asset))
      return { ok: true, data: { id } }
    }),
    getQuickCommands: vi.fn(async () => ({
      groups: quickCommandStoreMock.groups.map((group) => ({ ...group })),
      snippets: quickCommandStoreMock.snippets.map((snippet) => ({ ...snippet }))
    })),
    saveQuickCommandGroup: vi.fn(async (input: { uuid?: string; group_name: string }) => {
      const groupName = String(input.group_name || '').trim()
      if (!groupName) return { ok: false, errorCode: 'QUICK_COMMAND_GROUP_REQUIRED', errorMessage: 'Group name is required' }
      const existing = input.uuid ? quickCommandStoreMock.groups.find((group) => group.uuid === input.uuid) : undefined
      if (input.uuid && !existing) return { ok: false, errorCode: 'QUICK_COMMAND_BACKEND_ERROR', errorMessage: 'Quick command group not found' }
      const group = existing
        ? { ...existing, group_name: groupName }
        : { id: nextQuickCommandGroupIdMock(), uuid: `quick-group-test-${quickCommandGroupSequenceMock++}`, group_name: groupName }
      quickCommandStoreMock = {
        groups: existing ? quickCommandStoreMock.groups.map((item) => (item.uuid === group.uuid ? group : item)) : [...quickCommandStoreMock.groups, group],
        snippets: quickCommandStoreMock.snippets.map((snippet) => ({ ...snippet }))
      }
      const snapshot = cloneQuickCommandSnapshot(quickCommandStoreMock)
      return { ok: true, data: { ...snapshot, group: snapshot.groups.find((item) => item.uuid === group.uuid)! } }
    }),
    deleteQuickCommandGroup: vi.fn(async (uuid: string) => {
      if (!quickCommandStoreMock.groups.some((group) => group.uuid === uuid)) {
        return { ok: false, errorCode: 'QUICK_COMMAND_BACKEND_ERROR', errorMessage: 'Quick command group not found' }
      }
      quickCommandStoreMock = {
        groups: quickCommandStoreMock.groups.filter((group) => group.uuid !== uuid),
        snippets: quickCommandStoreMock.snippets.map((snippet) =>
          snippet.group_uuid === uuid ? { ...snippet, group_uuid: null, update_at: '刚刚' } : { ...snippet }
        )
      }
      const snapshot = cloneQuickCommandSnapshot(quickCommandStoreMock)
      return { ok: true, data: { ...snapshot, groupUuid: uuid } }
    }),
    saveQuickCommandSnippet: vi.fn(
      async (input: { id?: number; uuid?: string; snippet_name: string; snippet_content: string; group_uuid?: string | null }) => {
        const snippetName = String(input.snippet_name || '').trim()
        if (!snippetName) return { ok: false, errorCode: 'QUICK_COMMAND_SNIPPET_REQUIRED', errorMessage: 'Snippet name is required' }
        if (!input.snippet_content) return { ok: false, errorCode: 'QUICK_COMMAND_SNIPPET_REQUIRED', errorMessage: 'Snippet content is required' }
        const existing = input.id ? quickCommandStoreMock.snippets.find((snippet) => snippet.id === input.id) : undefined
        if (input.id && !existing) return { ok: false, errorCode: 'QUICK_COMMAND_BACKEND_ERROR', errorMessage: 'Quick command snippet not found' }
        if (input.group_uuid && !quickCommandStoreMock.groups.some((group) => group.uuid === input.group_uuid)) {
          return { ok: false, errorCode: 'QUICK_COMMAND_BACKEND_ERROR', errorMessage: 'Quick command group not found' }
        }
        const groupUuid = input.group_uuid || null
        const snippet = existing
          ? {
              ...existing,
              snippet_name: snippetName,
              snippet_content: input.snippet_content,
              group_uuid: groupUuid,
              update_at: '刚刚'
            }
          : {
              id: nextQuickCommandSnippetIdMock(),
              uuid: input.uuid || `quick-snippet-test-${quickCommandSnippetSequenceMock++}`,
              snippet_name: snippetName,
              snippet_content: input.snippet_content,
              group_uuid: groupUuid,
              create_at: '刚刚',
              update_at: '刚刚'
            }
        quickCommandStoreMock = {
          groups: quickCommandStoreMock.groups.map((group) => ({ ...group })),
          snippets: existing
            ? quickCommandStoreMock.snippets.map((item) => (item.id === snippet.id ? snippet : item))
            : [...quickCommandStoreMock.snippets, snippet]
        }
        const snapshot = cloneQuickCommandSnapshot(quickCommandStoreMock)
        return { ok: true, data: { ...snapshot, snippet: snapshot.snippets.find((item) => item.id === snippet.id)! } }
      }
    ),
    saveQuickCommandMacro: vi.fn(
      async (input: {
        snippet_name?: string
        group_uuid?: string | null
        entries: Array<{ command: string; timestamp: number }>
        sleepThresholdMs?: number
      }) => {
        try {
          const snippetContent = buildQuickCommandMacroContentMock(input)
          const snippetName = String(input.snippet_name || '').trim() || `macro-test-${quickCommandSnippetSequenceMock++}`
          if (input.group_uuid && !quickCommandStoreMock.groups.some((group) => group.uuid === input.group_uuid)) {
            return { ok: false, errorCode: 'QUICK_COMMAND_BACKEND_ERROR', errorMessage: 'Quick command group not found' }
          }
          const groupUuid = input.group_uuid || null
          const snippet = {
            id: nextQuickCommandSnippetIdMock(),
            uuid: `quick-snippet-test-${quickCommandSnippetSequenceMock++}`,
            snippet_name: snippetName,
            snippet_content: snippetContent,
            group_uuid: groupUuid,
            create_at: '刚刚',
            update_at: '刚刚'
          }
          quickCommandStoreMock = {
            groups: quickCommandStoreMock.groups.map((group) => ({ ...group })),
            snippets: [...quickCommandStoreMock.snippets, snippet]
          }
          const snapshot = cloneQuickCommandSnapshot(quickCommandStoreMock)
          return { ok: true, data: { ...snapshot, snippet: snapshot.snippets.find((item) => item.id === snippet.id)! } }
        } catch (error) {
          return {
            ok: false,
            errorCode: 'QUICK_COMMAND_BACKEND_ERROR',
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        }
      }
    ),
    deleteQuickCommandSnippet: vi.fn(async (id: number) => {
      if (!quickCommandStoreMock.snippets.some((snippet) => snippet.id === id)) {
        return { ok: false, errorCode: 'QUICK_COMMAND_BACKEND_ERROR', errorMessage: 'Quick command snippet not found' }
      }
      quickCommandStoreMock = {
        groups: quickCommandStoreMock.groups.map((group) => ({ ...group })),
        snippets: quickCommandStoreMock.snippets.filter((snippet) => snippet.id !== id).map((snippet) => ({ ...snippet }))
      }
      const snapshot = cloneQuickCommandSnapshot(quickCommandStoreMock)
      return { ok: true, data: { ...snapshot, id } }
    }),
    reorderQuickCommands: vi.fn(async (input: { orderedIds: number[]; groupUuid?: string | null }) => {
      const orderedIds = (Array.isArray(input.orderedIds) ? input.orderedIds : []).map(Number)
      if (!orderedIds.length) return { ok: false, errorCode: 'QUICK_COMMAND_BACKEND_ERROR', errorMessage: 'Quick command reorder ids are required' }
      if (new Set(orderedIds).size !== orderedIds.length) {
        return { ok: false, errorCode: 'QUICK_COMMAND_BACKEND_ERROR', errorMessage: 'Quick command reorder ids must be unique' }
      }
      const groupUuid = input.groupUuid || null
      const groupSnippets = quickCommandStoreMock.snippets.filter((snippet) => (snippet.group_uuid || null) === groupUuid)
      if (orderedIds.length !== groupSnippets.length) {
        return { ok: false, errorCode: 'QUICK_COMMAND_BACKEND_ERROR', errorMessage: 'Quick command reorder list is stale' }
      }
      const snippetsById = new Map(groupSnippets.map((snippet) => [snippet.id, snippet]))
      const ordered = orderedIds.map((id) => snippetsById.get(id))
      if (ordered.some((snippet) => !snippet)) {
        return { ok: false, errorCode: 'QUICK_COMMAND_BACKEND_ERROR', errorMessage: 'Quick command reorder list is stale' }
      }
      quickCommandStoreMock = {
        groups: quickCommandStoreMock.groups.map((group) => ({ ...group })),
        snippets: [
          ...quickCommandStoreMock.snippets.filter((snippet) => (snippet.group_uuid || null) !== groupUuid),
          ...(ordered as (typeof quickCommandStoreMock.snippets)[number][])
        ].map((snippet) => ({ ...snippet }))
      }
      return { ok: true, data: cloneQuickCommandSnapshot(quickCommandStoreMock) }
    }),
    planQuickCommandScript: vi.fn(async (input: { snippetId?: number; snippetContent?: string; autoExecute?: boolean }) => {
      const autoExecute = input.autoExecute !== false
      if (input.snippetId !== undefined) {
        const snippet = quickCommandStoreMock.snippets.find((item) => item.id === Number(input.snippetId))
        if (!snippet) return { ok: false, errorCode: 'QUICK_COMMAND_BACKEND_ERROR', errorMessage: 'Quick command snippet not found' }
        return {
          ok: true,
          data: planQuickCommandScriptMock(snippet.snippet_content, autoExecute, snippet.snippet_name, {
            source: 'snippet',
            snippetId: snippet.id,
            snippetName: snippet.snippet_name
          })
        }
      }
      if (typeof input.snippetContent !== 'string') {
        return { ok: false, errorCode: 'QUICK_COMMAND_BACKEND_ERROR', errorMessage: 'Quick command script content is required' }
      }
      return { ok: true, data: planQuickCommandScriptMock(input.snippetContent, autoExecute) }
    }),
    listAliasCommands: vi.fn(async (query?: string) => {
      const normalized = String(query || '').trim().toLowerCase()
      const commands = normalized
        ? aliasStoreMock.filter((item) => item.alias.toLowerCase().includes(normalized) || item.command.toLowerCase().includes(normalized))
        : aliasStoreMock
      return { ok: true, data: commands.map((item) => ({ ...item })) }
    }),
    saveAliasCommand: vi.fn(async (input: { id?: string; previousAlias?: string; alias: string; command: string; createdAt?: number }) => {
      const alias = String(input.alias || '').trim()
      const command = String(input.command || '').trim()
      if (!alias || !command) return { ok: false, errorCode: 'ALIAS_REQUIRED', errorMessage: 'Alias and command are required.' }
      const existing = aliasStoreMock.find((item) => (input.id && item.id === input.id) || (input.previousAlias && item.alias === input.previousAlias))
      const id = existing?.id || input.id || `alias-test-${Date.now()}-${aliasStoreMock.length}`
      const duplicate = aliasStoreMock.find((item) => item.alias === alias && item.id !== id)
      if (duplicate) return { ok: false, errorCode: 'ALIAS_DUPLICATE', errorMessage: 'Alias already exists.' }
      const saved = { id, alias, command, createdAt: existing?.createdAt || input.createdAt || Date.now() }
      aliasStoreMock = [...aliasStoreMock.filter((item) => item.id !== id && item.alias !== input.previousAlias), saved].sort(
        (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
      )
      return { ok: true, data: { command: { ...saved }, commands: aliasStoreMock.map((item) => ({ ...item })) } }
    }),
    deleteAliasCommand: vi.fn(async (input: { id?: string; alias?: string }) => {
      const deleted = aliasStoreMock.find((item) => (input.id && item.id === input.id) || (input.alias && item.alias === input.alias))
      if (!deleted) return { ok: false, errorCode: 'ALIAS_NOT_FOUND', errorMessage: 'Alias not found.' }
      aliasStoreMock = aliasStoreMock.filter((item) => item.id !== deleted.id)
      return { ok: true, data: { deleted: { ...deleted }, commands: aliasStoreMock.map((item) => ({ ...item })) } }
    }),
    createTerminal: vi.fn(async (options?: TestTerminalCreateOptions) => {
      const id = `test-session-${options?.assetId || options?.kind || 'local'}`
      const asset = options?.assetId ? assetStoreMock.find((item) => item.id === options.assetId) : undefined
      const host = options?.ssh?.host || asset?.host || '127.0.0.1'
      const port = options?.ssh?.port || asset?.port || 22
      const username = options?.ssh?.username || asset?.username || 'local'
      const shell = options?.kind === 'ssh' ? 'ssh' : '/bin/bash'
      const cwd = options?.kind === 'ssh' ? `/home/${username}` : '/'
      return {
        id,
        shell,
        cwd,
        kind: options?.kind || 'local',
        connection:
          options?.kind === 'ssh'
            ? {
                connectionId: `ssh-${id}`,
                host,
                port,
                username,
                ...(options.assetId ? { assetId: options.assetId } : {}),
                assetName: options.title || asset?.title || asset?.name || host,
                ...(asset?.asset_type ? { assetType: asset.asset_type } : {}),
                ...(asset?.organizationId || asset?.group_name ? { organizationId: asset.organizationId || asset.group_name } : {}),
                ...(asset?.auth_type ? { authType: asset.auth_type } : {}),
                title: options.title || asset?.title || asset?.name || host,
                createdAt: 1717200001000,
                ...(options.ssh?.forkFromConnectionId ? { forkFromConnectionId: options.ssh.forkFromConnectionId } : {})
              }
            : undefined,
        lifecycle: {
          id,
          kind: options?.kind === 'ssh' ? 'ssh' : 'local',
          stage: 'shell-ready',
          shell,
          cwd,
          at: 1717200001000,
          ...(options?.kind === 'ssh'
            ? {
                host,
                port,
                username,
                connectionId: `ssh-${id}`,
                message: `SSH shell ready ${username}@${host}:${port}`
              }
            : { message: `Local shell ready ${shell}` })
        }
      }
    }),
    writeTerminal: vi.fn(async (id: string, data: string) => ({
      ok: true,
      data: {
        id,
        bytes: Buffer.byteLength(String(data || ''), 'utf8')
      }
    })),
    writeTerminalBinary: vi.fn(async (id: string, data: number[] | Uint8Array | ArrayBuffer) => {
      const bytes =
        data instanceof ArrayBuffer
          ? data.byteLength
          : ArrayBuffer.isView(data)
            ? data.byteLength
            : Array.isArray(data)
              ? data.length
              : 0
      return {
        ok: true,
        data: { id, bytes }
      }
    }),
    resizeTerminal: vi.fn(async () => undefined),
    killTerminal: vi.fn(async (id: string) => ({
      ok: true,
      data: { id }
    })),
    createCodexSession: vi.fn(async (options?: { cols?: number; rows?: number; cwd?: string }) => ({
      id: 'test-codex-session',
      binaryPath: '/repo/codex/codex-rs/target/x86_64-unknown-linux-musl/aiopsterm-codex-package/bin/codex',
      cwd: options?.cwd || '/home/test',
      codexHome: '/tmp/aiopsterm-user-data/codex-agent',
      runtimeKind: 'pty' as const,
      lifecycle: {
        id: 'test-codex-session',
        stage: 'ready' as const,
        at: 1717200001000,
        binaryPath: '/repo/codex/codex-rs/target/x86_64-unknown-linux-musl/aiopsterm-codex-package/bin/codex',
        cwd: options?.cwd || '/home/test',
        codexHome: '/tmp/aiopsterm-user-data/codex-agent',
        runtimeKind: 'pty' as const
      }
    })),
    setCodexSessionTarget: vi.fn(async (target?: { sessionId?: string }) => ({
      ok: true,
      data: {
        sessionId: target?.sessionId,
        target,
        registered: Boolean(target?.sessionId)
      }
    })),
    setCodexSessionPendingContext: vi.fn(async (id: string, text?: string) => ({
      ok: true,
      data: {
        id,
        bytes: Buffer.byteLength(String(text || ''), 'utf8'),
        cleared: !String(text || '').trim()
      }
    })),
    writeCodexSession: vi.fn(async (id: string, data: string) => ({
      ok: true,
      data: {
        id,
        bytes: Buffer.byteLength(String(data || ''), 'utf8')
      }
    })),
    resizeCodexSession: vi.fn(async () => undefined),
    killCodexSession: vi.fn(async (id: string) => ({
      ok: true,
      data: { id }
    })),
    respondTerminalKeyboardInteractive: vi.fn((id: string, responses: string[]) => {
      void id
      void responses
    }),
    cancelTerminalKeyboardInteractive: vi.fn((id: string) => {
      void id
    }),
    pickZmodemUploadFiles: vi.fn(async () => ({ ok: true, data: { files: [] as any[], canceled: true } })),
    pickZmodemSavePath: vi.fn(async (name: string) => ({ ok: true, data: { filePath: `/tmp/${name || 'zmodem-download'}` } })),
    openZmodemStream: vi.fn(async (savePath: string) => ({ ok: true, data: { streamId: 'zmodem-stream-test', filePath: savePath } })),
    writeZmodemChunk: vi.fn(async (streamId: string, chunk: number[] | Uint8Array | ArrayBuffer) => {
      const bytes =
        chunk instanceof ArrayBuffer
          ? chunk.byteLength
          : ArrayBuffer.isView(chunk)
            ? chunk.byteLength
            : Array.isArray(chunk)
              ? chunk.length
              : 0
      return { ok: true, data: { streamId, bytes, totalBytes: bytes } }
    }),
    closeZmodemStream: vi.fn(async (streamId: string) => ({ ok: true, data: { streamId, filePath: '/tmp/zmodem-download', bytes: 0 } })),
    getTerminalCommandSuggestions: vi.fn(async (query: string, context?: { mode?: 'base' | 'ai' }) => {
      const trimmed = query.trim()
      const normalized = trimmed.toLowerCase()
      if (!normalized) return []
      if (context?.mode === 'ai') {
        return [{ command: 'top -o %CPU', source: 'ai' as const, explanation: 'Process CPU ranking' }]
      }
      return [
        { command: 'df -h', source: 'base' as const, explanation: 'history on this host' },
        { command: 'systemctl status nginx', source: 'history' as const, explanation: 'history on this host' },
        { command: 'kubectl get', source: 'base' as const, explanation: 'Display one or many resources' },
        { command: 'journalctl -u docker --since "30 minutes ago"', source: 'history' as const, explanation: 'history from local' },
        { command: 'top -o %CPU', source: 'base' as const, explanation: 'Display processes by CPU' }
      ].filter((item) => item.command.toLowerCase().includes(normalized))
    }),
    generateTerminalCommand: vi.fn(async (input: {
      panelId: string
      instruction: string
      modelName?: string
      context: { host: string; username: string; cwd: string; shell: string; connectionType: 'local' | 'ssh' }
    }) => {
      const instruction = input.instruction.trim()
      if (!instruction) return { ok: false, errorCode: 'TERMINAL_COMMAND_EMPTY', errorMessage: 'Command instruction is required' }
      const command = /(disk|磁盘|空间|df)/i.test(instruction) ? 'df -h' : `echo ${JSON.stringify(instruction)}`
      return {
        ok: true,
        data: {
          id: `terminal-command-test-${instruction.length}`,
          panelId: input.panelId,
          instruction,
          command,
          modelName: input.modelName || 'aiopsterm-local-agent',
          context: { ...input.context },
          status: 'done' as const,
          createdAt: 1717200000000,
          provider: 'aiopsterm-local' as const
        }
      }
    }),
    listKubernetesCatalog: vi.fn(async () => k8sCatalogResultMock()),
    switchKubernetesContext: vi.fn(async (contextName: string) => {
      const context = kubernetesCatalogMock.contexts.find((item) => item.name === contextName)
      if (!context) return { ok: false, errorCode: 'K8S_CONTEXT_NOT_FOUND', errorMessage: 'Kubernetes context not found.' }
      kubernetesCatalogMock.contexts = kubernetesCatalogMock.contexts.map((item) => ({ ...item, isActive: item.name === contextName }))
      const cluster = kubernetesCatalogMock.clusters.find((item) => item.context_name === contextName)
      if (cluster) {
        kubernetesCatalogMock.clusters = kubernetesCatalogMock.clusters.map((item) => ({ ...item, is_active: item.id === cluster.id ? 1 : 0 }))
        kubernetesCatalogMock.activeClusterId = cluster.id
        kubernetesCatalogMock.selectedClusterId = cluster.id
      }
      kubernetesCatalogMock.currentContext = contextName
      return k8sCatalogResultMock({ currentContext: contextName })
    }),
    addKubernetesCluster: vi.fn(async (input: {
      name: string
      contextName: string
      serverUrl: string
      defaultNamespace?: string
      kubeconfigPath?: string | null
      kubeconfigContent?: string | null
      sourceType?: 'local' | 'jumpserver'
      bastionUuid?: string | null
    }) => {
      const name = trimMock(input.name)
      const contextName = trimMock(input.contextName)
      const serverUrl = trimMock(input.serverUrl)
      if (!name || !contextName || !serverUrl) return { ok: false, errorCode: 'K8S_CLUSTER_REQUIRED', errorMessage: 'Cluster name, context and server URL are required.' }
      if (name === 'new-cluster' || contextName === 'new/context' || serverUrl === 'https://new.k8s.local:6443') {
        return { ok: false, errorCode: 'K8S_PLACEHOLDER_CLUSTER_REJECTED', errorMessage: 'Replace the placeholder Kubernetes cluster values before saving.' }
      }
      const sourceType = input.sourceType || 'local'
      const authType = sourceType === 'jumpserver' ? 'jumpserver' : 'kubeconfig'
      if (sourceType === 'local' && authType === 'kubeconfig' && !trimMock(input.kubeconfigPath) && !trimMock(input.kubeconfigContent)) {
        return { ok: false, errorCode: 'K8S_KUBECONFIG_REQUIRED', errorMessage: 'Kubeconfig path or content is required before saving a Kubernetes cluster.' }
      }
      const cluster: TestKubernetesCluster = {
        id: `k8s-test-${kubernetesCatalogMock.clusters.length + 1}`,
        name,
        kubeconfig_path: trimMock(input.kubeconfigPath) || null,
        kubeconfig_content: trimMock(input.kubeconfigContent) || null,
        context_name: contextName,
        server_url: serverUrl,
        auth_type: authType,
        is_active: 0,
        connection_status: 'disconnected',
        auto_connect: 0,
        default_namespace: input.defaultNamespace?.trim() || 'default',
        created_at: '刚刚',
        updated_at: '刚刚',
        source_type: sourceType,
        bastion_uuid: input.bastionUuid || null,
        bastion_asset_address: null,
        bastion_asset_name: null,
        bastion_asset_id_last: null
      }
      kubernetesCatalogMock.clusters = [cluster, ...kubernetesCatalogMock.clusters]
      kubernetesCatalogMock.selectedClusterId = cluster.id
      upsertKubernetesContextMock(cluster, false)
      return k8sCatalogResultMock({ cluster: { ...cluster } })
    }),
    updateKubernetesCluster: vi.fn(async (id: string, input: { name?: string; defaultNamespace?: string; autoConnect?: boolean }) => {
      const existing = findKubernetesClusterMock(id)
      if (!existing) return { ok: false, errorCode: 'K8S_CLUSTER_NOT_FOUND', errorMessage: 'Kubernetes cluster not found.' }
      const updated: TestKubernetesCluster = {
        ...existing,
        name: input.name?.trim() || existing.name,
        default_namespace: input.defaultNamespace?.trim() || existing.default_namespace,
        auto_connect: input.autoConnect === undefined ? existing.auto_connect : input.autoConnect ? 1 : 0,
        updated_at: '刚刚'
      }
      kubernetesCatalogMock.clusters = kubernetesCatalogMock.clusters.map((cluster) => (cluster.id === id ? updated : cluster))
      upsertKubernetesContextMock(updated)
      return k8sCatalogResultMock({ cluster: { ...updated } })
    }),
    importKubernetesKubeconfig: vi.fn(async (input: { requestId?: string | null; kubeconfigPath?: string | null; kubeconfigContent?: string | null }) => {
      const kubeconfigPath = trimMock(input.kubeconfigPath)
      const requestId = trimMock(input.requestId)
      const kubeconfigContent =
        input.kubeconfigContent ||
        [
          'apiVersion: v1',
          'kind: Config',
          'current-context: prod/admin',
          'clusters:',
          '- name: prod-cluster',
          '  cluster:',
          '    server: https://prod.k8s.local:6443',
          '- name: staging-cluster',
          '  cluster:',
          '    server: https://staging.k8s.local:6443',
          'contexts:',
          '- name: prod/admin',
          '  context:',
          '    cluster: prod-cluster',
          '    namespace: default',
          '- name: staging/devops',
          '  context:',
          '    cluster: staging-cluster',
          '    namespace: staging'
        ].join('\n')
      if (!kubeconfigPath && !trimMock(kubeconfigContent)) {
        return { ok: false, errorCode: 'K8S_KUBECONFIG_REQUIRED', errorMessage: 'Kubeconfig path or content is required.' }
      }
      const parsed = parseKubernetesContextsFromContentMock(kubeconfigContent)
      if (!parsed.contexts.length) return { ok: false, errorCode: 'K8S_KUBECONFIG_CONTEXTS_EMPTY', errorMessage: 'No kubeconfig contexts were found.' }
      kubernetesCatalogMock.importContexts = parsed.contexts.map((context) => ({ ...context }))
      return {
        ok: true,
        data: {
          requestId,
          contexts: parsed.contexts.map((context) => ({ ...context })),
          kubeconfigPath,
          kubeconfigContent,
          currentContext: parsed.currentContext
        }
      }
    }),
    testKubernetesClusterConnection: vi.fn(async (input: { contextName: string; serverUrl?: string; kubeconfigPath?: string | null; kubeconfigContent?: string | null }) => {
      const contextName = trimMock(input.contextName)
      const requestedServerUrl = trimMock(input.serverUrl)
      if (!contextName) return { ok: false, errorCode: 'K8S_TEST_CONTEXT_REQUIRED', errorMessage: 'Kubernetes context is required.' }
      const context = input.kubeconfigContent
        ? parseKubernetesContextFromContentMock(input.kubeconfigContent, contextName)
        : findKubernetesTestContextMock(contextName)
      const serverUrl = requestedServerUrl || context?.server || ''
      if (!context) return { ok: false, errorCode: 'K8S_TEST_CONTEXT_NOT_FOUND', errorMessage: 'Kubernetes context not found.' }
      if (!serverUrl) return { ok: false, errorCode: 'K8S_TEST_SERVER_REQUIRED', errorMessage: 'Kubernetes server URL is required.' }
      if (context.server && requestedServerUrl && context.server !== requestedServerUrl) {
        return { ok: false, errorCode: 'K8S_TEST_SERVER_MISMATCH', errorMessage: 'Kubernetes server URL does not match the selected context.' }
      }
      return {
        ok: true,
        data: {
          success: true,
          isValid: true,
          contextName,
          serverUrl,
          message: '连接测试成功'
        }
      }
    }),
    deleteKubernetesCluster: vi.fn(async (id: string) => {
      const existing = findKubernetesClusterMock(id)
      if (!existing) return { ok: false, errorCode: 'K8S_CLUSTER_NOT_FOUND', errorMessage: 'Kubernetes cluster not found.' }
      kubernetesCatalogMock.clusters = kubernetesCatalogMock.clusters.filter((cluster) => cluster.id !== id)
      kubernetesCatalogMock.contexts = kubernetesCatalogMock.contexts.filter((context) => context.name !== existing.context_name)
      kubernetesCatalogMock.namespaces = kubernetesCatalogMock.namespaces.filter((namespace) => namespace.clusterId !== id)
      kubernetesCatalogMock.resources = kubernetesCatalogMock.resources.filter((resource) => resource.clusterId !== id)
      if (kubernetesCatalogMock.activeClusterId === id) kubernetesCatalogMock.activeClusterId = kubernetesCatalogMock.clusters.find((cluster) => cluster.is_active === 1)?.id || null
      if (kubernetesCatalogMock.selectedClusterId === id) kubernetesCatalogMock.selectedClusterId = kubernetesCatalogMock.clusters[0]?.id || null
      return k8sCatalogResultMock()
    }),
    connectKubernetesCluster: vi.fn(async (id: string) => {
      const existing = findKubernetesClusterMock(id)
      if (!existing) return { ok: false, errorCode: 'K8S_CLUSTER_NOT_FOUND', errorMessage: 'Kubernetes cluster not found.' }
      kubernetesCatalogMock.clusters = kubernetesCatalogMock.clusters.map((cluster) => ({
        ...cluster,
        is_active: cluster.id === id ? 1 : 0,
        connection_status: cluster.id === id ? 'connected' : cluster.connection_status === 'connected' ? 'disconnected' : cluster.connection_status,
        updated_at: cluster.id === id ? '刚刚' : cluster.updated_at
      }))
      kubernetesCatalogMock.contexts = kubernetesCatalogMock.contexts.map((context) => ({ ...context, isActive: context.name === existing.context_name }))
      kubernetesCatalogMock.currentContext = existing.context_name
      kubernetesCatalogMock.activeClusterId = id
      kubernetesCatalogMock.selectedClusterId = id
      kubernetesTerminalSessionsMock = kubernetesTerminalSessionsMock.map((session) =>
        session.clusterId === id && session.status === 'connecting' ? { ...session, status: 'connected', updatedAt: '刚刚' } : session
      )
      return k8sCatalogResultMock({ cluster: { ...findKubernetesClusterMock(id)! } })
    }),
    disconnectKubernetesCluster: vi.fn(async (id: string) => {
      const existing = findKubernetesClusterMock(id)
      if (!existing) return { ok: false, errorCode: 'K8S_CLUSTER_NOT_FOUND', errorMessage: 'Kubernetes cluster not found.' }
      const updated: TestKubernetesCluster = {
        ...existing,
        is_active: 0,
        connection_status: 'disconnected',
        updated_at: '刚刚'
      }
      kubernetesCatalogMock.clusters = kubernetesCatalogMock.clusters.map((cluster) => (cluster.id === id ? updated : cluster))
      kubernetesCatalogMock.activeClusterId = kubernetesCatalogMock.clusters.find((cluster) => cluster.is_active === 1)?.id || null
      const closedSessions = kubernetesTerminalSessionsMock.filter((session) => session.clusterId === id)
      kubernetesTerminalSessionsMock = kubernetesTerminalSessionsMock.filter((session) => session.clusterId !== id)
      closedSessions.forEach((session) => {
        kubernetesTerminalExitListenersMock.forEach((listener) =>
          listener({
            id: session.id,
            sessionId: session.sessionId,
            clusterId: session.clusterId,
            exitCode: 0,
            reason: 'disconnect',
            emittedAt: '刚刚'
          })
        )
      })
      return k8sCatalogResultMock({ cluster: { ...updated } })
    }),
    syncKubernetesBastion: vi.fn(async (bastionUuid: string) => {
      const bastion = kubernetesCatalogMock.bastions.find((item) => item.uuid === bastionUuid)
      if (!bastion) return { ok: false, errorCode: 'K8S_BASTION_NOT_FOUND', errorMessage: 'Kubernetes bastion not found.' }
      const refreshOrganizationAssets = window.aiops?.refreshOrganizationAssets
      if (typeof refreshOrganizationAssets !== 'function') {
        return {
          ok: false,
          errorCode: 'K8S_BASTION_SYNC_UNAVAILABLE',
          errorMessage: 'JumpServer Kubernetes asset sync requires the live JumpServer backend integration.'
        }
      }
      const refreshed = await refreshOrganizationAssets({ organizationId: bastionUuid })
      if (!refreshed?.ok || !refreshed.data) {
        return {
          ok: false,
          errorCode: refreshed?.errorCode || 'K8S_BASTION_SYNC_FAILED',
          errorMessage: refreshed?.errorMessage || 'JumpServer Kubernetes asset refresh failed.'
        }
      }
      const refreshedData = refreshed.data
      const organizationRows = refreshedData.assets.filter(
        (asset) =>
          asset.asset_type === 'organization' &&
          (asset.id === bastionUuid || asset.uuid === bastionUuid) &&
          (!refreshedData.organizationId || asset.id === refreshedData.organizationId || asset.uuid === refreshedData.organizationId)
      )
      if (refreshedData.organizationId && refreshedData.organizationId !== bastionUuid && organizationRows.length === 0) {
        return {
          ok: false,
          errorCode: 'K8S_BASTION_SYNC_MISMATCH',
          errorMessage: 'JumpServer Kubernetes asset refresh returned a different organization.'
        }
      }
      const organizationIds = new Set(
        [bastionUuid, refreshedData.organizationId, ...organizationRows.flatMap((asset) => [asset.id, asset.uuid])]
          .map(trimMock)
          .filter(Boolean)
      )
      const assets = refreshedData.assets.filter((asset) => isJumpserverKubernetesAssetMock(asset, organizationIds))
      const { syncedCount, updatedCount } = upsertJumpserverKubernetesClustersMock(bastion, assets)
      return k8sCatalogResultMock({ syncedCount, updatedCount })
    }),
    createKubernetesTerminal: vi.fn(async (input: { clusterId: string; namespace?: string; cols?: number; rows?: number }) => {
      const cluster = findKubernetesClusterMock(input.clusterId)
      if (!cluster) return { ok: false, errorCode: 'K8S_CLUSTER_NOT_FOUND', errorMessage: 'Kubernetes cluster not found.' }
      const sequence = kubernetesTerminalSequenceMock++
      const perClusterCount = vi.mocked(window.aiops.createKubernetesTerminal).mock.calls.filter(([call]) => call.clusterId === input.clusterId).length
      const namespace = input.namespace || cluster.default_namespace || 'default'
      const record: TestKubernetesTerminalRecord = {
        id: `k8s-tab-test-${sequence}`,
        sessionId: `k8s-session-test-${sequence}`,
        clusterId: cluster.id,
        name: perClusterCount <= 1 ? cluster.name : `${cluster.name}-${perClusterCount}`,
        namespace,
        output: [`Connecting to cluster ${cluster.name}...`, `kubectl context: ${cluster.context_name}`, `namespace: ${namespace}`, `[${namespace}]$ `].join('\n'),
        status: cluster.connection_status === 'connected' ? 'connected' : 'connecting',
        cols: Math.max(20, Math.min(240, Math.round(Number(input.cols) || 80))),
        rows: Math.max(8, Math.min(80, Math.round(Number(input.rows) || 24))),
        createdAt: '刚刚',
        updatedAt: '刚刚'
      }
      kubernetesTerminalSessionsMock = [...kubernetesTerminalSessionsMock, record]
      return {
        ok: true,
        data: { ...record }
      }
    }),
    writeKubernetesTerminal: vi.fn(async (id: string, data: string) => {
      const session = kubernetesTerminalSessionsMock.find((item) => item.sessionId === id || item.id === id)
      if (!session) return { ok: false, errorCode: 'K8S_TERMINAL_NOT_FOUND', errorMessage: 'Kubernetes terminal session not found.' }
      if (session.status === 'ended') return { ok: false, errorCode: 'K8S_TERMINAL_ENDED', errorMessage: 'Kubernetes terminal session has ended.' }
      if (session.status !== 'connected') return { ok: false, errorCode: 'K8S_TERMINAL_NOT_CONNECTED', errorMessage: 'Kubernetes terminal is not connected.' }
      const command = normalizeKubernetesCommandMock(data)
      if (!command) return { ok: false, errorCode: 'K8S_EMPTY_COMMAND', errorMessage: 'Kubernetes command is required.' }
      const cluster = findKubernetesClusterMock(session.clusterId)
      const rendered = renderKubernetesSeedCommandMock({
        command,
        clusterId: session.clusterId,
        clusterName: cluster?.name,
        contextName: cluster?.context_name,
        namespace: session.namespace,
        defaultNamespace: cluster?.default_namespace
      })
      const terminalOutput = `[aiopsterm kubectl] ${command}${rendered.output ? `\n${rendered.output}` : ''}`
      session.output = session.output.endsWith('\n') || !session.output ? `${session.output}${terminalOutput}` : `${session.output}\n${terminalOutput}`
      session.updatedAt = '刚刚'
      const event: TestKubernetesTerminalDataEvent = {
        id: session.id,
        sessionId: session.sessionId,
        clusterId: session.clusterId,
        data: terminalOutput,
        command,
        output: rendered.output,
        success: rendered.success,
        error: rendered.error,
        emittedAt: '刚刚'
      }
      kubernetesTerminalDataListenersMock.forEach((listener) => listener(event))
      return {
        ok: true,
        data: {
          id: session.id,
          sessionId: session.sessionId,
          bytes: new TextEncoder().encode(data).byteLength,
          command,
          output: rendered.output,
          success: rendered.success,
          error: rendered.error,
          terminalOutput,
          updatedAt: session.updatedAt
        }
      }
    }),
    resizeKubernetesTerminal: vi.fn(async (id: string, cols: number, rows: number) => {
      const session = kubernetesTerminalSessionsMock.find((item) => item.sessionId === id || item.id === id)
      if (!session) return { ok: false, errorCode: 'K8S_TERMINAL_NOT_FOUND', errorMessage: 'Kubernetes terminal session not found.' }
      session.cols = Math.max(20, Math.min(240, Math.round(Number(cols) || 80)))
      session.rows = Math.max(8, Math.min(80, Math.round(Number(rows) || 24)))
      session.updatedAt = '刚刚'
      return { ok: true, data: { ...session } }
    }),
    closeKubernetesTerminal: vi.fn(async (id: string, exitCode = 0) => {
      const session = kubernetesTerminalSessionsMock.find((item) => item.sessionId === id || item.id === id)
      if (!session) return { ok: false, errorCode: 'K8S_TERMINAL_NOT_FOUND', errorMessage: 'Kubernetes terminal session not found.' }
      session.status = 'ended'
      session.updatedAt = '刚刚'
      kubernetesTerminalSessionsMock = kubernetesTerminalSessionsMock.filter((item) => item.sessionId !== session.sessionId)
      const event: TestKubernetesTerminalExitEvent = {
        id: session.id,
        sessionId: session.sessionId,
        clusterId: session.clusterId,
        exitCode,
        reason: 'closed',
        emittedAt: '刚刚'
      }
      kubernetesTerminalExitListenersMock.forEach((listener) => listener(event))
      return {
        ok: true,
        data: {
          ...session,
          exitCode
        }
      }
    }),
    cleanupKubernetesAgent: vi.fn(async () => ({
      ok: true,
      data: {
        cleared: true,
        cleanedAt: '刚刚'
      }
    })),
    listAiModels: vi.fn(async (input?: { modelSettings?: typeof defaultModelSettings; localChatBackendAvailable?: boolean }) => cloneAiModelCatalog(input)),
    checkModelProvider: vi.fn(
      async (input: {
        provider: 'litellm' | 'openai' | 'bedrock' | 'deepseek' | 'anthropic' | 'ollama' | 'lmstudio'
        config: { baseUrl: string; apiKey: string; modelId: string; awsRegion?: string; awsEndpointSelected?: boolean; awsBedrockEndpoint?: string }
      }) => {
        const labels = {
          litellm: 'LiteLLM',
          openai: 'OpenAI Compatible',
          bedrock: 'Amazon Bedrock',
          deepseek: 'DeepSeek',
          anthropic: 'Anthropic',
          ollama: 'Ollama',
          lmstudio: 'LM Studio'
        }
        if (!input.config.modelId.trim()) return { ok: false, errorCode: 'MODEL_PROVIDER_MODEL_REQUIRED', errorMessage: 'Model is required.' }
        return {
          ok: true,
          data: {
            provider: input.provider,
            label: labels[input.provider],
            modelId: input.config.modelId,
            endpoint: input.config.baseUrl || (input.provider === 'bedrock' ? `bedrock-runtime:${input.config.awsRegion || 'us-east-1'}` : 'test-backend'),
            message: `${labels[input.provider]} configuration validated by test backend.`,
            durationMs: 1
          }
        }
      }
    ),
    listExtensionPlugins: vi.fn(async () => ({
      ok: true,
      data: extensionPluginStoreMock.map(cloneTestExtensionPlugin)
    })),
    installExtensionPlugin: vi.fn(async (input: { plugin: TestExtensionPlugin }) => storePackageUnavailableMock(input.plugin)),
    updateExtensionPlugin: vi.fn(async (input: { plugin: TestExtensionPlugin }) => storePackageUnavailableMock(input.plugin)),
    installExtensionPackage: vi.fn(
      async (input: { fileName: string; filePath?: string; size?: number; existingPluginIds?: string[]; requestId?: string }) => {
        if (!input.fileName.toLowerCase().endsWith('.external-reference')) {
          return { ok: false, errorCode: 'EXTENSION_PACKAGE_FORMAT_INVALID', errorMessage: 'Plugin package must use the .external-reference extension.' }
        }
        if (!input.filePath) {
          return { ok: false, errorCode: 'EXTENSION_PACKAGE_PATH_REQUIRED', errorMessage: 'Plugin package file path is required.' }
        }
        const plugin = createPackagePluginMock(input)
        return finishExtensionOperationMock('package', plugin, 120, input.requestId)
      }
    ),
    downloadExtensionPackage: vi.fn(async (input: { url: string }) => {
      if (!/^https?:\/\//i.test(input.url || '')) {
        return { ok: false, errorCode: 'EXTENSION_PACKAGE_DOWNLOAD_URL_INVALID', errorMessage: 'Plugin package download URL must be http or https.' }
      }
      return { ok: true, data: { url: input.url, bytes: 0, data: [] } }
    }),
    installExtensionPluginFromUrl: vi.fn(async (input: { pluginId: string; version?: string; url: string; sha256?: string }) => {
      if (!/^https?:\/\//i.test(input.url || '')) {
        return { ok: false, errorCode: 'EXTENSION_PACKAGE_DOWNLOAD_URL_INVALID', errorMessage: 'Plugin package download URL must be http or https.' }
      }
      const existing = extensionPluginStoreMock.find((plugin) => plugin.pluginId === input.pluginId)
      const plugin = cloneTestExtensionPlugin(
        existing || {
          pluginId: input.pluginId,
          name: input.pluginId,
          description: 'Remote extension package.',
          iconKey: 'local',
          tabName: input.pluginId,
          show: true,
          isPlugin: true,
          installed: false,
          hasUpdate: false,
          installedVersion: '',
          latestVersion: input.version || 'latest',
          installable: true,
          source: 'store',
          categories: ['Store']
        }
      )
      plugin.latestVersion = input.version || plugin.latestVersion || 'latest'
      plugin.packageUrl = input.url
      plugin.packageSha256 = input.sha256
      return finishExtensionOperationMock(plugin.installed && plugin.hasUpdate ? 'update' : 'install', plugin)
    }),
    uninstallExtensionPlugin: vi.fn(async (input: { plugin: TestExtensionPlugin }) => {
      const plugin = cloneTestExtensionPlugin(input.plugin)
      plugin.installed = false
      plugin.installedVersion = ''
      plugin.hasUpdate = false
      if (plugin.source === 'local' && !plugin.latestVersion) plugin.show = false
      upsertExtensionPluginStoreMock(plugin)
      return { ok: true, data: { operation: 'uninstall' as const, plugin, message: `${plugin.name} uninstalled by test backend.` } }
    }),
    openExtensionSubscription: vi.fn(async (input: { plugin: TestExtensionPlugin }) => {
      const plugin = cloneTestExtensionPlugin(input.plugin)
      if (plugin.installed) {
        return {
          ok: false,
          errorCode: 'EXTENSION_PLUGIN_ALREADY_INSTALLED',
          errorMessage: 'Installed plugins do not need a subscription entry.'
        }
      }
      if (plugin.installable !== false && !plugin.isPrivate) {
        return {
          ok: false,
          errorCode: 'EXTENSION_PLUGIN_SUBSCRIPTION_UNAVAILABLE',
          errorMessage: 'Plugin does not require a subscription.'
        }
      }
      if (!plugin.subscriptionUrl) {
        return {
          ok: false,
          errorCode: 'EXTENSION_PLUGIN_SUBSCRIPTION_UNAVAILABLE',
          errorMessage: 'Plugin subscription URL is not available.'
        }
      }
      return {
        ok: true,
        data: {
          pluginId: plugin.pluginId,
          url: plugin.subscriptionUrl,
          message: `${plugin.name} subscription entry opened by test backend.`
        }
      }
    }),
    cancelExtensionInstall: vi.fn(async (pluginId: string) => {
      cancelledExtensionOperationIds.add(pluginId)
      emitExtensionProgressMock({ pluginId, operation: 'install', stage: 'cancelled', percent: 0 })
      return { ok: true, data: { pluginId, stage: 'cancelled' as const, percent: 0, message: 'Plugin operation cancellation requested.' } }
    }),
    onExtensionInstallProgress: vi.fn((listener: (event: TestExtensionProgress) => void) => {
      extensionProgressListeners.add(listener)
      return () => {
        extensionProgressListeners.delete(listener)
      }
    }),
    generateAiChatResponse: vi.fn(
      (input: TestAiTodoResponseInput & { prompt: string }) =>
        new Promise((resolve) => {
          window.setTimeout(() => {
            const cancelled = aiChatResponseKeysMock(input).some((key) => cancelledAiChatResponseKeysMock.has(key))
            if (cancelled) {
              recordAiTodoResponseMock(input, 'cancelled')
              resolve({
                ok: true,
                data: {
                  text: '已停止生成。',
                  provider: 'aiopsterm-local' as const,
                  model: 'aiopsterm-local-agent',
                  durationMs: 1,
                  status: 'cancelled' as const,
                  requestId: input.requestId,
                  assistantMessageId: input.assistantMessageId,
                  contextUsage: createAiChatContextUsageMock({
                    requestId: input.requestId,
                    assistantMessageId: input.assistantMessageId,
                    prompt: input.prompt,
                    messages: input.messages,
                    contexts: input.contexts,
                    skills: input.skills,
                    command: input.command,
                    outputText: '已停止生成。'
                  })
                }
              })
              return
            }
            recordAiTodoResponseMock(input, 'done')
            const text = [
              ...(input.skills || []).map((skill) => `Activated Skill: ${skill.name}`),
              (input.skills || []).length ? '' : '',
              '正在读取当前终端、资产和知识库上下文...',
              '',
              '计划：',
              '1. 确认目标环境。',
              '2. 生成只读检查命令。',
              '3. 等待用户确认后执行。',
              '',
              '当前响应由 aiopsterm 本地后端生成，未连接远端 AI 服务。'
            ].join('\n')
            resolve({
              ok: true,
              data: {
                text,
                provider: 'aiopsterm-local' as const,
                model: 'aiopsterm-local-agent',
                durationMs: 1,
                status: 'done' as const,
                requestId: input.requestId,
                assistantMessageId: input.assistantMessageId,
                contextUsage: createAiChatContextUsageMock({
                  requestId: input.requestId,
                  assistantMessageId: input.assistantMessageId,
                  prompt: input.prompt,
                  messages: input.messages,
                  contexts: input.contexts,
                  skills: input.skills,
                  command: input.command,
                  outputText: text
                })
              }
            })
          }, 700)
        })
    ),
    cancelAiChatResponse: vi.fn(async (input: { requestId?: string; assistantMessageId?: string }) => {
      const keys = aiChatResponseKeysMock(input)
      if (!keys.length) {
        return {
          ok: false,
          errorCode: 'AI_CHAT_CANCEL_TARGET_REQUIRED',
          errorMessage: 'AI chat response cancellation requires a request or assistant message id'
        }
      }
      keys.forEach((key) => cancelledAiChatResponseKeysMock.add(key))
      const assistantMessageId = String(input.assistantMessageId || '').trim() || undefined
      const requestId = String(input.requestId || '').trim() || aiChatRequestIdFromAssistantMessageIdMock(assistantMessageId) || undefined
      recordAiTodoResponseMock({}, 'cancelled')
      return {
        ok: true,
        data: {
          status: 'cancelled' as const,
          requestId,
          assistantMessageId,
          text: '已停止生成。',
          active: true,
          contextUsage: createAiChatContextUsageMock({
            requestId,
            assistantMessageId,
            outputText: '已停止生成。'
          })
        }
      }
    }),
    transcribeVoiceInput: vi.fn(
      async (input?: {
        audioData?: string
        audioBytes?: ArrayBuffer | Uint8Array | number[]
        audioFormat?: string
        audioSize?: number
        durationMs?: number
        source?: 'browser'
      }) => {
        if ((!input?.audioData && !input?.audioBytes) || !input.audioSize) {
          return {
            ok: false,
            errorCode: 'VOICE_AUDIO_REQUIRED',
            errorMessage: 'Audio data is required for voice transcription.'
          }
        }
        return {
          ok: true,
          data: {
            text: 'Provider transcript from test voice backend',
            provider: 'openai' as const,
            model: 'test-voice-provider'
          }
        }
      }
    ),
    listDatabaseCatalog: vi.fn(async () => ({ ok: true, data: databaseWorkspaceCatalogMock() })),
    getDatabaseAiPaneState: vi.fn(async () => ({ ok: true as const, data: cloneDatabaseAiPaneStateMock(databaseAiPaneStateMock) })),
    saveDatabaseAiPaneState: vi.fn(async (input: DatabaseAiPaneStateSnapshot) => {
      databaseAiPaneStateMock = normalizeDatabaseAiPaneStateMock(input)
      return { ok: true as const, data: cloneDatabaseAiPaneStateMock(databaseAiPaneStateMock) }
    }),
    testDatabaseConnection: vi.fn(testDatabaseConnectionMock),
    saveDatabaseConnection: vi.fn(saveDatabaseConnectionMock),
    createDatabaseGroup: vi.fn(createDatabaseGroupMock),
    renameDatabaseGroup: vi.fn(renameDatabaseGroupMock),
    moveDatabaseGroup: vi.fn(moveDatabaseGroupMock),
    deleteDatabaseGroup: vi.fn(deleteDatabaseGroupMock),
    moveDatabaseConnection: vi.fn(moveDatabaseConnectionMock),
    removeDatabaseConnection: vi.fn(removeDatabaseConnectionMock),
    connectDatabaseConnection: vi.fn(connectDatabaseConnectionMock),
    disconnectDatabaseConnection: vi.fn(disconnectDatabaseConnectionMock),
    refreshDatabaseConnection: vi.fn(refreshDatabaseConnectionMock),
    createDatabaseCatalog: vi.fn(createDatabaseCatalogMock),
    executeDatabaseSql: vi.fn(async (input: { sql: string; connectionId: string; databaseName?: string; schemaName?: string }) => {
      const sql = input.sql.trim().replace(/\s+/g, ' ')
      if (!sql) {
        return {
          ok: false,
          errorCode: 'DB_SQL_EMPTY',
          errorMessage: 'SQL is required.',
          execution: createDatabaseSqlExecutionMock({ status: 'error', message: 'SQL is required.' })
        }
      }
      if (/drop\s+database|syntax_error/i.test(sql)) {
        return {
          ok: false,
          errorCode: 'DB_SQL_REJECTED',
          errorMessage: 'Backend SQL executor rejected this statement.',
          execution: createDatabaseSqlExecutionMock({ status: 'error', message: 'Backend SQL executor rejected this statement.' })
        }
      }
      const resolved = databaseRowsForSqlMock({ ...input, sql })
      if (!resolved.ok) {
        return {
          ok: false,
          errorCode: resolved.errorCode,
          errorMessage: resolved.errorMessage,
          execution: createDatabaseSqlExecutionMock({ status: 'error', message: resolved.errorMessage })
        }
      }
      const execution = createDatabaseSqlExecutionMock({
        status: 'ok',
        message: `Execution OK (${resolved.rows.length} row${resolved.rows.length === 1 ? '' : 's'})`,
        rowCount: resolved.rows.length
      })
      return {
        ok: true,
        data: {
          columns: Object.keys(resolved.rows[0] || {}),
          rows: resolved.rows,
          rowCount: resolved.rows.length,
          durationMs: 1,
          execution
        }
      }
    }),
    getDatabaseTableDdl: vi.fn(
      async (input: { connectionId: string; databaseName: string; schemaName?: string; tableName: string }) => {
        const key = databaseDdlKey(input)
        const entry = databaseTableDdlMock[key]
        if (!entry) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        if (entry.error) return { ok: false, errorCode: entry.error.code, errorMessage: entry.error.message }
        return { ok: true, data: { ddl: entry.ddl } }
      }
    ),
    queryDatabaseTable: vi.fn(
      async (input: {
        connectionId: string
        databaseName: string
        schemaName?: string
        tableName: string
        filters?: Array<{ column: string; operator: string; value?: string; values?: string[] }>
        sort?: { column: string; direction: 'asc' | 'desc' } | null
        whereRaw?: string | null
        page: number
        pageSize: number
        withTotal?: boolean
      }) => {
        const key = databaseTableKey(input)
        const sourceRows = databaseTableRowsMock[key]
        const knownColumns = databaseTableColumnsMock[key] || Object.keys(sourceRows?.[0] || {})
        if (!sourceRows) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        const filters = [...parseDatabaseWhereMock(input.whereRaw), ...(input.filters || [])]
        let rows = filterDatabaseRowsMock(sourceRows, filters)
        if (input.sort) {
          const factor = input.sort.direction === 'asc' ? 1 : -1
          rows = [...rows].sort((a, b) => String(a[input.sort!.column] ?? '').localeCompare(String(b[input.sort!.column] ?? '')) * factor)
        }
        const pageSize = Math.max(1, input.pageSize || 100)
        const page = Math.max(1, input.page || 1)
        const pageRows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((row) => ({ ...row }))
        return {
          ok: true,
          data: {
            columns: knownColumns,
            rows: pageRows,
            rowCount: pageRows.length,
            durationMs: 1,
            total: input.withTotal ? rows.length : null,
            knownColumns
          }
        }
      }
    ),
    planDatabaseTableMutation: vi.fn(planDatabaseTableMutationMock),
    mutateDatabaseTable: vi.fn(
      async (input: {
        connectionId: string
        databaseName: string
        schemaName?: string
        tableName: string
        mutations: Array<
          | { kind: 'delete'; rowKey: string; primaryKey: string[] }
          | { kind: 'update'; rowKey: string; primaryKey: string[]; patch: Record<string, unknown> }
          | { kind: 'insert'; values: Record<string, unknown> }
          | { kind: 'truncate' }
          | { kind: 'drop' }
        >
      }) => {
        const key = databaseTableKey(input)
        const rows = databaseTableRowsMock[key]
        if (!rows) return { ok: false, errorCode: 'DB_TABLE_NOT_FOUND', errorMessage: `Table not found: ${input.tableName}` }
        let affected = 0
        input.mutations.forEach((mutation) => {
          if (mutation.kind === 'drop') {
            affected += rows.length
            delete databaseTableRowsMock[key]
            delete databaseTableColumnsMock[key]
            delete databaseTableDdlMock[key]
            return
          }
          if (mutation.kind === 'truncate') {
            affected += rows.length
            rows.splice(0, rows.length)
            return
          }
          if (mutation.kind === 'insert') {
            rows.push({ ...mutation.values })
            affected += 1
            return
          }
          const index = rows.findIndex((row, rowIndex) => rowKeyForDatabaseMock(row, mutation.primaryKey, rowIndex) === mutation.rowKey)
          if (index < 0) return
          if (mutation.kind === 'delete') rows.splice(index, 1)
          else rows[index] = { ...rows[index], ...mutation.patch }
          affected += 1
        })
        return { ok: true, data: { affected, durationMs: 1, catalog: databaseWorkspaceCatalogMock(input.connectionId) } }
      }
    ),
    createDatabaseAiPaneRequest: vi.fn(async (input: { prompt: string; context: { contextSummary?: string; connectionId: string; databaseName: string; schemaName?: string; dbType?: string } }) => {
      const prompt = databaseTrimMock(input.prompt)
      if (!prompt) return { ok: false, errorCode: 'DB_AI_PROMPT_REQUIRED', errorMessage: 'Prompt is required.' }
      const requestId = `dbai-pane-request-test-${databaseAiPaneRequestSequenceMock++}`
      const contextSummary =
        input.context.contextSummary ||
        [input.context.connectionId, input.context.dbType, input.context.databaseName, input.context.schemaName].filter(Boolean).join(' · ')
      const createdAt = Date.now()
      const userMessage = storeDatabaseAiPaneMessageMock(
        databaseAiPaneMessageRecordMock(
          { requestId, role: 'user', status: 'done', content: prompt, contextSummary, createdAt },
          `${requestId}-user`
        )
      )
      const assistantMessage = storeDatabaseAiPaneMessageMock(
        databaseAiPaneMessageRecordMock(
          { requestId, role: 'assistant', status: 'queued', content: '', contextSummary, createdAt: createdAt + 1 },
          `${requestId}-assistant`
        )
      )
      return {
        ok: true,
        data: {
          requestId,
          userMessage,
          assistantMessage
        }
      }
    }),
    startDatabaseAiPaneResponse: vi.fn(async (input: { requestId: string; assistantMessageId?: string }) => {
      const existing = findDatabaseAiPaneAssistantMessageMock(input)
      if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
      if (existing.status === 'done' || existing.status === 'cancelled') return { ok: true, data: { assistantMessage: existing } }
      const assistantMessage = updateDatabaseAiPaneAssistantMessageMock(input, { status: 'streaming' })!
      return { ok: true, data: { assistantMessage } }
    }),
    cancelDatabaseAiPaneResponse: vi.fn(async (input: { requestId: string; assistantMessageId?: string }) => {
      const existing = findDatabaseAiPaneAssistantMessageMock(input)
      if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI pane request was not found.' }
      if (existing.status === 'done') return { ok: true, data: { assistantMessage: existing } }
      const assistantMessage = updateDatabaseAiPaneAssistantMessageMock(input, {
        status: 'cancelled',
        content: existing.content || 'Response cancelled before the first chunk.'
      })!
      return { ok: true, data: { assistantMessage } }
    }),
    generateDatabaseAiPaneResponse: vi.fn(
      (input: { requestId?: string; assistantMessageId?: string; prompt: string; context: { contextSummary?: string; connectionId: string; databaseName: string; schemaName?: string; dbType?: string } }) =>
        new Promise((resolve) => {
          window.setTimeout(() => {
            if (!databaseTrimMock(input.prompt)) {
              resolve(databaseAiPaneErrorResponseMock(input, 'DB_AI_PROMPT_REQUIRED', 'Prompt is required.'))
              return
            }
            if (!databaseTrimMock(input.context.connectionId)) {
              resolve(databaseAiPaneErrorResponseMock(input, 'DB_CONNECTION_REQUIRED', 'Database connection is required.'))
              return
            }
            if (!databaseTrimMock(input.context.databaseName)) {
              resolve(databaseAiPaneErrorResponseMock(input, 'DB_DATABASE_REQUIRED', 'Database name is required.'))
              return
            }
            const requestId = input.requestId || `dbai-pane-response-test-${databaseAiPaneRequestSequenceMock++}`
            const contextSummary = databaseAiPaneContextSummaryMock(input)
            const text = [
              `Context: ${contextSummary}`,
              '当前响应由 aiopsterm DB AI 本地后端生成，未连接远端数据库 AI 服务。',
              '',
              'Schema summary:',
              '- public: orders(5 columns), open_orders_v(5 columns)',
              '',
              'Recommended starting point:',
              '```sql',
              'SELECT *',
              'FROM "public"."orders"',
              'LIMIT 100;',
              '```'
            ].join('\n')
            const createdAt = Date.now()
            const existing = findDatabaseAiPaneAssistantMessageMock({ requestId, assistantMessageId: input.assistantMessageId })
            if (existing?.status === 'cancelled') {
              resolve({
                ok: true,
                data: {
                  requestId,
                  assistantMessage: existing,
                  text: existing.content,
                  provider: 'aiopsterm-local' as const,
                  durationMs: 1
                }
              })
              return
            }
            const assistantMessage = storeDatabaseAiPaneMessageMock(
              databaseAiPaneMessageRecordMock(
                { requestId, role: 'assistant', status: 'done', content: text, contextSummary, createdAt },
                input.assistantMessageId || existing?.id || `${requestId}-assistant`
              )
            )
            resolve({
              ok: true,
              data: {
                requestId,
                assistantMessage,
                text,
                provider: 'aiopsterm-local' as const,
                durationMs: 1
              }
            })
          }, 700)
        })
    ),
    createDatabaseAiDrawerRequest: vi.fn(
      async (input: {
        requestId?: string
        action: TestDatabaseAiDrawerAction
        sourceSql: string
        targetDialect?: TestDatabaseAiTargetDialect
        context: { connectionId?: string; contextSummary?: string; dbType?: TestDatabaseAiTargetDialect | ''; databaseName?: string; schemaName?: string; tableName?: string }
      }) => {
        if (!input.context.connectionId) return { ok: false, errorCode: 'DB_CONNECTION_REQUIRED', errorMessage: 'Database connection is required.' }
        const now = Date.now()
        const id = input.requestId || `dbai-drawer-request-test-${databaseAiDrawerRequestSequenceMock++}`
        const backendDbType = input.context.dbType && input.context.dbType !== 'mssql' ? input.context.dbType : ''
        const targetDialect = normalizeDatabaseAiTargetDialectMock(input.targetDialect || input.context.dbType || 'postgresql')
        const request: DatabaseAiDrawerRequestRecord = {
          id,
          action: input.action,
          label: databaseAiDrawerActionNameMock(input.action),
          status: 'queued',
          contextSummary: input.context.contextSummary || '',
          sourceSql: input.sourceSql,
          text: '',
          targetDialect,
          backendContext: {
            connectionId: input.context.connectionId,
            dbType: backendDbType,
            databaseName: input.context.databaseName || '',
            schemaName: input.context.schemaName,
            tableName: input.context.tableName,
            contextSummary: input.context.contextSummary
          },
          createdAt: now,
          updatedAt: now
        }
        return { ok: true, data: storeDatabaseAiDrawerRequestMock(request) }
      }
    ),
    startDatabaseAiDrawerResponse: vi.fn(async (input: { requestId: string }) => {
      const existing = findDatabaseAiDrawerRequestMock(input.requestId)
      if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
      if (existing.status === 'cancelled') return { ok: true, data: existing }
      const request = updateDatabaseAiDrawerRequestMock(input.requestId, { status: 'streaming', text: '' })!
      return { ok: true, data: request }
    }),
    cancelDatabaseAiDrawerResponse: vi.fn(async (input: { requestId: string }) => {
      const existing = findDatabaseAiDrawerRequestMock(input.requestId)
      if (!existing) return { ok: false, errorCode: 'DB_AI_REQUEST_NOT_FOUND', errorMessage: 'DB AI drawer request was not found.' }
      if (existing.status === 'done' || existing.status === 'error') return { ok: true, data: existing }
      const request = updateDatabaseAiDrawerRequestMock(input.requestId, { status: 'cancelled' })!
      return { ok: true, data: request }
    }),
    generateDatabaseAiDrawerResponse: vi.fn(
      (input: {
        requestId?: string
        action: TestDatabaseAiDrawerAction
        sourceSql: string
        targetDialect?: TestDatabaseAiTargetDialect
        context: { connectionId?: string; contextSummary?: string; dbType?: TestDatabaseAiTargetDialect | ''; databaseName?: string; schemaName?: string; tableName?: string }
        errorMessage?: string
      }) =>
        new Promise((resolve) => {
          window.setTimeout(() => {
            const validActions: TestDatabaseAiDrawerAction[] = ['explain', 'nl2sql', 'optimize', 'convert', 'complete', 'diagnose', 'drop', 'truncate']
            if (!validActions.includes(input.action)) {
              resolve(databaseAiDrawerErrorResponseMock(input, 'DB_AI_ACTION_INVALID', 'DB AI action is not supported.'))
              return
            }
            if (input.action !== 'nl2sql' && input.action !== 'complete' && input.action !== 'diagnose' && !databaseTrimMock(input.sourceSql)) {
              resolve(databaseAiDrawerErrorResponseMock(input, 'DB_AI_SQL_REQUIRED', 'SQL is required.'))
              return
            }
            if (!databaseTrimMock(input.context.connectionId)) {
              resolve(databaseAiDrawerErrorResponseMock(input, 'DB_CONNECTION_REQUIRED', 'Database connection is required.'))
              return
            }
            const existing = input.requestId ? findDatabaseAiDrawerRequestMock(input.requestId) : null
            if (existing?.status === 'cancelled') {
              resolve({
                ok: true,
                data: {
                  request: existing,
                  text: existing.text,
                  reasoning: '',
                  sql: '',
                  provider: 'aiopsterm-local' as const,
                  durationMs: 1
                }
              })
              return
            }
            const data = generateDatabaseAiDrawerTextMock(input)
            const request =
              input.requestId && existing
                ? updateDatabaseAiDrawerRequestMock(input.requestId, {
                    status: 'done',
                    text: data.text,
                    targetDialect: normalizeDatabaseAiTargetDialectMock(input.targetDialect || existing.targetDialect)
                  })!
                : storeDatabaseAiDrawerRequestMock({
                    id: input.requestId || `dbai-drawer-response-test-${databaseAiDrawerRequestSequenceMock++}`,
                    action: input.action,
                    label: databaseAiDrawerActionNameMock(input.action),
                    status: 'done',
                    contextSummary: input.context.contextSummary || '',
                    sourceSql: input.sourceSql,
                    text: data.text,
                    targetDialect: normalizeDatabaseAiTargetDialectMock(input.targetDialect || input.context.dbType || 'postgresql'),
                    backendContext: {
                      connectionId: '',
                      dbType: input.context.dbType === 'mssql' ? '' : input.context.dbType,
                      databaseName: input.context.databaseName || '',
                      schemaName: input.context.schemaName,
                      tableName: input.context.tableName,
                      contextSummary: input.context.contextSummary
                    },
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                  })
            resolve({
              ok: true,
              data: {
                request,
                ...data,
                provider: 'aiopsterm-local' as const,
                durationMs: 1
              }
            })
          }, 120)
        })
    ),
    diagnoseDatabaseSqlError: vi.fn(
      (input: {
        requestId?: string
        sourceSql: string
        targetDialect?: TestDatabaseAiTargetDialect
        context: { connectionId?: string; contextSummary?: string; dbType?: TestDatabaseAiTargetDialect | ''; databaseName?: string; schemaName?: string; tableName?: string }
        errorMessage?: string
      }) =>
        new Promise((resolve) => {
          window.setTimeout(() => {
            const sourceSql = databaseTrimMock(input.sourceSql)
            const errorMessage = databaseTrimMock(input.errorMessage)
            const drawerInput = {
              requestId: input.requestId,
              action: 'diagnose' as const,
              sourceSql,
              targetDialect: normalizeDatabaseAiTargetDialectMock(input.targetDialect || input.context.dbType || 'postgresql'),
              context: input.context,
              errorMessage
            }
            if (!sourceSql) {
              resolve(databaseAiDrawerErrorResponseMock(drawerInput, 'DB_AI_SQL_REQUIRED', 'SQL is required.'))
              return
            }
            if (!errorMessage) {
              resolve(databaseAiDrawerErrorResponseMock(drawerInput, 'DB_AI_ERROR_REQUIRED', 'SQL error message is required.'))
              return
            }
            if (!databaseTrimMock(input.context.connectionId)) {
              resolve(databaseAiDrawerErrorResponseMock(drawerInput, 'DB_CONNECTION_REQUIRED', 'Database connection is required.'))
              return
            }
            const now = Date.now()
            const backendDbType = input.context.dbType && input.context.dbType !== 'mssql' ? input.context.dbType : ''
            const targetDialect = normalizeDatabaseAiTargetDialectMock(input.targetDialect || input.context.dbType || 'postgresql')
            const request = storeDatabaseAiDrawerRequestMock({
              id: input.requestId || `dbai-drawer-request-test-${databaseAiDrawerRequestSequenceMock++}`,
              action: 'diagnose',
              label: databaseAiDrawerActionNameMock('diagnose'),
              status: 'streaming',
              contextSummary: input.context.contextSummary || '',
              sourceSql,
              text: '',
              targetDialect,
              backendContext: {
                connectionId: input.context.connectionId || '',
                dbType: backendDbType,
                databaseName: input.context.databaseName || '',
                schemaName: input.context.schemaName,
                tableName: input.context.tableName,
                contextSummary: input.context.contextSummary
              },
              createdAt: now,
              updatedAt: now
            })
            const data = generateDatabaseAiDrawerTextMock({
              action: request.action,
              sourceSql: request.sourceSql,
              targetDialect: request.targetDialect,
              context: request.backendContext
            })
            const doneRequest = updateDatabaseAiDrawerRequestMock(request.id, { status: 'done', text: data.text, targetDialect: request.targetDialect })!
            resolve({
              ok: true,
              data: {
                request: doneRequest,
                ...data,
                provider: 'aiopsterm-local' as const,
                durationMs: 1
              }
            })
          }, 120)
        })
    ),
    executeKubernetesCommand: vi.fn(async (input: { command: string; clusterId?: string; clusterName?: string; namespace?: string; contextName?: string; defaultNamespace?: string; source?: 'terminal' | 'agent' | 'resource' }) => {
      const command = input.command.trim().replace(/\s+/g, ' ')
      const namespace = input.namespace || 'default'
      if (!command && input.source === 'agent') {
        return {
          ok: true,
          data: {
            runId: 'k8s-run-test-validation-empty',
            command: '<empty>',
            output: '',
            terminalOutput: '',
            success: false,
            error: 'Kubernetes command is required.',
            durationMs: 1,
            startedAt: '刚刚',
            clusterId: input.clusterId || '',
            contextName: input.contextName || 'unknown-context',
            namespace,
            source: 'agent' as const
          }
        }
      }
      if (!input.clusterId && input.source === 'agent') {
        return {
          ok: true,
          data: {
            runId: `k8s-run-test-validation-${command.length}`,
            command,
            output: '',
            terminalOutput: '',
            success: false,
            error: 'No cluster selected. Please select a cluster first.',
            durationMs: 1,
            startedAt: '刚刚',
            clusterId: '',
            contextName: input.contextName || 'unknown-context',
            namespace,
            source: 'agent' as const
          }
        }
      }
      const rendered = renderKubernetesSeedCommandMock(input)
      const { output, success, error } = rendered
      const terminalOutput = `[aiopsterm kubectl] ${command}${output ? `\n${output}` : ''}`
      return {
        ok: true,
        data: {
          runId: `k8s-run-test-${command.length}-${input.source || 'terminal'}`,
          command,
          output,
          terminalOutput,
          success,
          error,
          durationMs: 1,
          startedAt: '刚刚',
          clusterId: input.clusterId || '',
          contextName: input.contextName || 'prod/admin',
          namespace,
          source: input.source || 'terminal'
        }
      }
    }),
    onKubernetesTerminalData: vi.fn((listener: (event: TestKubernetesTerminalDataEvent) => void) => {
      kubernetesTerminalDataListenersMock.add(listener)
      return () => {
        kubernetesTerminalDataListenersMock.delete(listener)
      }
    }),
    onKubernetesTerminalExit: vi.fn((listener: (event: TestKubernetesTerminalExitEvent) => void) => {
      kubernetesTerminalExitListenersMock.add(listener)
      return () => {
        kubernetesTerminalExitListenersMock.delete(listener)
      }
    }),
    planKubernetesResourceAction: vi.fn(async (input: { resourceId: string; action?: TestKubernetesResourceAction }) =>
      k8sResourceActionPlanMock(input.resourceId, input.action)
    ),
    executeKubernetesResourceAction: vi.fn(async (input: { resourceId: string; action?: TestKubernetesResourceAction }) => {
      const plan = k8sResourceActionPlanMock(input.resourceId, input.action)
      if (!plan.ok || !plan.data) return plan
      const commandResult = await window.aiops.executeKubernetesCommand({
        command: plan.data.command,
        clusterId: plan.data.clusterId,
        clusterName: plan.data.clusterName,
        contextName: plan.data.contextName,
        namespace: plan.data.namespace,
        source: 'resource'
      })
      if (!commandResult.ok || !commandResult.data) return commandResult
      return {
        ok: true,
        data: {
          ...commandResult.data,
          resourceId: plan.data.resourceId,
          resourceName: plan.data.resourceName,
          resourceKind: plan.data.resourceKind,
          action: plan.data.action,
          title: plan.data.title
        }
      }
    }),
    refreshKubernetesResources: vi.fn(async (input: { clusterId: string; namespace?: string; kind?: TestKubernetesResourceKind | 'all' }) => {
      const cluster = findKubernetesClusterMock(input.clusterId)
      if (!cluster) return { ok: false, errorCode: 'K8S_CLUSTER_NOT_FOUND', errorMessage: 'Kubernetes cluster not found.' }
      const namespace = input.kind === 'nodes' ? 'all' : input.namespace || 'all'
      const kind = input.kind || 'all'
      const command = k8sRefreshCommandMock(kind, namespace)
      const refreshedResources = refreshedKubernetesResourceCountMock(cluster.id, kind, namespace)
      const refreshedNamespaces = kubernetesCatalogMock.namespaces.filter((item) => item.clusterId === cluster.id).length
      const output =
        kind === 'all'
          ? [
              renderKubernetesSeedCommandMock({ command: 'kubectl get namespaces', clusterId: cluster.id, namespace: cluster.default_namespace }).output,
              renderKubernetesListMock('kubectl get pods --all-namespaces', cluster.id, namespace),
              renderKubernetesListMock('kubectl get deployments --all-namespaces', cluster.id, namespace),
              renderKubernetesListMock('kubectl get services --all-namespaces', cluster.id, namespace),
              renderKubernetesListMock('kubectl get nodes', cluster.id, namespace)
            ]
              .filter(Boolean)
              .join('\n\n')
          : renderKubernetesListMock(command, cluster.id, namespace)
      return k8sCatalogResultMock({
        runId: `k8s-run-refresh-test-${kind}-${namespace}`,
        refreshedClusterId: cluster.id,
        refreshedKind: kind,
        clusterId: cluster.id,
        contextName: cluster.context_name,
        namespace,
        command,
        output,
        terminalOutput: `[aiopsterm kubectl] ${command}${output ? `\n${output}` : ''}`,
        success: true,
        error: '',
        durationMs: 1,
        startedAt: '刚刚',
        source: 'resource' as const,
        refreshedResources,
        refreshedNamespaces,
        message: `Kubernetes resources refreshed from backend for ${cluster.name}.`
      })
    }),
    getKubernetesAgentProxyConfig: vi.fn(async () => ({
      ok: true,
      data: {
        proxyConfig: { ...kubernetesCatalogMock.agentProxyConfig },
        message: 'Kubernetes Agent proxy configuration loaded.'
      }
    })),
    saveKubernetesAgentProxyConfig: vi.fn(async (input: Partial<TestKubernetesAgentProxyConfig>) => {
      const enabled = typeof input.enabled === 'boolean' ? input.enabled : kubernetesCatalogMock.agentProxyConfig.enabled
      const enableProxyIdentity =
        typeof input.enableProxyIdentity === 'boolean' ? input.enableProxyIdentity : kubernetesCatalogMock.agentProxyConfig.enableProxyIdentity
      const proxyConfig: TestKubernetesAgentProxyConfig = {
        enabled,
        type: ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5'].includes(input.type || '')
          ? (input.type as TestKubernetesAgentProxyConfig['type'])
          : kubernetesCatalogMock.agentProxyConfig.type,
        host: typeof input.host === 'string' ? input.host.trim() : kubernetesCatalogMock.agentProxyConfig.host,
        port: Math.max(1, Math.min(65535, Number(input.port) || kubernetesCatalogMock.agentProxyConfig.port)),
        enableProxyIdentity,
        username: enableProxyIdentity && typeof input.username === 'string' ? input.username : '',
        password: enableProxyIdentity && typeof input.password === 'string' ? input.password : '',
        updatedAt: '刚刚'
      }
      if (proxyConfig.enabled && !proxyConfig.host) {
        return { ok: false, errorCode: 'K8S_AGENT_PROXY_HOST_REQUIRED', errorMessage: 'Kubernetes Agent proxy host is required.' }
      }
      kubernetesCatalogMock.agentProxyConfig = proxyConfig
      return {
        ok: true,
        data: {
          proxyConfig: { ...proxyConfig },
          message: proxyConfig.enabled ? 'Kubernetes Agent proxy configuration saved.' : 'Kubernetes Agent proxy disabled.'
        }
      }
    }),
    listFileSessionCatalog: vi.fn(async () => fileSessionResultMock(assetFileSessionCatalogMock())),
    saveFileSession: vi.fn(async (session: TestFileSessionInfo) => {
      const normalized = normalizeFileSessionMock(session)
      if (!normalized) return { ok: false, errorCode: 'FILES_SESSION_INVALID', errorMessage: 'File session id, label, host, and rootPath are required.' }
      fileSessionCatalogMock.sessions = fileSessionCatalogMock.sessions.some((item) => item.id === normalized.id)
        ? fileSessionCatalogMock.sessions.map((item) => (item.id === normalized.id ? normalized : item))
        : [...fileSessionCatalogMock.sessions, normalized]
      return fileSessionResultMock({ ...assetFileSessionCatalogMock(), session: { ...normalized } })
    }),
    saveFileSessionFromSftpPayload: vi.fn(async (payload: Record<string, unknown>) => {
      const id = stringFromSftpPayloadMock(payload, ['uuid', 'id', 'assetId', 'host', 'ip'])
      const host = stringFromSftpPayloadMock(payload, ['host', 'ip']) || id
      if (!id || !host) return { ok: false, errorCode: 'FILES_SESSION_PAYLOAD_INVALID', errorMessage: 'SFTP asset payload requires an id or host.' }
      const username = stringFromSftpPayloadMock(payload, ['username', 'user', 'loginName']) || 'deploy'
      const rawAssetType = stringFromSftpPayloadMock(payload, ['asset_type', 'assetType']).toLowerCase()
      const session = normalizeFileSessionMock({
        id,
        label: stringFromSftpPayloadMock(payload, ['title', 'hostname', 'name', 'label']) || host,
        host,
        group: stringFromSftpPayloadMock(payload, ['group', 'group_name', 'organizationName']) || '资产',
        kind: 'remote',
        rootPath: stringFromSftpPayloadMock(payload, ['rootPath', 'homePath', 'cwd']) || (username ? `/home/${username}` : '/home/deploy'),
        status: 'active',
        favorite: false,
        assetType: rawAssetType.includes('organization') ? 'organization' : 'person',
        organizationId: stringFromSftpPayloadMock(payload, ['organizationId', 'orgId', 'organizationUuid']) || undefined,
        jumpHostId: stringFromSftpPayloadMock(payload, ['jumpHostId', 'jump_host_id']) || undefined,
        comment: stringFromSftpPayloadMock(payload, ['comment', 'description']) || undefined
      })
      if (!session) return { ok: false, errorCode: 'FILES_SESSION_INVALID', errorMessage: 'File session id, label, host, and rootPath are required.' }
      fileSessionCatalogMock.sessions = fileSessionCatalogMock.sessions.some((item) => item.id === session.id)
        ? fileSessionCatalogMock.sessions.map((item) => (item.id === session.id ? session : item))
        : [...fileSessionCatalogMock.sessions, session]
      return fileSessionResultMock({ ...assetFileSessionCatalogMock(), session: { ...session } })
    }),
    saveFileSessionFromTerminalContext: vi.fn(async (context: TestFileSessionTerminalContext) => {
      if (context?.kind !== 'ssh') {
        const session = normalizeFileSessionMock({
          id: 'local',
          label: 'Local',
          host: '127.0.0.1',
          group: '本地连接',
          kind: 'local',
          rootPath: terminalContextStringMock(context?.cwd) || '/',
          status: terminalContextStatusMock(context?.panelStatus),
          assetType: 'local'
        })
        if (!session) return { ok: false, errorCode: 'FILES_SESSION_INVALID', errorMessage: 'File session id, label, host, and rootPath are required.' }
        fileSessionCatalogMock.sessions = fileSessionCatalogMock.sessions.some((item) => item.id === session.id)
          ? fileSessionCatalogMock.sessions.map((item) => (item.id === session.id ? session : item))
          : [...fileSessionCatalogMock.sessions, session]
        return fileSessionResultMock({ ...assetFileSessionCatalogMock(), session: { ...session } })
      }
      const ssh = context.ssh || {}
      const assetId = terminalContextStringMock(ssh.assetId)
      const asset = assetId ? assetStoreMock.find((item) => item.id === assetId) : undefined
      const connectionId = terminalContextStringMock(ssh.connectionId || context.sessionId)
      const host = asset?.host || terminalContextStringMock(ssh.host)
      const id = asset?.id || assetId || (connectionId ? `ssh-${connectionId}` : host)
      if (!id || !host) return { ok: false, errorCode: 'FILES_SESSION_TERMINAL_INVALID', errorMessage: 'Terminal file session requires an SSH asset, connection id, or host.' }
      const username = asset?.username || terminalContextStringMock(ssh.username) || 'deploy'
      const session = normalizeFileSessionMock({
        id,
        label: asset?.title || asset?.name || terminalContextStringMock(ssh.assetName) || terminalContextStringMock(context.panelTitle) || host,
        host,
        group: asset?.group_name || asset?.group || terminalContextStringMock(ssh.organizationId) || '终端连接',
        kind: 'remote',
        rootPath: terminalContextStringMock(context.cwd) || (username ? `/home/${username}` : '/home/deploy'),
        status: terminalContextStatusMock(context.panelStatus),
        favorite: typeof asset?.favorite === 'boolean' ? asset.favorite : false,
        assetType: terminalContextAssetTypeMock(asset?.asset_type || ssh.assetType),
        folderUuid: asset?.folderUuid,
        organizationId: asset?.asset_type === 'organization' ? asset.uuid || asset.id : asset?.organizationId || terminalContextStringMock(ssh.organizationId) || undefined,
        jumpHostId: asset?.jumpHostId || terminalContextStringMock(ssh.jumpHostId) || undefined,
        comment: asset?.comment || (terminalContextStringMock(context.panelTitle) ? `Opened from ${context.panelTitle}` : undefined)
      })
      if (!session) return { ok: false, errorCode: 'FILES_SESSION_INVALID', errorMessage: 'File session id, label, host, and rootPath are required.' }
      fileSessionCatalogMock.sessions = fileSessionCatalogMock.sessions.some((item) => item.id === session.id)
        ? fileSessionCatalogMock.sessions.map((item) => (item.id === session.id ? session : item))
        : [...fileSessionCatalogMock.sessions, session]
      return fileSessionResultMock({ ...assetFileSessionCatalogMock(), session: { ...session } })
    }),
    updateFileSession: vi.fn(async (id: string, patch: Partial<Omit<TestFileSessionInfo, 'id'>>) => {
      const session = assetFileSessionCatalogMock().sessions.find((item) => item.id === id)
      if (!session) return { ok: false, errorCode: 'FILES_SESSION_NOT_FOUND', errorMessage: 'File session not found.' }
      const normalized = normalizeFileSessionMock({ ...session, ...patch, id })
      if (!normalized) return { ok: false, errorCode: 'FILES_SESSION_INVALID', errorMessage: 'File session id, label, host, and rootPath are required.' }
      const asset = assetStoreMock.find((item) => item.id === id)
      if (asset && !asset.isLocalShell) {
        assetStoreMock = assetStoreMock.map((item) => {
          if (item.id !== id) return item
          return {
            ...item,
            ...(hasOwn(patch, 'favorite') ? { favorite: patch.favorite } : {}),
            ...(hasOwn(patch, 'comment') ? { comment: patch.comment || '' } : {}),
            ...(hasOwn(patch, 'folderUuid') ? { folderUuid: patch.folderUuid } : {})
          }
        })
      }
      fileSessionCatalogMock.sessions = fileSessionCatalogMock.sessions.map((item) => (item.id === id ? normalized : item))
      if (!fileSessionCatalogMock.sessions.some((item) => item.id === id)) fileSessionCatalogMock.sessions = [...fileSessionCatalogMock.sessions, normalized]
      return fileSessionResultMock({ ...assetFileSessionCatalogMock(), session: { ...normalized } })
    }),
    deleteFileSession: vi.fn(async (id: string) => {
      if (id === 'local') return { ok: false, errorCode: 'FILES_SESSION_LOCAL_REQUIRED', errorMessage: 'Local file session cannot be deleted.' }
      fileSessionCatalogMock.sessions = fileSessionCatalogMock.sessions.filter((session) => session.id !== id)
      return fileSessionResultMock(assetFileSessionCatalogMock())
    }),
    saveFileSessionFolder: vi.fn(async (folder: TestFileSessionFolderSaveInput) => {
      const name = String(folder.name || '').trim()
      if (!name) return { ok: false, errorCode: 'FILES_FOLDER_NAME_REQUIRED', errorMessage: 'Folder name is required.' }
      const existingAssetFolder = folder.uuid ? assetFolderStoreMock.find((item) => item.uuid === folder.uuid) : undefined
      if (existingAssetFolder || folder.scope === 'bastion') {
        const normalized: TestAssetFolder = {
          ...(existingAssetFolder || { uuid: `folder-test-${assetFolderStoreMock.length + 1}`, parentUuid: folder.parentUuid, scope: 'bastion' as const }),
          name,
          description: String(folder.description ?? existingAssetFolder?.description ?? '').trim()
        }
        assetFolderStoreMock = assetFolderStoreMock.some((item) => item.uuid === normalized.uuid)
          ? assetFolderStoreMock.map((item) => (item.uuid === normalized.uuid ? normalized : item))
          : [...assetFolderStoreMock, normalized]
        return fileSessionResultMock({ ...assetFileSessionCatalogMock(), folder: assetFolderToFileFolderMock(normalized) })
      }
      const existing = folder.uuid ? fileSessionCatalogMock.folders.find((item) => item.uuid === folder.uuid) : undefined
      const normalized: TestFileSessionFolderRecord = {
        uuid: existing?.uuid || `files-folder-test-${fileSessionFolderSequenceMock++}`,
        name,
        description: String(folder.description ?? existing?.description ?? '').trim(),
        ...(folder.parentUuid || existing?.parentUuid ? { parentUuid: folder.parentUuid || existing?.parentUuid } : {}),
        ...(folder.scope || existing?.scope ? { scope: folder.scope || existing?.scope } : {})
      }
      fileSessionCatalogMock.folders = fileSessionCatalogMock.folders.some((item) => item.uuid === normalized.uuid)
        ? fileSessionCatalogMock.folders.map((item) => (item.uuid === normalized.uuid ? normalized : item))
        : [...fileSessionCatalogMock.folders, normalized]
      return fileSessionResultMock({ ...assetFileSessionCatalogMock(), folder: { ...normalized } })
    }),
    deleteFileSessionFolder: vi.fn(async (uuid: string) => {
      const folderUuid = String(uuid || '').trim()
      if (!folderUuid) return { ok: false, errorCode: 'FILES_FOLDER_UUID_REQUIRED', errorMessage: 'Folder uuid is required.' }
      if (assetFolderStoreMock.some((folder) => folder.uuid === folderUuid)) {
        assetFolderStoreMock = assetFolderStoreMock
          .filter((folder) => folder.uuid !== folderUuid)
          .map((folder) => (folder.parentUuid === folderUuid ? { ...folder, parentUuid: undefined } : folder))
        assetStoreMock = assetStoreMock.map((asset) => (asset.folderUuid === folderUuid ? { ...asset, folderUuid: undefined } : asset))
        return fileSessionResultMock({ ...assetFileSessionCatalogMock(), folderUuid })
      }
      fileSessionCatalogMock.folders = fileSessionCatalogMock.folders.filter((folder) => folder.uuid !== folderUuid)
      fileSessionCatalogMock.sessions = fileSessionCatalogMock.sessions.map((session) =>
        session.folderUuid === folderUuid ? { ...session, folderUuid: undefined, group: '最近连接' } : session
      )
      return fileSessionResultMock({ ...assetFileSessionCatalogMock(), folderUuid })
    }),
    listFiles: vi.fn(async (directory: string, options?: { kind?: 'local' | 'remote' }) => {
      const dir = normalizeFileDirMock(directory)
      ensureFileDirMock(dir)
      return [
        ...(options?.kind === 'remote' && dir !== '/'
          ? [{ name: '..', path: dirnameFileMock(dir), type: 'directory' as const, size: 0, modifiedAt: Date.now(), mode: 'drwxr-xr-x' }]
          : []),
        ...fileEntriesMock.filter((entry) => dirnameFileMock(entry.path) === dir).map((entry) => ({ ...entry }))
      ]
    }),
    mutateFileEntry: vi.fn(async (mutation: any, options?: any) => {
      if (mutation.kind === 'rename') {
        const oldPath = normalizeFileDirMock(mutation.oldPath)
        const newPath = normalizeFileDirMock(mutation.newPath)
        const entry = fileEntriesMock.find((item) => item.path === oldPath)
        if (!entry) return { ok: false, errorCode: 'not_found', errorMessage: 'File entry not found' }
        entry.name = basenameFileMock(newPath)
        entry.path = newPath
        entry.modifiedAt = Date.now()
        return { ok: true, data: { affected: 1, path: newPath, mtimeMs: entry.modifiedAt } }
      }
      if (mutation.kind === 'delete') {
        const path = normalizeFileDirMock(mutation.path)
        const before = fileEntriesMock.length
        fileEntriesMock = fileEntriesMock.filter((entry) => entry.path !== path && !entry.path.startsWith(`${path}/`))
        return {
          ok: true,
          data: {
            affected: before - fileEntriesMock.length,
            path,
            mtimeMs: Date.now(),
            task: createFileTransferTaskMock({
              type: 'r2r',
              name: `delete ${basenameFileMock(path)}`,
              source: path,
              target: dirnameFileMock(path),
              progress: 100,
              speed: '完成',
              status: 'success',
              ...fileTransferTaskHostsMock(options)
            })
          }
        }
      }
      if (mutation.kind === 'copy' || mutation.kind === 'move') {
        const srcPath = normalizeFileDirMock(mutation.srcPath)
        const targetPath = normalizeFileDirMock(mutation.targetPath)
        if (srcPath === targetPath) {
          return {
            ok: true,
            data: {
              affected: 0,
              path: targetPath,
              mtimeMs: Date.now(),
              task: createFileTransferTaskMock({
                type: 'r2r',
                name: basenameFileMock(targetPath),
                source: srcPath,
                target: targetPath,
                progress: 100,
                speed: '完成',
                status: 'success',
                ...fileTransferTaskHostsMock(options)
              })
            }
          }
        }
        const entry = fileEntriesMock.find((item) => item.path === srcPath)
        if (!entry) return { ok: false, errorCode: 'not_found', errorMessage: 'File entry not found' }
        fileEntriesMock = fileEntriesMock.filter((item) => item.path !== targetPath && !item.path.startsWith(`${targetPath}/`))
        const copied = { ...entry, name: basenameFileMock(targetPath), path: targetPath, modifiedAt: Date.now() }
        fileEntriesMock.push(copied)
        if (mutation.kind === 'move') {
          fileEntriesMock = fileEntriesMock.filter((item) => item.path !== srcPath && !item.path.startsWith(`${srcPath}/`))
        }
        return {
          ok: true,
          data: {
            affected: 1,
            path: targetPath,
            mtimeMs: copied.modifiedAt,
            task: createFileTransferTaskMock({
              type: 'r2r',
              name: basenameFileMock(targetPath),
              source: srcPath,
              target: targetPath,
              progress: 100,
              speed: '完成',
              status: 'success',
              ...fileTransferTaskHostsMock(options)
            })
          }
        }
      }
      if (mutation.kind === 'chmod') {
        const path = normalizeFileDirMock(mutation.path)
        const entry = fileEntriesMock.find((item) => item.path === path)
        if (!entry) return { ok: false, errorCode: 'not_found', errorMessage: 'File entry not found' }
        const prefix = entry.type === 'directory' ? 'd' : entry.type === 'link' ? 'l' : '-'
        entry.mode = `${prefix}${String(mutation.mode).slice(-3)}`
        entry.modifiedAt = Date.now()
        return {
          ok: true,
          data: {
            affected: 1,
            path,
            mode: String(mutation.mode).slice(-3),
            mtimeMs: entry.modifiedAt,
            task: createFileTransferTaskMock({
              type: 'r2r',
              name: `chmod ${basenameFileMock(path)}`,
              source: path,
              target: mutation.recursive ? 'recursive permissions' : 'permissions',
              progress: 100,
              speed: '完成',
              status: 'success',
              ...fileTransferTaskHostsMock(options)
            })
          }
        }
      }
      return { ok: false, errorCode: 'unsupported', errorMessage: 'Unsupported file mutation' }
    }),
    transferFileEntry: vi.fn(async (operation: any, options?: any) => {
      if (operation.kind === 'copy-remote') {
        const sourcePath = normalizeFileDirMock(operation.remotePath)
        const targetPath = normalizeFileDirMock(operation.targetPath)
        const entry = fileEntriesMock.find((item) => item.path === sourcePath)
        if (entry) {
          fileEntriesMock.push({ ...entry, name: basenameFileMock(targetPath), path: targetPath, modifiedAt: Date.now() })
        }
        const mtimeMs = Date.now()
        const task = createFileTransferTaskMock({
          type: 'r2r',
          name: basenameFileMock(sourcePath),
          source: operation.remotePath,
          target: operation.targetPath,
          progress: 100,
          speed: '完成',
          status: 'success',
          fromHost: options?.fromHost || options?.host,
          toHost: options?.toHost || options?.host
        })
        return {
          ok: true,
          data: {
            status: 'success' as const,
            source: operation.remotePath,
            target: operation.targetPath,
            bytes: 128,
            files: 1,
            mtimeMs,
            task
          }
        }
      }
      if (operation.kind === 'download-file') {
        const mtimeMs = Date.now()
        const task = createFileTransferTaskMock({
          type: 'download',
          name: basenameFileMock(operation.remotePath),
          source: operation.remotePath,
          target: operation.localPath,
          progress: 100,
          speed: '完成',
          status: 'success',
          fromHost: options?.fromHost || options?.host,
          ...(options?.toHost ? { toHost: options.toHost } : {})
        })
        return {
          ok: true,
          data: {
            status: 'success' as const,
            source: operation.remotePath,
            target: operation.localPath,
            bytes: 128,
            files: 1,
            mtimeMs,
            task
          }
        }
      }
      if (operation.kind === 'download-directory') {
        const sourcePath = normalizeFileDirMock(operation.remotePath)
        const target = `${normalizeFileDirMock(operation.localDirectory)}/${basenameFileMock(sourcePath)}`.replace(/\/+/g, '/')
        const mtimeMs = Date.now()
        const task = createFileTransferTaskMock({
          type: 'download',
          name: basenameFileMock(sourcePath),
          source: operation.remotePath,
          target,
          progress: 100,
          speed: '完成',
          status: 'success',
          fromHost: options?.fromHost || options?.host,
          ...(options?.toHost ? { toHost: options.toHost } : {}),
          stage: 'scanning',
          isGroup: true,
          totalFiles: 1,
          finishedFiles: 1,
          children: [
            createFileTransferTaskMock({
              type: 'download',
              name: 'downloaded-file',
              source: `${sourcePath}/downloaded-file`.replace(/\/+/g, '/'),
              target: `${target}/downloaded-file`.replace(/\/+/g, '/'),
              progress: 100,
              speed: '完成',
              status: 'success',
              fromHost: options?.fromHost || options?.host,
              ...(options?.toHost ? { toHost: options.toHost } : {}),
              stage: 'pending'
            })
          ]
        })
        return {
          ok: true,
          data: {
            status: 'success' as const,
            source: operation.remotePath,
            target,
            bytes: 128,
            files: 1,
            mtimeMs,
            itemKind: 'directory' as const,
            task
          }
        }
      }
      const localPath = normalizeFileDirMock(operation.localPath)
      const remoteDirectory = normalizeFileDirMock(operation.remoteDirectory)
      const name = basenameFileMock(localPath)
      const path = `${remoteDirectory}/${name}`.replace(/\/+/g, '/')
      const isDirectory = operation.kind === 'upload-directory' || (operation.kind === 'upload-path' && !name.includes('.'))
      fileEntriesMock.push({
        name,
        path,
        type: isDirectory ? 'directory' : 'file',
        size: isDirectory ? 0 : 128,
        modifiedAt: Date.now(),
        mode: isDirectory ? 'drwxr-xr-x' : '-rw-r--r--'
      })
      return {
        ok: true,
        data: {
          status: 'success' as const,
          source: operation.localPath,
          target: path,
          bytes: isDirectory ? 0 : 128,
          files: 1,
          mtimeMs: Date.now(),
          itemKind: isDirectory ? ('directory' as const) : ('file' as const),
          task: createFileTransferTaskMock({
            type: 'upload',
            name,
            source: operation.localPath,
            target: path,
            progress: 100,
            speed: '完成',
            status: 'success',
            ...(options?.fromHost ? { fromHost: options.fromHost } : {}),
            toHost: options?.toHost || options?.host,
            stage: isDirectory ? 'scanning' : 'pending',
            isGroup: isDirectory,
            totalFiles: 1,
            finishedFiles: 1
          })
        }
      }
    }),
    cancelFileTransferTask: vi.fn(async (input: any) => {
      const id = String(input?.id || '').trim()
      if (!id) return { ok: false, errorCode: 'FILES_TRANSFER_TASK_ID_REQUIRED', errorMessage: 'File transfer task id is required.' }
      const parent = fileTransferTasksMock.find((task) => task.id === id)
      const childParent = fileTransferTasksMock.find((task) => task.children?.some((child: any) => child.id === id))
      const task = parent || childParent
      if (!task) return { ok: true, data: { id, taskIds: [], status: 'not_found' as const } }
      const taskIds = [task.id, ...(task.children || []).map((child: any) => child.id)]
      fileTransferTasksMock = fileTransferTasksMock.filter((item) => !taskIds.includes(item.id))
      return { ok: true, data: { id, taskIds, status: 'aborted' as const } }
    }),
    listFileTransferTasks: vi.fn(async () => fileTransferTasksMock.map((task) => ({ ...task, children: task.children?.map((child: any) => ({ ...child })) }))),
    invokeControlRequest: vi.fn(async () => ({ ok: true, data: {} })),
    respondControlRequest: vi.fn(async () => undefined),
    onControlRequest: vi.fn(() => () => undefined),
    onTerminalData: vi.fn(() => () => undefined),
    onTerminalLifecycle: vi.fn(() => () => undefined),
    onTerminalExit: vi.fn(() => () => undefined),
    publishAiAgentSessionEvent: vi.fn(async (input: any) => {
      const event: AiAgentSessionEvent = {
        source: input.source === 'claude' ? 'claude-code' : input.source || 'codex',
        event: input.event || input.hookEventName || 'notification',
        sessionId: input.sessionId || input.session_id || 'ai-session-test',
        title: input.title || 'AI session',
        summary: input.summary || input.message || '',
        receivedAt: input.receivedAt || Date.now(),
        ...(input.panelId ? { panelId: input.panelId } : {}),
        ...(input.terminalSessionId ? { terminalSessionId: input.terminalSessionId } : {})
      }
      aiAgentSessionEventListeners.forEach((listener) => listener(event))
      return { ok: true, data: event }
    }),
    onAiAgentSessionEvent: vi.fn((listener: (event: AiAgentSessionEvent) => void) => {
      aiAgentSessionEventListeners.add(listener)
      return () => {
        aiAgentSessionEventListeners.delete(listener)
      }
    }),
    onManagedAiSessionEvent: vi.fn((listener: (event: ManagedAiSessionEvent) => void) => {
      managedAiSessionEventListeners.add(listener)
      return () => {
        managedAiSessionEventListeners.delete(listener)
      }
    }),
    onCodexSessionData: vi.fn(() => () => undefined),
    onCodexSessionLifecycle: vi.fn(() => () => undefined),
    onCodexSessionExit: vi.fn(() => () => undefined),
    onTerminalKeyboardInteractiveRequest: vi.fn((listener: (event: TerminalKeyboardInteractiveRequest) => void) => {
      terminalKeyboardInteractiveRequestListeners.add(listener)
      return () => {
        terminalKeyboardInteractiveRequestListeners.delete(listener)
      }
    }),
    onTerminalKeyboardInteractiveResult: vi.fn((listener: (event: TerminalKeyboardInteractiveResult) => void) => {
      terminalKeyboardInteractiveResultListeners.add(listener)
      return () => {
        terminalKeyboardInteractiveResultListeners.delete(listener)
      }
    })
  }
})
