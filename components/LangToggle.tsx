'use client'

import { usePathname } from 'next/navigation'
import { useLang } from '@/services/i18n'

type LangToggleProps = {
  className?: string
  hideOnHome?: boolean
}

export function LangToggle({ className, hideOnHome = false }: LangToggleProps) {
  const { lang, setLang, t } = useLang()
  const pathname = usePathname()

  if (hideOnHome && pathname === '/') return null

  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
      className={className ?? 'px-3 py-1.5 rounded-full text-xs font-medium tracking-wide bg-gv-surface/80 backdrop-blur border border-gv-border text-gv-text-dim hover:text-gv-pink hover:border-gv-pink/50 transition-all duration-200'}
      title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
      aria-label={lang === 'zh' ? 'Switch to English' : '切换到中文'}
    >
      {t('lang.switch')}
    </button>
  )
}
