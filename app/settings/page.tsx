'use client'

import { useLang } from '@/services/i18n'
import { useState, useEffect } from 'react'
import type { CSSProperties } from 'react'
import type { ApiFormat } from '@/services/types'
import { VideoDeploymentSettings } from '@/components/video-annotation/VideoDeploymentSettings'
import { VideoSemanticApiSettings } from '@/components/video-annotation/VideoSemanticApiSettings'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { SlidingControl } from '@/components/ui'
import styles from './settings.module.css'

const PROVIDERS = [
  { name: 'DeepSeek (Anthropic)', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-chat', apiFormat: 'anthropic' as ApiFormat },
  { name: 'DeepSeek (OpenAI)', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiFormat: 'openai' as ApiFormat },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiFormat: 'openai' as ApiFormat },
  { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514', apiFormat: 'anthropic' as ApiFormat },
  { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3', apiFormat: 'openai' as ApiFormat },
]

type SettingsSection = 'synthetic' | 'semantic' | 'deployment'

export default function SettingsPage() {
  const { t } = useLang()
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com/anthropic')
  const [model, setModel] = useState('deepseek-chat')
  const [apiFormat, setApiFormat] = useState<ApiFormat>('anthropic')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [llmConfigured, setLlmConfigured] = useState(false)
  const [configAvailable, setConfigAvailable] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null)
  const [testError, setTestError] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<SettingsSection>('synthetic')
  const [semanticMode, setSemanticMode] = useState<'local' | 'remote' | null>(null)
  const [deploymentMode, setDeploymentMode] = useState<'standard' | 'enhanced' | null>(null)

  useEffect(() => {
    fetch('/api/llm/config')
      .then(response => {
        if (!response.ok) throw new Error('Configuration service unavailable')
        return response.json()
      })
      .then(data => {
        setConfigAvailable(true)
        setLlmConfigured(Boolean(data.configured))
        if (data.configured) {
          setBaseUrl(data.baseUrl)
          setModel(data.model)
          setApiFormat(data.apiFormat)
          setHasApiKey(data.hasApiKey)
        }
      })
      .catch(() => setConfigAvailable(false))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    let cancelled = false

    void fetch('/api/video-annotation/semantic/config', { cache: 'no-store' })
      .then(response => response.ok ? response.json() as Promise<{ mode?: 'local' | 'remote' }> : null)
      .then(payload => {
        if (!cancelled && payload?.mode) setSemanticMode(payload.mode)
      })
      .catch(() => undefined)

    void fetch('/api/video-annotation/deployment', { cache: 'no-store' })
      .then(response => response.ok ? response.json() as Promise<{ mode?: 'standard' | 'enhanced' }> : null)
      .then(payload => {
        if (!cancelled && payload?.mode) setDeploymentMode(payload.mode)
      })
      .catch(() => undefined)

    return () => { cancelled = true }
  }, [])

  const buildConfig = () => ({
    apiKey: apiKey.trim() || undefined,
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    apiFormat,
  })

  const saveConfig = async (overrides?: Partial<ReturnType<typeof buildConfig>>) => {
    const cfg = { ...buildConfig(), ...overrides }
    const res = await fetch('/api/llm/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    })
    if (res.ok) {
      if (cfg.apiKey) setHasApiKey(true)
      setConfigAvailable(true)
      setLlmConfigured(true)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    setTestError('')
    try {
      await saveConfig()
      const res = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt: 'Reply with only the word "OK".',
          userPrompt: 'Ping',
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setTestResult('success')
      } else {
        setTestResult('fail')
        setTestError(data.error || `${t('settings.request_fail')} (${res.status})`)
      }
    } catch {
      setTestResult('fail')
      setTestError(t('settings.network_fail'))
    }
    setTesting(false)
  }

  const endpointPath = apiFormat === 'anthropic' ? '/messages' : '/chat/completions'

  const sections = [
    { id: 'synthetic' as const, label: t('settings.nav_synthetic'), description: t('settings.nav_synthetic_desc') },
    { id: 'semantic' as const, label: t('settings.nav_semantic'), description: t('settings.nav_semantic_desc') },
    { id: 'deployment' as const, label: t('settings.nav_deployment'), description: t('settings.nav_deployment_desc') },
  ]
  const activeSectionIndex = sections.findIndex(section => section.id === activeSection)
  const activeMeta = sections[activeSectionIndex] ?? sections[0]
  const navStyle = { '--settings-index': activeSectionIndex } as CSSProperties

  if (loading) return (
    <div className={styles.page} aria-busy="true">
      <WorkspaceHeader />
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <div className={styles.pageCopy}>
            <div className={styles.skeletonTitle} />
            <div className={styles.skeletonText} />
          </div>
        </header>
        <div className={styles.settingsWorkbench}>
          <aside className={styles.settingsRail}>
            <div className={styles.railHeading}><div className={styles.skeletonLabel} /><div className={styles.skeletonRailText} /></div>
            <div className={styles.skeletonRailNav} />
          </aside>
          <section className={styles.settingsCanvas}>
            <div className={styles.settingsCanvasBar}><div className={styles.skeletonLabel} /></div>
            <div className={styles.settingsLoading}><div className={styles.skeletonCard} /></div>
          </section>
        </div>
      </main>
    </div>
  )

  return (
    <div className={styles.page}>
      <WorkspaceHeader />

      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <div className={styles.pageCopy}>
            <h1 className={styles.pageTitle}>{t('settings.title')}</h1>
            <p className={styles.pageDescription}>{t('settings.description')}</p>
          </div>
          <span className={styles.serviceStatus} data-tone={configAvailable ? 'success' : 'danger'}><i aria-hidden="true" />{configAvailable ? t('settings.local_config_available') : t('settings.config_unavailable')}</span>
        </header>

        <div className={styles.settingsWorkbench}>
          <aside className={styles.settingsRail}>
            <div className={styles.railHeading}>
              <strong>{t('settings.directory')}</strong>
              <small>{t('settings.directory_hint')}</small>
            </div>
            <nav className={styles.sectionNav} aria-label={t('settings.title')} aria-orientation="vertical" role="tablist" style={navStyle}>
              <span className={styles.navIndicator} aria-hidden="true" />
              {sections.map(section => (
                <button
                  id={`settings-tab-${section.id}`}
                  key={section.id}
                  type="button"
                  aria-selected={activeSection === section.id}
                  aria-controls={`settings-panel-${section.id}`}
                  role="tab"
                  onClick={() => setActiveSection(section.id)}
                >
                  <strong>{section.label}</strong>
                  <small>{section.description}</small>
                </button>
              ))}
            </nav>
            <dl className={styles.railStatus}>
              <div><dt>{t('settings.nav_synthetic_short')}</dt><dd>{llmConfigured ? t('settings.available') : t('settings.not_configured')}</dd></div>
              <div><dt>{t('settings.nav_semantic_short')}</dt><dd>{semanticMode ? t(`semantic.${semanticMode}`) : '—'}</dd></div>
              <div><dt>{t('settings.nav_deployment_short')}</dt><dd>{deploymentMode ? t(`deployment.${deploymentMode}`) : '—'}</dd></div>
            </dl>
          </aside>

          <section className={styles.settingsCanvas}>
            <header className={styles.settingsCanvasBar}>
              <div><span>{t('settings.current_config')}</span><strong>{activeMeta.label}</strong></div>
              <small>{activeMeta.description} · {t('settings.switch_hint')}</small>
            </header>

            <div className={styles.settingsCanvasBody}>
              <div id="settings-panel-synthetic" role="tabpanel" aria-labelledby="settings-tab-synthetic" hidden={activeSection !== 'synthetic'}>
                <section className={styles.settingsSection} aria-busy={testing}>
                  <header className={styles.sectionHeader}>
                    <div><h2>{t('settings.llm_section')}</h2><p>{t('settings.llm_description')}</p></div>
                    <span className={styles.statusLabel} data-tone={llmConfigured ? 'success' : 'warning'}>{llmConfigured ? t('settings.connected') : t('settings.not_configured')}</span>
                  </header>

                  <div className={styles.settingsFormGrid}>
                    <fieldset className={styles.settingsWideField}>
                      <legend>{t('settings.select_provider')}</legend>
                      <SlidingControl
                        value={baseUrl}
                        options={PROVIDERS.map(provider => ({ value: provider.baseUrl, label: provider.name }))}
                        onChange={nextBaseUrl => {
                          const provider = PROVIDERS.find(item => item.baseUrl === nextBaseUrl)
                          if (!provider) return
                          setBaseUrl(provider.baseUrl)
                          setModel(provider.model)
                          setApiFormat(provider.apiFormat)
                          void saveConfig({ baseUrl: provider.baseUrl, model: provider.model, apiFormat: provider.apiFormat })
                        }}
                        label={t('settings.select_provider')}
                        className={styles.settingsSlider}
                      />
                    </fieldset>

                    <fieldset className={styles.settingsWideField}>
                      <legend>{t('settings.api_format')}</legend>
                      <SlidingControl
                        value={apiFormat}
                        options={([
                          { value: 'anthropic' as ApiFormat, label: t('settings.format_anthropic') },
                          { value: 'openai' as ApiFormat, label: t('settings.format_openai') },
                        ])}
                        onChange={format => { setApiFormat(format); void saveConfig({ apiFormat: format }) }}
                        label={t('settings.api_format')}
                        className={styles.settingsSlider}
                      />
                    </fieldset>

                    <label className={styles.field} htmlFor="synthetic-llm-api-key">
                      <span>{t('settings.api_key')}</span>
                      <input id="synthetic-llm-api-key" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={hasApiKey ? t('settings.api_key_saved') : 'sk-...'} aria-describedby="synthetic-llm-api-key-hint" autoComplete="off" spellCheck={false} />
                      <small id="synthetic-llm-api-key-hint">{hasApiKey ? t('settings.key_saved_hint') : t('settings.key_not_saved_hint')}</small>
                    </label>

                    <label className={styles.field} htmlFor="synthetic-llm-model">
                      <span>{t('settings.model')}</span>
                      <input id="synthetic-llm-model" type="text" value={model} onChange={event => setModel(event.target.value)} spellCheck={false} />
                    </label>

                    <label className={`${styles.field} ${styles.settingsWideField}`} htmlFor="synthetic-llm-base-url">
                      <span>{t('settings.base_url')}</span>
                      <input id="synthetic-llm-base-url" type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} aria-describedby="synthetic-llm-base-url-hint" spellCheck={false} />
                      <small id="synthetic-llm-base-url-hint">{t('settings.request_url')} <code className={styles.endpoint}>{baseUrl.replace(/\/$/, '')}{endpointPath}</code></small>
                    </label>
                  </div>

                  {testResult === 'success' && <p className={styles.notice} data-tone="success" role="status" aria-live="polite">{t('settings.test_success')}</p>}
                  {testResult === 'fail' && <div className={styles.notice} data-tone="danger" role="alert">{testError || t('settings.test_fail')}<small>{baseUrl.replace(/\/$/, '')}{endpointPath}</small></div>}

                  <footer className={styles.actions}>
                    <button type="button" onClick={handleTest} disabled={testing || (!apiKey.trim() && !hasApiKey)} className="btn-outline">{testing ? t('app.testing') : t('settings.test_btn')}</button>
                    <button type="button" onClick={() => saveConfig()} className="btn-primary">{saved ? t('settings.saved') : t('settings.save_btn')}</button>
                  </footer>
                </section>
              </div>

              <div id="settings-panel-semantic" className={styles.embeddedPanel} role="tabpanel" aria-labelledby="settings-tab-semantic" hidden={activeSection !== 'semantic'}>
                <VideoSemanticApiSettings onModeChange={setSemanticMode} />
              </div>

              <div id="settings-panel-deployment" className={styles.embeddedPanel} role="tabpanel" aria-labelledby="settings-tab-deployment" hidden={activeSection !== 'deployment'}>
                <VideoDeploymentSettings onModeChange={setDeploymentMode} />
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
