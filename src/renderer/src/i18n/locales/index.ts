import type { LocaleMessages, SupportedLocale } from '../messages'
import { arAR } from './arAR'
import { deDE } from './deDE'
import { enUS } from './enUS'
import { frFR } from './frFR'
import { itIT } from './itIT'
import { jaJP } from './jaJP'
import { koKR } from './koKR'
import { ptPT } from './ptPT'
import { ruRU } from './ruRU'
import { zhCN } from './zhCN'
import { zhTW } from './zhTW'

export const localeMessages: Record<SupportedLocale, LocaleMessages> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'de-DE': deDE,
  'fr-FR': frFR,
  'it-IT': itIT,
  'pt-PT': ptPT,
  'ru-RU': ruRU,
  'ar-AR': arAR
}
