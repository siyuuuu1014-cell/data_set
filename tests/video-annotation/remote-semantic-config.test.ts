import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_VIDEO_SEMANTIC_CONFIG,
  normalizeVideoSemanticConfig,
  publicVideoSemanticConfig,
} from '../../services/video-annotation/remote-semantic-config'

test('video semantic configuration remains local by default', () => {
  const config = normalizeVideoSemanticConfig({})
  assert.equal(config.mode, 'local')
  assert.equal(config.baseUrl, '')
  assert.equal(config.model, '')
})

test('remote video semantic configuration requires an endpoint and vision model', () => {
  assert.throws(
    () => normalizeVideoSemanticConfig({ mode: 'remote' }),
    /Base URL/,
  )
  assert.throws(
    () => normalizeVideoSemanticConfig({ mode: 'remote', baseUrl: 'https://example.com/v1' }),
    /模型名称/,
  )
  assert.throws(
    () => normalizeVideoSemanticConfig({ mode: 'remote', baseUrl: 'https://example.com/v1', model: 'vision-model', apiFormat: 'custom' as 'openai' }),
    /API 格式/,
  )
})

test('video semantic API key is preserved when an edit leaves it blank', () => {
  const existing = {
    ...DEFAULT_VIDEO_SEMANTIC_CONFIG,
    apiKey: 'secret-value',
    baseUrl: 'https://example.com/v1',
    model: 'vision-model',
  }
  const config = normalizeVideoSemanticConfig({ mode: 'remote' }, existing)
  assert.equal(config.apiKey, 'secret-value')
  assert.equal(config.model, 'vision-model')
})

test('public video semantic configuration never exposes the API key', () => {
  const publicConfig = publicVideoSemanticConfig({
    mode: 'remote',
    apiKey: 'secret-value',
    baseUrl: 'https://example.com/v1',
    model: 'vision-model',
    apiFormat: 'openai',
  })
  assert.equal(publicConfig.hasApiKey, true)
  assert.equal('apiKey' in publicConfig, false)
})
