import {
  isKnowledgeRelPathInParentWithRequestedName,
  isKnowledgeWriteResultData,
  malformedKnowledgeBackendResultMessage
} from '@/services/knowledge/knowledgeBackendGuards'
import { knowledgeClient } from '@/services/knowledge/knowledgeClient'
import { plainTextFromAiContentParts } from '@/services/ai/aiPanelInputRuntime'
import type { KnowledgeBaseCreateResult, KnowledgeNode } from '@shared/contracts/knowledgeBase'
import type { ChatMessage, WorkspaceAiChatControllerState } from '@/services/ai/workspaceAiChatTypes'

export const messagePlainText = (message: ChatMessage) =>
  message.contentParts?.length ? plainTextFromAiContentParts(message.contentParts, { mode: 'exchange' }).trim() : message.text.trim()

const messageSummaryContent = (message: ChatMessage) => {
  const body = messagePlainText(message)
  const hosts = message.hosts?.length ? `\n\nHosts: ${message.hosts.map((host) => host.label).join(', ')}` : ''
  return `# AI Message Summary\n\nRole: ${message.role}\nMessage ID: ${message.id}\n\n${body}${hosts}\n`
}

const knowledgeFileNameForMessage = (message: ChatMessage) => {
  const safeId = message.id.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'message'
  return `ai-message-${safeId}.md`
}

const alphaSuffix = (index: number) => {
  let value = index
  let suffix = ''
  do {
    suffix = String.fromCharCode(97 + (value % 26)) + suffix
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return suffix
}

export const createWorkspaceAiChatSummaryRuntime = (input: {
  state: Pick<WorkspaceAiChatControllerState, 'chatMessages' | 'kbSelectedKeys' | 'settingsSkills'>
  setTopNotice: (message: string) => void
  findKnowledgeNode: (relPath: string) => KnowledgeNode | null
  backendKnowledgeEntryOrNotice: (result: unknown, notice: string) => KnowledgeBaseCreateResult | null
  uniqueKnowledgeFileName: (parentRelDir: string, name: string) => string
  refreshKnowledgeTree: () => Promise<boolean>
  openKnowledgeFile: (relPath: string) => void
  createSkill: (
    skill: { name: string; description: string; content: string },
    options?: { closeModal?: boolean; duplicateNotice?: boolean; successNotice?: string | false }
  ) => Promise<{ name: string } | null>
}) => {
  const {
    state,
    setTopNotice,
    findKnowledgeNode,
    backendKnowledgeEntryOrNotice,
    uniqueKnowledgeFileName,
    refreshKnowledgeTree,
    openKnowledgeFile,
    createSkill
  } = input
  const { chatMessages, kbSelectedKeys, settingsSkills } = state

  const ensureLocalKnowledgeDir = async (title: string) => {
    const relPath = title
    const existing = findKnowledgeNode(relPath)
    if (existing?.type === 'dir') return existing
    const kbMkdir = knowledgeClient.kbMkdir()
    if (!kbMkdir) {
      setTopNotice('知识库写入服务不可用')
      return null
    }
    const result = await kbMkdir('', title)
    const entry = backendKnowledgeEntryOrNotice(result, malformedKnowledgeBackendResultMessage)
    if (!entry) return null
    const createdRelPath = entry.relPath.trim()
    if (createdRelPath !== relPath) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    if (entry.type !== 'dir') {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return null
    const created = findKnowledgeNode(relPath)
    return created?.type === 'dir' ? created : null
  }

  const summarizeMessageToKnowledge = async (messageId: string) => {
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!message) return null
    const content = messageSummaryContent(message)
    const summaryDir = await ensureLocalKnowledgeDir('summary')
    if (!summaryDir) return null
    const fileName = uniqueKnowledgeFileName('summary', knowledgeFileNameForMessage(message))
    const kbCreateFile = knowledgeClient.kbCreateFile()
    const kbWriteFile = knowledgeClient.kbWriteFile()
    if (!kbCreateFile || !kbWriteFile) {
      setTopNotice('知识库写入服务不可用')
      return null
    }
    const result = await kbCreateFile('summary', fileName, content)
    const entry = backendKnowledgeEntryOrNotice(result, malformedKnowledgeBackendResultMessage)
    if (!entry) return null
    const relPath = entry.relPath.trim()
    if (!isKnowledgeRelPathInParentWithRequestedName(relPath, 'summary', fileName) || entry.type !== 'file') {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    const writeResult = await kbWriteFile(relPath, content)
    if (!isKnowledgeWriteResultData(writeResult) || writeResult.relPath.trim() !== relPath) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return null
    const created = findKnowledgeNode(relPath)
    if (!created || created.type !== 'file') {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }

    kbSelectedKeys.value = [relPath]
    openKnowledgeFile(relPath)
    return { relPath, content }
  }

  const skillNameForMessage = (message: ChatMessage) => {
    const words = messagePlainText(message)
      .toLowerCase()
      .match(/[a-z]+/g)
      ?.filter((word) => word.length > 2)
      .slice(0, 3)
    const rawBase = words?.length ? `${words.join('-')}-skill` : 'ai-message-skill'
    let candidate = rawBase.replace(/[^a-z-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'ai-message-skill'
    let index = 0
    while (settingsSkills.value.some((skill) => skill.name === candidate)) {
      candidate = `${rawBase}-${alphaSuffix(index)}`
      index += 1
    }
    return candidate
  }

  const summarizeMessageToSkill = async (messageId: string) => {
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!message) return null
    const name = skillNameForMessage(message)
    const plainText = messagePlainText(message)
    const skill = {
      name,
      description: `Summarized from AI message ${message.id}`,
      content: `Use this runbook when a similar operations context appears.\n\nSource message:\n${plainText}`,
      enabled: true,
      editable: true
    }
    return createSkill(skill, { successNotice: false })
  }

  return {
    summarizeMessageToKnowledge,
    summarizeMessageToSkill
  }
}
