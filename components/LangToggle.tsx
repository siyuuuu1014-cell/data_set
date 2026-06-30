'use client'

import { useLang } from '@/services/i18n'

export function LangToggle() {
  const { lang, setLang, t } = useLang()

  return (
    <button
      onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
      className="px-3 py-1.5 rounded-full text-xs font-medium tracking-wide bg-gv-surface/80 backdrop-blur border border-gv-border text-gv-text-dim hover:text-gv-pink hover:border-gv-pink/50 transition-all duration-200"
      title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
    >
      {t('lang.switch')}
    </button>
  )
}
