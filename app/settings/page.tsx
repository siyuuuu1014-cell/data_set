'use client'

import { useLang } from '@/services/i18n'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import type { ApiFormat } from '@/services/types'

const PROVIDERS = [
  { name: 'DeepSeek (Anthropic)', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-chat', apiFormat: 'anthropic' as ApiFormat },
  { name: 'DeepSeek (OpenAI)', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiFormat: 'openai' as ApiFormat },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiFormat: 'openai' as ApiFormat },
  { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514', apiFormat: 'anthropic' as ApiFormat },
  { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3', apiFormat: 'openai' as ApiFormat },
]

export default function SettingsPage() {
  const { t } = useLang()
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com/anthropic')
  const [model, setModel] = useState('deepseek-chat')
  const [apiFormat, setApiFormat] = useState<ApiFormat>('anthropic')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null)
  const [testError, setTestError] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/llm/config')
      .then(r => r.json())
      .then(data => {
        if (data.configured) {
          setBaseUrl(data.baseUrl)
          setModel(data.model)
          setApiFormat(data.apiFormat)
          setHasApiKey(data.hasApiKey)
        }
      })
      .finally(() => setLoading(false))
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
        setTestError(data.error || `请求失败 (${res.status})`)
      }
    } catch {
      setTestResult('fail')
      setTestError('网络请求失败')
    }
    setTesting(false)
  }

  const endpointPath = apiFormat === 'anthropic' ? '/messages' : '/chat/completions'

  if (loading) return null

  return (
    <div className="flex-1 flex flex-col">
      <header className="glass border-b border-gv-border/50">
        <div className="max-w-2xl mx-auto px-6 py-5 flex items-center gap-4">
          <Link href="/" className="text-gv-text-dim hover:text-gv-pink transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-2xl font-bold text-gv-text">{t('settings.title')}</h1>
          {hasApiKey && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-gv-green/20 text-gv-green-dark font-medium">
              {t('app.configured')}
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-8">
        <p className="text-sm text-gv-text-dim mb-6">
          API Key 存储在服务端，不会暴露给浏览器。所有项目共用此配置。
        </p>

        <div className="space-y-5">
          {/* Provider presets */}
          <div>
            <label className="block text-sm font-medium text-gv-text mb-2">选择服务商</label>
            <div className="flex flex-wrap gap-2">
              {PROVIDERS.map(p => (
                <button
                  key={p.name}
                  onClick={() => {
                    setBaseUrl(p.baseUrl)
                    setModel(p.model)
                    setApiFormat(p.apiFormat)
                    saveConfig({ baseUrl: p.baseUrl, model: p.model, apiFormat: p.apiFormat })
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-all duration-200 ${
                    baseUrl === p.baseUrl
                      ? 'border-gv-pink bg-gv-pink/10 text-gv-pink font-medium shadow-[0_0_8px_var(--color-gv-pink-glow)]'
                      : 'border-gv-border text-gv-text-dim hover:border-gv-pink/40 hover:text-gv-pink'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* API Format */}
          <div>
            <label className="block text-sm font-medium text-gv-text mb-2">API 格式</label>
            <div className="flex gap-2">
              {([
                { value: 'openai' as ApiFormat, label: 'OpenAI 兼容' },
                { value: 'anthropic' as ApiFormat, label: 'Anthropic 兼容' },
              ]).map(f => (
                <button
                  key={f.value}
                  onClick={() => {
                    setApiFormat(f.value)
                    saveConfig({ apiFormat: f.value })
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-all duration-200 ${
                    apiFormat === f.value
                      ? 'border-gv-pink bg-gv-pink/10 text-gv-pink font-medium shadow-[0_0_8px_var(--color-gv-pink-glow)]'
                      : 'border-gv-border text-gv-text-dim hover:border-gv-pink/40 hover:text-gv-pink'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gv-text mb-2">{t('settings.api_key')}</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasApiKey ? t('settings.api_key_saved') : 'sk-...'}
              className="input-field w-full py-3 text-sm font-mono"
            />
            <p className="text-xs text-gv-text-muted mt-1">
              {hasApiKey ? '已存储 API Key，填写新值将覆盖' : 'API Key 仅存储在服务端'}
            </p>
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-sm font-medium text-gv-text mb-2">{t('settings.base_url')}</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="input-field w-full py-3 text-sm font-mono"
            />
            <p className="text-xs text-gv-text-muted mt-1">
              请求地址: <code className="text-gv-text-dim bg-gv-bg px-1.5 py-0.5 rounded">{baseUrl.replace(/\/$/, '')}{endpointPath}</code>
            </p>
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-gv-text mb-2">{t('settings.model')}</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="input-field w-full py-3 text-sm font-mono"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleTest}
              disabled={testing || (!apiKey.trim() && !hasApiKey)}
              className="btn-outline rounded-lg px-4 py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testing ? t('app.testing') : t('settings.test_btn')}
            </button>
            <button
              onClick={() => saveConfig()}
              className="btn-primary rounded-lg px-4 py-2.5 text-sm"
            >
              {saved ? t('settings.saved') : t('settings.save_btn')}
            </button>
          </div>

          {testResult === 'success' && (
            <div className="rounded-lg bg-gv-green/10 border border-gv-green/30 p-3 text-sm text-gv-green-dark">
              {t('settings.test_success')}
            </div>
          )}
          {testResult === 'fail' && (
            <div className="rounded-lg bg-gv-pink/10 border border-gv-pink/30 p-3 text-sm text-gv-pink-dark">
              {testError || t('settings.test_fail')}
              <div className="mt-1 text-xs text-gv-pink/70 break-all">
                {baseUrl.replace(/\/$/, '')}{endpointPath}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
