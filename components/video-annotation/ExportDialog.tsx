'use client'

import { useState } from 'react'
import type { ExportFormat } from '@/services/video-annotation/types'

interface Props {
  open: boolean
  onClose: () => void
  onExport: (format: ExportFormat) => void
}

const FORMATS: { value: ExportFormat; label: string; desc: string }[] = [
  { value: 'json', label: 'Custom JSON', desc: 'Full annotation with attributes, scene, camera, events' },
  { value: 'yolo', label: 'YOLO', desc: 'Images + labels (txt) in ZIP, training-ready' },
  { value: 'coco', label: 'COCO JSON', desc: 'Standard detection format, compatible with most frameworks' },
]

export function ExportDialog({ open, onClose, onExport }: Props) {
  const [selected, setSelected] = useState<ExportFormat>('json')

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-raised rounded-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-gv-text mb-1">Export Annotations</h3>
        <p className="text-sm text-gv-text-dim mb-4">Choose export format for the annotated dataset.</p>

        <div className="space-y-2 mb-6">
          {FORMATS.map(f => (
            <label
              key={f.value}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                selected === f.value
                  ? 'border-gv-pink bg-gv-pink/5'
                  : 'border-gv-border hover:border-gv-pink/30'
              }`}
            >
              <input
                type="radio" name="export-format" value={f.value}
                checked={selected === f.value}
                onChange={() => setSelected(f.value)}
                className="mt-0.5 h-4 w-4 accent-gv-pink"
              />
              <div>
                <p className="text-sm font-medium text-gv-text">{f.label}</p>
                <p className="text-xs text-gv-text-dim mt-0.5">{f.desc}</p>
              </div>
            </label>
          ))}
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-outline rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button
            onClick={() => onExport(selected)}
            className="btn-primary rounded-lg px-4 py-2 text-sm"
          >
            Export {selected.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  )
}
