import type { AiChatResponseInput, AiContentPart, AiContextOption } from '@shared/contracts/aiChat'

export type K8sSendChat = (
  text: string,
  contentParts?: AiContentPart[],
  overrideHosts?: AiContextOption[],
  options?: {
    mode?: NonNullable<AiChatResponseInput['mode']>
    skipKnowledgeSearch?: boolean
  }
) => Promise<boolean> | boolean
