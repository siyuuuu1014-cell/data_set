'use client'

import { useCallback, useRef, useState } from 'react'
import { useLang } from '@/services/i18n'

interface Props {
  onFiles: (files: File[]) => void
  disabled?: boolean
}

export function VideoBatchUploader({ onFiles, disabled }: Props) {
  const { t } = useLang()
  const [dragOver, setDragOver] = useState(false)
  const [fileNames, setFileNames] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const handle = useCallback(
    (files: FileList | File[]) => {
      const videos = Array.from(files).filter(f =>
        f.type.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm)$/i.test(f.name)
      )
      if (videos.length > 0) {
        setFileNames(videos.map(f => f.name))
        onFiles(videos)
      }
    },
    [onFiles]
  )

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) handle(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={`
          relative cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors
          ${disabled ? 'pointer-events-none opacity-50' : ''}
          ${dragOver ? 'border-gv-pink bg-gv-pink/5' : 'border-gv-border hover:border-gv-pink/30 bg-gv-bg-deep/50'}
        `}
      >
        {fileNames.length > 0 ? (
          <div>
            <svg className="w-10 h-10 mx-auto text-gv-green-deep mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <p className="text-sm text-gv-text font-medium">{t('video.upload_selected', fileNames.length)}</p>
            <p className="text-xs text-gv-text-muted mt-1">{fileNames.slice(0, 3).join(', ')}{fileNames.length > 3 ? '...' : ''}</p>
            <p className="text-xs text-gv-text-muted mt-3">{t('video.upload_change')}</p>
          </div>
        ) : (
          <div>
            <svg className="w-12 h-12 mx-auto text-gv-text-muted mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm text-gv-text-dim">{t('video.upload_drop')}</p>
            <p className="text-xs text-gv-text-muted mt-1">{t('video.upload_formats')}</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm"
          className="hidden"
          onChange={e => {
            if (e.target.files?.length) handle(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
