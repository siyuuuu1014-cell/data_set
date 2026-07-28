'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ApiFormat } from '@/services/types'
import { useLang } from '@/services/i18n'
import type {
  PublicVideoSemanticConfig,
  VideoSemanticMode,
} from '@/services/video-annotation/remote-semantic-config'

const EMPTY_CONFIG: PublicVideoSemanticConfig = {
  mode: 'local',
  baseUrl: '',
  model: '',
  apiFormat: 'openai',
  hasApiKey: false,
  configured: true,
}

export function VideoSemanticApiSettings() {
  const { t } = useLang()
  const [config, setConfig] = useState(EMPTY_CONFIG)
  const [mode, setMode] = useState<VideoSemanticMode>('local')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiFormat, setApiFormat] = useState<ApiFormat>('openai')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null)
  const [error, setError] = useState('')

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/video-annotation/semantic/config', { cache: 'no-store' })
      const payload = await response.json() as PublicVideoSemanticConfig & { error?: string }
      if (!response.ok) throw new Error(payload.error || t('semantic.load_failed'))
      setConfig(payload)
      setMode(payload.mode)
      setBaseUrl(payload.baseUrl)
      setModel(payload.model)
      setApiFormat(payload.apiFormat)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('semantic.load_failed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    const timer = window.setTimeout(loadConfig, 0)
    return () => window.clearTimeout(timer)
  }, [loadConfig])

  const saveConfig = async (): Promise<boolean> => {
    setSaving(true)
    setSaved(false)
    setTestResult(null)
    setError('')
    try {
      const response = await fetch('/api/video-annotation/semantic/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          apiFormat,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      })
      const payload = await response.json() as PublicVideoSemanticConfig & { error?: string }
      if (!response.ok) throw new Error(payload.error || t('semantic.save_failed'))
      setConfig(payload)
      setMode(payload.mode)
      setBaseUrl(payload.baseUrl)
      setModel(payload.model)
      setApiFormat(payload.apiFormat)
      setApiKey('')
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
      return true
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('semantic.save_failed'))
      return false
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    setError('')
    try {
      const response = await fetch('/api/video-annotation/semantic/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'remote',
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          apiFormat,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      })
      const payload = await response.json() as { status?: string; error?: string }
      if (!response.ok || payload.status !== 'ok') {
        throw new Error(payload.error || t('semantic.test_failed'))
      }
      setTestResult('success')
    } catch (testError) {
      setTestResult('fail')
      setError(testError instanceof Error ? testError.message : t('semantic.test_failed'))
    } finally {
      setTesting(false)
    }
  }

  const endpointPath = apiFormat === 'anthropic' ? '/messages' : '/chat/completions'

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-semibold text-gv-text">{t('semantic.title')}</h2>
          <p className="text-sm text-gv-text-dim mt-1">{t('semantic.description')}</p>
        </div>
        <span className={`self-start text-xs px-2.5 py-1 rounded-full border ${mode === 'remote' ? 'border-gv-pink/30 bg-gv-pink/10 text-gv-pink' : 'border-gv-green-deep/30 bg-gv-green-deep/10 text-gv-green-deep'}`}>
          {mode === 'remote' ? t('semantic.remote') : t('semantic.local')}
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-gv-text-dim">{t('app.loading')}</p>
      ) : (
        <div className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-3">
            {(['local', 'remote'] as VideoSemanticMode[]).map(option => {
              const selected = mode === option
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => { setMode(option); setSaved(false); setTestResult(null) }}
                  className={`text-left rounded-xl border p-4 transition-all ${selected ? 'border-gv-pink bg-gv-pink/8 shadow-[0_0_12px_var(--color-gv-pink-glow)]' : 'border-gv-border hover:border-gv-pink/40 bg-gv-bg/50'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-sm font-semibold ${selected ? 'text-gv-pink' : 'text-gv-text'}`}>
                      {option === 'local' ? t('semantic.local') : t('semantic.remote')}
                    </span>
                    <span className={`w-3 h-3 rounded-full border ${selected ? 'border-gv-pink bg-gv-pink' : 'border-gv-border'}`} />
                  </div>
                  <p className="text-xs text-gv-text-dim mt-2 leading-relaxed">
                    {option === 'local' ? t('semantic.local_desc') : t('semantic.remote_desc')}
                  </p>
                </button>
              )
            })}
          </div>

          {mode === 'remote' && (
            <div className="rounded-xl border border-gv-border bg-gv-bg/60 p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gv-text mb-2">{t('settings.api_format')}</label>
                <div className="flex gap-2">
                  {(['openai', 'anthropic'] as ApiFormat[]).map(format => (
                    <button
                      key={format}
                      type="button"
                      onClick={() => setApiFormat(format)}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${apiFormat === format ? 'border-gv-pink bg-gv-pink/10 text-gv-pink' : 'border-gv-border text-gv-text-dim'}`}
                    >
                      {format === 'openai' ? t('settings.format_openai') : t('settings.format_anthropic')}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="video-semantic-key" className="block text-sm font-medium text-gv-text mb-2">{t('settings.api_key')}</label>
                <input
                  id="video-semantic-key"
                  type="password"
                  value={apiKey}
                  onChange={event => setApiKey(event.target.value)}
                  placeholder={config.hasApiKey ? t('settings.api_key_saved') : t('semantic.api_key_optional')}
                  autoComplete="off"
                  spellCheck={false}
                  className="input-field w-full py-3 text-sm font-mono"
                />
                <p className="text-xs text-gv-text-muted mt-1">
                  {config.hasApiKey ? t('settings.key_saved_hint') : t('semantic.key_hint')}
                </p>
              </div>

              <div>
                <label htmlFor="video-semantic-url" className="block text-sm font-medium text-gv-text mb-2">{t('settings.base_url')}</label>
                <input
                  id="video-semantic-url"
                  type="text"
                  value={baseUrl}
                  onChange={event => setBaseUrl(event.target.value)}
                  placeholder="https://example.com/v1"
                  className="input-field w-full py-3 text-sm font-mono"
                />
                {baseUrl.trim() && (
                  <p className="text-xs text-gv-text-muted mt-1 break-all">
                    {t('settings.request_url')} {baseUrl.replace(/\/$/, '')}{endpointPath}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="video-semantic-model" className="block text-sm font-medium text-gv-text mb-2">{t('semantic.vision_model')}</label>
                <input
                  id="video-semantic-model"
                  type="text"
                  value={model}
                  onChange={event => setModel(event.target.value)}
                  placeholder="vision-model-name"
                  className="input-field w-full py-3 text-sm font-mono"
                />
              </div>

              <p className="text-xs rounded-lg border border-gv-gold/30 bg-gv-gold/10 p-3 text-gv-gold">
                {t('semantic.privacy_notice')}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {mode === 'remote' && (
              <button
                type="button"
                onClick={testConnection}
                disabled={saving || testing || !baseUrl.trim() || !model.trim()}
                className="btn-outline rounded-lg px-4 py-2.5 text-sm disabled:opacity-50"
              >
                {testing ? t('app.testing') : t('semantic.test_vision')}
              </button>
            )}
            <button
              type="button"
              onClick={saveConfig}
              disabled={saving || (mode === 'remote' && (!baseUrl.trim() || !model.trim()))}
              className="btn-primary rounded-lg px-4 py-2.5 text-sm disabled:opacity-50"
            >
              {saved ? t('settings.saved') : t('settings.save_btn')}
            </button>
          </div>

          {testResult === 'success' && (
            <p className="text-sm rounded-lg border border-gv-green-deep/30 bg-gv-green-deep/10 p-3 text-gv-green-deep">
              {t('semantic.test_success')}
            </p>
          )}
          {error && (
            <p className="text-sm rounded-lg border border-gv-pink/30 bg-gv-pink/10 p-3 text-gv-pink break-words">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
