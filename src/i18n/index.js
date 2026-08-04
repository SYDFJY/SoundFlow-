// 轻量 i18n(自研,不引第三方依赖)
// 用法:import { t, setLang } from '@/i18n'
//   模板:{{ t('nav.home') }}   JS:t('toast.saved')
import { reactive } from 'vue'
import zh from './zh'
import en from './en'

const dicts = { zh, en }
export const i18n = reactive({ lang: 'zh' })

export function t(key, params) {
  const dict = dicts[i18n.lang] || zh
  let s = dict[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return s
}

export function setLang(lang) {
  if (dicts[lang]) i18n.lang = lang
  try { localStorage.setItem('soundflow_language', lang) } catch {}
}
