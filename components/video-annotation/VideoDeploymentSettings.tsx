'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLang } from '@/services/i18n'
import { useConfirm } from '@/components/ui'
import type {
  DeploymentMode,
  DeploymentStatus,
} from '@/services/video-annotation/types'

export function VideoDeploymentSettings({ onModeChange }: { onModeChange?: (mode: DeploymentMode) => void } = {}) {
  const { t } = useLang()
  const confirmAction = useConfirm()
  const [deployment, setDeployment] = useState<DeploymentStatus | null>(null)
  const [hfToken, setHfToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadDeployment = useCallback(async () => {
    try {
      const response = await fetch('/api/video-annotation/deployment', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || t('video.worker_unavailable'))
      setDeployment(payload as DeploymentStatus)
      onModeChange?.((payload as DeploymentStatus).mode)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('video.worker_unavailable'))
    } finally {
      setLoading(false)
    }
  }, [onModeChange, t])

  useEffect(() => {
    const timer = window.setTimeout(loadDeployment, 0)
    return () => window.clearTimeout(timer)
  }, [loadDeployment])

  useEffect(() => {
    const status = deployment?.enhancedSetup.status
    if (status !== 'checking_access' && status !== 'downloading') return
    const timer = window.setInterval(loadDeployment, 3000)
    return () => window.clearInterval(timer)
  }, [deployment?.enhancedSetup.status, loadDeployment])

  const changeMode = async (mode: DeploymentMode) => {
    if (!deployment || saving || deployment.managedByEnvironment) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/video-annotation/deployment', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || t('deployment.save_failed'))
      const next = payload as DeploymentStatus
      setDeployment(next)
      onModeChange?.(next.mode)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('deployment.save_failed'))
    } finally {
      setSaving(false)
    }
  }

  const submitToken = async () => {
    if (!hfToken.trim()) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/video-annotation/auth/huggingface/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: hfToken.trim() }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || t('deployment.auth_failed'))
      await loadDeployment()
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : t('deployment.auth_failed'))
    } finally {
      setHfToken('')
      setSaving(false)
    }
  }

  const prepareEnhanced = async () => {
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/video-annotation/deployment/prepare', { method: 'POST' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || t('deployment.prepare_failed'))
      await loadDeployment()
    } catch (prepareError) {
      setError(prepareError instanceof Error ? prepareError.message : t('deployment.prepare_failed'))
    } finally {
      setSaving(false)
    }
  }

  const setupStatus = deployment?.enhancedSetup.status

  return (
    <section className="card p-5 sm:p-6" aria-busy={loading || saving}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-semibold text-gv-text">{t('deployment.title')}</h2>
          <p className="text-sm text-gv-text-dim mt-1">{t('deployment.description')}</p>
        </div>
        {deployment && (
          <span className={`self-start text-xs px-2.5 py-1 rounded-full border ${deployment.mode === 'enhanced' ? 'border-gv-pink/30 bg-gv-pink/10 text-gv-pink' : 'border-gv-green-deep/30 bg-gv-green-deep/10 text-gv-green-deep'}`}>
            {deployment.mode === 'enhanced' ? t('deployment.enhanced') : t('deployment.standard')}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-3" aria-label={t('app.loading')}>
          <div className="h-20 animate-pulse rounded-xl border border-gv-border bg-gv-bg/60" />
          <div className="h-10 animate-pulse rounded-lg bg-gv-border/30" />
        </div>
      ) : deployment ? (
        <div className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-3">
            {(['standard', 'enhanced'] as DeploymentMode[]).map(mode => {
              const selected = deployment.mode === mode
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={saving || deployment.managedByEnvironment}
                  onClick={() => changeMode(mode)}
                  aria-pressed={selected}
                  className={`text-left rounded-xl border p-4 transition-colors disabled:opacity-60 ${selected ? 'border-ui-active-indicator bg-ui-icon-accent-soft' : 'border-ui-border hover:border-ui-border-strong bg-ui-surface'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-sm font-semibold ${selected ? 'text-ui-accent-hover' : 'text-gv-text'}`}>
                      {mode === 'standard' ? t('deployment.standard') : t('deployment.enhanced')}
                    </span>
                    <span className={`w-3 h-3 rounded-full border ${selected ? 'border-ui-icon-accent bg-ui-icon-accent' : 'border-ui-border'}`} />
                  </div>
                  <p className="text-xs text-gv-text-dim mt-2 leading-relaxed">
                    {mode === 'standard' ? t('deployment.standard_desc') : t('deployment.enhanced_desc')}
                  </p>
                </button>
              )
            })}
          </div>

          {deployment.managedByEnvironment && (
            <p className="text-xs rounded-lg border border-gv-gold/30 bg-gv-gold/10 px-3 py-2 text-gv-gold">
              {t('deployment.managed_env')}
            </p>
          )}

          {deployment.mode === 'enhanced' && (
            <div className="rounded-xl border border-gv-border bg-gv-bg/60 p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gv-text">Hugging Face · LocateAnything-3B</p>
                  <p className="text-xs text-gv-text-dim mt-1">
                    {setupStatus === 'ready'
                      ? t('deployment.model_ready')
                      : setupStatus === 'downloading'
                        ? t('deployment.downloading')
                        : setupStatus === 'checking_access'
                          ? t('deployment.checking_access')
                          : setupStatus === 'access_required'
                            ? t('deployment.access_required')
                            : deployment.huggingFace.authenticated
                              ? t('deployment.connected', deployment.huggingFace.username || 'Hugging Face')
                              : t('deployment.not_connected')}
                  </p>
                  <p className="text-xs text-gv-text-muted mt-1 break-all">
                    {t('deployment.cache_location')}: {deployment.enhancedSetup.localModelPath || deployment.enhancedSetup.cacheRoot}
                  </p>
                </div>

                {setupStatus !== 'ready' && deployment.huggingFace.authenticated && setupStatus !== 'downloading' && setupStatus !== 'checking_access' && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!deployment.enhancedSetup.downloadRequired || await confirmAction(t('deployment.download_confirmation', deployment.enhancedSetup.approximateDownloadGb))) {
                        prepareEnhanced()
                      }
                    }}
                    disabled={saving}
                    className="btn-outline rounded-lg px-4 py-2 text-sm flex-shrink-0 disabled:opacity-50"
                  >
                    {t('deployment.retry_prepare')}
                  </button>
                )}
              </div>

              {setupStatus !== 'ready' && deployment.huggingFace.source !== 'environment' && !deployment.huggingFace.authenticated && (
                <form
                  className="mt-4"
                  onSubmit={event => { event.preventDefault(); submitToken() }}
                >
                  <label htmlFor="hf-token" className="block text-xs font-medium text-gv-text mb-2">
                    {t('deployment.token_label')}
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      id="hf-token"
                      type="password"
                      value={hfToken}
                      onChange={event => setHfToken(event.target.value)}
                      placeholder="hf_..."
                      autoComplete="off"
                      spellCheck={false}
                      className="input-field flex-1 py-2.5 text-sm font-mono"
                    />
                    <button type="submit" disabled={saving || !hfToken.trim()} className="btn-primary rounded-lg px-4 py-2.5 text-sm flex-shrink-0 disabled:opacity-50">
                      {t('deployment.connect_hf')}
                    </button>
                  </div>
                  <p className="text-xs text-gv-text-muted mt-2">{t('deployment.token_hint')}</p>
                </form>
              )}

              {setupStatus === 'access_required' && (
                <div className="mt-4 rounded-lg border border-gv-gold/30 bg-gv-gold/10 p-3 text-xs text-gv-gold">
                  <p>{t('deployment.accept_terms')}</p>
                  <a href={deployment.enhancedSetup.modelUrl} target="_blank" rel="noreferrer" className="inline-block mt-2 underline underline-offset-2">
                    {t('deployment.open_model_page')}
                  </a>
                </div>
              )}

              {setupStatus === 'failed' && (
                <p className="mt-4 text-xs rounded-lg border border-gv-pink/30 bg-gv-pink/10 p-3 text-gv-pink break-words" role="alert">
                  {deployment.enhancedSetup.error || t('deployment.prepare_failed')}
                </p>
              )}

              {deployment.huggingFace.source === 'environment' && (
                <p className="mt-3 text-xs text-gv-text-muted">{t('deployment.environment_managed')}</p>
              )}
            </div>
          )}
        </div>
      ) : null}

      {error && (
        <p className="mt-4 text-xs rounded-lg border border-gv-pink/30 bg-gv-pink/10 p-3 text-gv-pink break-words" role="alert">{error}</p>
      )}
    </section>
  )
}
