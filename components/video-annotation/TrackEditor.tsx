'use client'

import type { PersonAnnotation, ObjectAnnotation } from '@/services/video-annotation/types'
import {
  GENDERS, AGE_GROUPS, POSES, FACING, EXPRESSIONS,
  HAIR_COLORS, HAIR_STYLES, CLOTHING_TYPES, CLOTHING_COLORS,
  OBJECT_CATEGORIES,
} from '@/services/video-annotation/constants'
import { EditableSelect } from './EditableSelect'

interface Props {
  person: PersonAnnotation | null
  object: ObjectAnnotation | null
  onChange: (updated: PersonAnnotation | ObjectAnnotation) => void
  onSave: () => void
  dirty: boolean
  detectionConfidence?: number
}

export function TrackEditor({ person, object, onChange, onSave, dirty, detectionConfidence }: Props) {
  if (!person && !object) return null

  if (person) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Gender">
            <EditableSelect value={person.gender} options={GENDERS}
              onChange={value => onChange({ ...person, gender: value })} />
          </Field>
          <Field label="Age Group">
            <EditableSelect value={person.ageGroup} options={AGE_GROUPS}
              onChange={value => onChange({ ...person, ageGroup: value })} />
          </Field>
          <Field label="Pose">
            <EditableSelect value={person.pose} options={POSES}
              onChange={value => onChange({ ...person, pose: value })} />
          </Field>
          <Field label="Facing">
            <EditableSelect value={person.facing} options={FACING}
              onChange={value => onChange({ ...person, facing: value })} />
          </Field>
          <Field label="Expression">
            <EditableSelect value={person.expression} options={EXPRESSIONS}
              onChange={value => onChange({ ...person, expression: value })} />
          </Field>
          <Field label="Occlusion">
            <input type="number" value={person.occlusion} min={0} max={1} step={0.05}
              onChange={e => onChange({ ...person, occlusion: Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)) })}
              className="input-field w-full text-xs py-1.5" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hair Color">
            <EditableSelect value={person.hair?.color || 'unknown'} options={HAIR_COLORS}
              onChange={value => onChange({ ...person, hair: { ...person.hair, color: value } })} />
          </Field>
          <Field label="Hair Style">
            <EditableSelect value={person.hair?.style || 'unknown'} options={HAIR_STYLES}
              onChange={value => onChange({ ...person, hair: { ...person.hair, style: value } })} />
          </Field>
        </div>
        <Field label="Actions (comma separated)">
          <input
            type="text"
            value={person.action?.join(', ') || ''}
            onChange={e => onChange({ ...person, action: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            className="input-field w-full text-xs py-1.5"
            placeholder="e.g. sitting, playing_piano"
          />
        </Field>
        <div>
          <p className="text-xs text-gv-text-dim mb-1">Clothing</p>
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
              }} className="text-xs text-gv-pink hover:text-gv-pink-dark">✕</button>
            </div>
          ))}
          <button onClick={() => {
            onChange({ ...person, clothing: [...(person.clothing || []), { type: 'tshirt', color: 'unknown', attributes: [], brand: null }] })
          }} className="text-xs text-gv-green-deep hover:underline">+ Add clothing</button>
        </div>
        <p className="text-xs text-gv-text-muted">
          BBox: [{person.bbox.x},{person.bbox.y} {person.bbox.width}x{person.bbox.height}]
          {person.depth != null && <> | Depth: {person.depth.toFixed(2)}</>}
          {detectionConfidence != null && <> | Conf: {(detectionConfidence * 100).toFixed(0)}%</>}
        </p>
        <button
          onClick={onSave}
          disabled={!dirty}
          className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${dirty ? 'btn-primary' : 'bg-gv-border text-gv-text-muted cursor-not-allowed'}`}
        >
          Save Changes
        </button>
      </div>
    )
  }

  // Object editor
  if (object) {
    return (
      <div className="space-y-3">
        <Field label="Name">
          <input type="text" value={object.name} onChange={e => onChange({ ...object, name: e.target.value })}
            className="input-field w-full text-xs py-1.5" />
        </Field>
        <Field label="Category">
          <EditableSelect value={object.category} options={OBJECT_CATEGORIES}
            onChange={value => onChange({ ...object, category: value })} />
        </Field>
        <Field label="Color">
          <EditableSelect value={object.color} options={CLOTHING_COLORS}
            onChange={value => onChange({ ...object, color: value })} />
        </Field>
        <Field label="Brand">
          <input type="text" value={object.brand || ''} onChange={e => onChange({ ...object, brand: e.target.value || null })}
            className="input-field w-full text-xs py-1.5" placeholder="e.g. Yamaha" />
        </Field>
        <p className="text-xs text-gv-text-muted">
          {object.bbox ? `BBox: [${object.bbox.x},${object.bbox.y} ${object.bbox.width}x${object.bbox.height}]` : 'Location: unknown (AI-described)'}
          {object.depth != null && <> | Depth: {object.depth.toFixed(2)}</>}
          {detectionConfidence != null && <> | Conf: {(detectionConfidence * 100).toFixed(0)}%</>}
        </p>
        <button onClick={onSave} disabled={!dirty}
          className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${dirty ? 'btn-primary' : 'bg-gv-border text-gv-text-muted cursor-not-allowed'}`}>
          Save Changes
        </button>
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
