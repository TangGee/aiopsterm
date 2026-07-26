import { Converter } from 'opencc-js/cn2t'
import type { LocaleMessages } from './messages'

const convertToTraditionalChinese = Converter({ from: 'cn', to: 'twp' })

export const toTraditionalChinese = (value: string) => convertToTraditionalChinese(value)

export const toTraditionalChineseMessages = (messages: LocaleMessages): LocaleMessages =>
  Object.fromEntries(
    Object.entries(messages).map(([key, value]) => [key, toTraditionalChinese(value)])
  ) as LocaleMessages
