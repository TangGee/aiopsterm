import type { LocaleMessages } from '../messages'
import { enUS } from './enUS'

export const completeLocaleMessages = (overrides: Partial<LocaleMessages>, base: LocaleMessages = enUS): LocaleMessages => ({
  ...base,
  ...overrides
})
