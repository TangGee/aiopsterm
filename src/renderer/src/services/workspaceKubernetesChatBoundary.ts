import type { AiContentPart, AiContextOption } from '@shared/contracts/aiChat'

export type K8sSendChat = (
  text: string,
  contentParts?: AiContentPart[],
  overrideHosts?: AiContextOption[],
  options?: { skipKnowledgeSearch?: boolean }
) => Promise<boolean> | boolean
