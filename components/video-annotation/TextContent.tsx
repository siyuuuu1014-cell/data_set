'use client'

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
  recognition?: SegmentRecognitionStatus
  pipelineErrors?: string[]
  completed?: boolean
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
  recognition,
  pipelineErrors = [],
  completed = false,
}: Props) {
  const { t } = useLang()
  const textObjects = objects.filter(object => Boolean(object._textContent))
  const speechEvents = events.filter(event => event.type.startsWith('[Speech]'))

  if (!completed && !recognition && textObjects.length === 0 && speechEvents.length === 0) {
    return null
  }

  return (
    <div className="mb-4 p-3 rounded-lg border border-gv-border bg-gv-surface">
      <h4 className="text-sm font-semibold text-gv-text mb-3">{t('recognition.title')}</h4>

      <RecognitionSection
        title={t('recognition.ocr_title')}
        stage={recognition?.ocr}
        legacyError={matchingError(pipelineErrors, 'ocr')}
        hasContent={textObjects.length > 0}
      >
        {textObjects.length > 0 && (
          <div className="space-y-1.5">
            {textObjects.map(object => (
              <div key={object.trackId} className="bg-gv-bg-deep rounded px-2.5 py-1.5 text-xs text-gv-text break-words">
                <span>{object._textContent}</span>
                {object._detectionConfidence != null && (
                  <span className="ml-1.5 text-gv-text-muted">
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
        hasContent={speechEvents.length > 0}
      >
        {speechEvents.length > 0 && (
          <div className="space-y-1.5">
            {speechEvents.map((event, index) => (
              <div key={`${event.type}_${index}`} className="bg-gv-bg-deep rounded px-2.5 py-1.5 text-xs text-gv-text break-words">
                {stripSpeechPrefix(event.type)}
              </div>
            ))}
          </div>
        )}
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
