'use client'

import type { PersonAnnotation, ObjectAnnotation } from '@/services/video-annotation/types'
import type { ObjectLabelRenameScope } from '@/services/video-annotation/frame-annotations'
import {
  GENDERS, AGE_GROUPS, POSES, FACING, EXPRESSIONS,
  HAIR_COLORS, HAIR_STYLES, CLOTHING_TYPES, CLOTHING_COLORS,
  OBJECT_CATEGORIES,
} from '@/services/video-annotation/constants'
import { EditableSelect } from './EditableSelect'
import { useLang } from '@/services/i18n'
import { useConfirm } from '@/components/ui'

interface Props {
  person: PersonAnnotation | null
  object: ObjectAnnotation | null
  onChange: (updated: PersonAnnotation | ObjectAnnotation) => void
  onSave: (scope: ObjectLabelRenameScope) => void
  dirty: boolean
  detectionConfidence?: number
  frameLabel?: string
}

export function TrackEditor({ person, object, onChange, onSave, dirty, detectionConfidence, frameLabel }: Props) {
  const { t } = useLang()
  const confirmAction = useConfirm()
  if (!person && !object) return null

  if (person) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('annotation.gender')}>
            <EditableSelect value={person.gender} options={GENDERS}
              onChange={value => onChange({ ...person, gender: value })} />
          </Field>
          <Field label={t('annotation.age_group')}>
            <EditableSelect value={person.ageGroup} options={AGE_GROUPS}
              onChange={value => onChange({ ...person, ageGroup: value })} />
          </Field>
          <Field label={t('annotation.pose')}>
            <EditableSelect value={person.pose} options={POSES}
              onChange={value => onChange({ ...person, pose: value })} />
          </Field>
          <Field label={t('annotation.facing')}>
            <EditableSelect value={person.facing} options={FACING}
              onChange={value => onChange({ ...person, facing: value })} />
          </Field>
          <Field label={t('annotation.expression')}>
            <EditableSelect value={person.expression} options={EXPRESSIONS}
              onChange={value => onChange({ ...person, expression: value })} />
          </Field>
          <Field label={t('annotation.occlusion')}>
            <input type="number" value={person.occlusion} min={0} max={1} step={0.05}
              onChange={e => onChange({ ...person, occlusion: Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)) })}
              className="input-field w-full text-xs py-1.5" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('annotation.hair_color')}>
            <EditableSelect value={person.hair?.color || 'unknown'} options={HAIR_COLORS}
              onChange={value => onChange({ ...person, hair: { ...person.hair, color: value } })} />
          </Field>
          <Field label={t('annotation.hair_style')}>
            <EditableSelect value={person.hair?.style || 'unknown'} options={HAIR_STYLES}
              onChange={value => onChange({ ...person, hair: { ...person.hair, style: value } })} />
          </Field>
        </div>
        <Field label={t('annotation.actions')}>
          <input
            type="text"
            value={person.action?.join(', ') || ''}
            onChange={e => onChange({ ...person, action: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            className="input-field w-full text-xs py-1.5"
            placeholder={t('annotation.actions_placeholder')}
          />
        </Field>
        <div>
          <p className="text-xs text-gv-text-dim mb-1">{t('annotation.clothing')}</p>
          {(person.clothing || []).map((c, i) => (
            <div key={i} className="flex items-start gap-2 mb-1">
              <div className="flex-1">
                <EditableSelect value={c.type} options={CLOTHING_TYPES} onChange={value => {
                const next = [...(person.clothing || [])]
                next[i] = { ...next[i], type: value }
                onChange({ ...person, clothing: next })
                }} selectClassName="input-field w-full text-xs py-1" inputClassName="input-field w-full text-xs py-1" />
              </div>
              <div className="w-28">
                <EditableSelect value={c.color} options={CLOTHING_COLORS} onChange={value => {
                const next = [...(person.clothing || [])]
                next[i] = { ...next[i], color: value }
                onChange({ ...person, clothing: next })
                }} selectClassName="input-field w-full text-xs py-1" inputClassName="input-field w-full text-xs py-1" />
              </div>
              <button onClick={() => {
                const next = (person.clothing || []).filter((_, j) => j !== i)
                onChange({ ...person, clothing: next })
              }} className="text-xs text-gv-pink hover:text-gv-pink-dark" aria-label={t('annotation.remove_clothing', i + 1)} title={t('annotation.remove_clothing', i + 1)}>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
            </div>
          ))}
          <button onClick={() => {
            onChange({ ...person, clothing: [...(person.clothing || []), { type: 'tshirt', color: 'unknown', attributes: [], brand: null }] })
          }} className="inline-flex items-center gap-1 text-xs text-gv-green-deep hover:underline">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            {t('annotation.add_clothing')}
          </button>
        </div>
        <p className="text-xs text-gv-text-muted">
          {t('annotation.bbox')}: [{person.bbox.x},{person.bbox.y} {person.bbox.width}×{person.bbox.height}]
          {person.depth != null && <> · {t('annotation.depth')}: {person.depth.toFixed(2)}</>}
          {detectionConfidence != null && <> · {t('annotation.confidence')}: {(detectionConfidence * 100).toFixed(0)}%</>}
        </p>
        <button
          onClick={() => onSave('track')}
          disabled={!dirty}
          className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${dirty ? 'btn-primary' : 'bg-gv-border text-gv-text-muted cursor-not-allowed'}`}
        >
          {t('annotation.save_changes')}
        </button>
      </div>
    )
  }

  // Object editor
  if (object) {
    const normalizedName = object.name.trim()
    const frameLabelChanged = normalizedName !== (frameLabel || '').trim()
    return (
      <div className="space-y-3">
        <Field label={t('annotation.name')}>
          <input type="text" value={object.name} onChange={e => onChange({ ...object, name: e.target.value })}
            className="input-field w-full text-xs py-1.5" />
        </Field>
        <Field label={t('annotation.category')}>
          <EditableSelect value={object.category} options={OBJECT_CATEGORIES}
            onChange={value => onChange({ ...object, category: value })} />
        </Field>
        <Field label={t('annotation.color')}>
          <EditableSelect value={object.color} options={CLOTHING_COLORS}
            onChange={value => onChange({ ...object, color: value })} />
        </Field>
        <Field label={t('annotation.brand')}>
          <input type="text" value={object.brand || ''} onChange={e => onChange({ ...object, brand: e.target.value || null })}
            className="input-field w-full text-xs py-1.5" placeholder={t('annotation.brand_placeholder')} />
        </Field>
        <p className="text-xs text-gv-text-muted">
          {object.bbox ? `${t('annotation.bbox')}: [${object.bbox.x},${object.bbox.y} ${object.bbox.width}×${object.bbox.height}]` : t('annotation.location_unknown')}
          {object.depth != null && <> · {t('annotation.depth')}: {object.depth.toFixed(2)}</>}
          {detectionConfidence != null && <> · {t('annotation.confidence')}: {(detectionConfidence * 100).toFixed(0)}%</>}
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onSave('frame')} disabled={!frameLabelChanged || !normalizedName}
            className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${frameLabelChanged && normalizedName ? 'btn-primary' : 'bg-gv-border text-gv-text-muted cursor-not-allowed'}`}>
            {t('annotation.save_frame_label')}
          </button>
          <button
            onClick={async () => {
              if (await confirmAction(t('annotation.save_track_confirm'))) {
                onSave('track')
              }
            }}
            disabled={!dirty || !normalizedName}
            className="rounded border border-gv-border bg-gv-bg px-4 py-1.5 text-sm font-medium text-gv-text-dim hover:bg-gv-pink/10 disabled:cursor-not-allowed disabled:opacity-40">
            {t('annotation.save_entire_track')}
          </button>
          <button
            onClick={async () => {
              if (await confirmAction(t('annotation.apply_matching_confirm'))) {
                onSave('matching_segment')
              }
            }}
            disabled={!normalizedName}
            className="rounded border border-gv-gold/50 bg-gv-gold/10 px-4 py-1.5 text-sm font-medium text-gv-gold-dark hover:bg-gv-gold/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('annotation.apply_matching')}
          </button>
        </div>
      </div>
    )
  }

  return null
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gv-text-muted mb-0.5">{label}</p>
      {children}
    </div>
  )
}
