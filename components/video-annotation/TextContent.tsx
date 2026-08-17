'use client'

import { useEffect, useState } from 'react'
import { useLang } from '@/services/i18n'
import type {
  EventAnnotation,
  ObjectAnnotation,
  RecognitionStageResult,
  SegmentRecognitionStatus,
} from '@/services/video-annotation/types'

interface Props {
  objects: ObjectAnnotation[]
  events: EventAnnotation[]
  speechTranscript?: string
  recognition?: SegmentRecognitionStatus
  pipelineErrors?: string[]
  completed?: boolean
  onSave?: (edits: TextContentEdits) => void
}

export interface TextContentEdits {
  ocr: Array<{ trackId: number; text: string }>
  speechTranscript: string
}

function stripSpeechPrefix(eventType: string): string {
  return eventType.replace(/^\[Speech\]\s*/, '')
}

function matchingError(errors: string[], kind: 'ocr' | 'speech'): string | undefined {
  const pattern = kind === 'ocr' ? /OCR|text recognition/i : /Whisper|speech-to-text/i
  return errors.find(error => pattern.test(error))
}

export function TextContent({
  objects,
  events,
  speechTranscript,
  recognition,
  pipelineErrors = [],
  completed = false,
  onSave,
}: Props) {
  const { t } = useLang()
  const textObjects = objects.filter(object => Boolean(object._textContent))
  const speechEvents = events.filter(event => event.type.startsWith('[Speech]'))
  const speechTexts = [
    speechTranscript?.trim(),
    ...speechEvents.map(event => stripSpeechPrefix(event.type).trim()),
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
  const [ocrDrafts, setOcrDrafts] = useState<Record<number, string>>(() => Object.fromEntries(
    textObjects.map(object => [object.trackId, object._textContent || '']),
  ))
  const [speechDraft, setSpeechDraft] = useState(() => speechTexts.join('\n'))
  const [dirty, setDirty] = useState(false)

  // New recognition results can arrive via polling while this panel is open.
  // Sync drafts from props — but only while the user has not started editing,
  // so their in-progress corrections are never overwritten.
  /* eslint-disable react-hooks/set-state-in-effect -- draft sync from props */
  useEffect(() => {
    if (dirty) return
    setOcrDrafts(Object.fromEntries(
      textObjects.map(object => [object.trackId, object._textContent || '']),
    ))
    setSpeechDraft(speechTexts.join('\n'))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync on content change only
  }, [objects, speechTranscript, events])
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!completed && !recognition && textObjects.length === 0 && speechTexts.length === 0) {
    return null
  }

  return (
    <div className="mb-4 p-3 rounded-lg border border-gv-border bg-gv-surface">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-gv-text">{t('recognition.title')}</h4>
        {onSave && (
          <button
            onClick={() => {
              onSave({
                ocr: textObjects.map(object => ({
                  trackId: object.trackId,
                  text: (ocrDrafts[object.trackId] ?? object._textContent ?? '').trim(),
                })),
                speechTranscript: speechDraft.trim(),
              })
              setDirty(false)
            }}
            disabled={!dirty}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              dirty ? 'btn-primary' : 'bg-gv-border text-gv-text-muted cursor-not-allowed'
            }`}
          >
            {t('recognition.save_corrections')}
          </button>
        )}
      </div>

      <RecognitionSection
        title={t('recognition.ocr_title')}
        stage={recognition?.ocr}
        legacyError={matchingError(pipelineErrors, 'ocr')}
        hasContent={textObjects.length > 0}
      >
        {textObjects.length > 0 && (
          <div className="space-y-1.5">
            {textObjects.map(object => (
              <div key={object.trackId} className="flex items-center gap-2">
                {onSave ? (
                  <input
                    type="text"
                    value={ocrDrafts[object.trackId] ?? object._textContent ?? ''}
                    onChange={event => {
                      setOcrDrafts(current => ({ ...current, [object.trackId]: event.target.value }))
                      setDirty(true)
                    }}
                    className="input-field min-w-0 flex-1 text-xs py-1.5"
                    placeholder={t('recognition.ocr_placeholder')}
                  />
                ) : (
                  <div className="min-w-0 flex-1 bg-gv-bg-deep rounded px-2.5 py-1.5 text-xs text-gv-text break-words">
                    {object._textContent}
                  </div>
                )}
                {object._detectionConfidence != null && (
                  <span className="shrink-0 text-[11px] text-gv-text-muted">
                    ({(object._detectionConfidence * 100).toFixed(0)}%)
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </RecognitionSection>

      <RecognitionSection
        title={t('recognition.speech_title')}
        stage={recognition?.speech}
        legacyError={matchingError(pipelineErrors, 'speech')}
        hasContent={speechTexts.length > 0}
      >
        {onSave ? (
          <textarea
            value={speechDraft}
            onChange={event => {
              setSpeechDraft(event.target.value)
              setDirty(true)
            }}
            className="input-field min-h-20 w-full resize-y text-xs py-1.5"
            placeholder={t('recognition.speech_placeholder')}
          />
        ) : speechTexts.length > 0 ? (
          <div className="space-y-1.5">
            {speechTexts.map((speechText, index) => (
              <div key={`${speechText}_${index}`} className="bg-gv-bg-deep rounded px-2.5 py-1.5 text-xs text-gv-text break-words">
                {speechText}
              </div>
            ))}
          </div>
        ) : null}
      </RecognitionSection>
    </div>
  )
}

function RecognitionSection({
  title,
  stage,
  legacyError,
  hasContent,
  children,
}: {
  title: string
  stage?: RecognitionStageResult
  legacyError?: string
  hasContent: boolean
  children: React.ReactNode
}) {
  const { t } = useLang()
  const error = stage?.error || legacyError
  let message = ''
  let tone = 'text-gv-text-muted'

  if (hasContent) {
    message = t('recognition.status_completed')
    tone = 'text-gv-green-deep'
  } else if (error || stage?.status === 'failed') {
    message = error || t('recognition.status_failed')
    tone = 'text-gv-pink'
  } else if (!stage) {
    message = t('recognition.status_legacy')
  } else if (stage.status === 'no_audio') {
    message = t('recognition.status_no_audio')
  } else if (stage.status === 'no_content') {
    message = t('recognition.status_no_content')
  } else if (stage.status === 'disabled') {
    message = t('recognition.status_disabled')
  } else if (stage.status === 'skipped') {
    message = t('recognition.status_skipped')
  } else if (stage.status === 'pending') {
    message = t('recognition.status_pending')
  } else {
    message = t('recognition.status_no_content')
  }

  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <p className="text-xs text-gv-text-muted font-medium">{title}</p>
        <span className={`text-[11px] text-right break-words ${tone}`}>{message}</span>
      </div>
      {children}
    </div>
  )
}
