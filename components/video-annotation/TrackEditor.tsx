'use client'

import type { PersonAnnotation, ObjectAnnotation } from '@/services/video-annotation/types'
import {
  GENDERS, AGE_GROUPS, POSES, FACING, EXPRESSIONS,
  HAIR_COLORS, HAIR_STYLES, CLOTHING_TYPES, CLOTHING_COLORS,
  OBJECT_CATEGORIES,
} from '@/services/video-annotation/constants'

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
            <select value={person.gender} onChange={e => onChange({ ...person, gender: e.target.value })}
              className="input-field w-full text-xs py-1.5">
              {GENDERS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Age Group">
            <select value={person.ageGroup} onChange={e => onChange({ ...person, ageGroup: e.target.value })}
              className="input-field w-full text-xs py-1.5">
              {AGE_GROUPS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Pose">
            <select value={person.pose} onChange={e => onChange({ ...person, pose: e.target.value })}
              className="input-field w-full text-xs py-1.5">
              {POSES.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Facing">
            <select value={person.facing} onChange={e => onChange({ ...person, facing: e.target.value })}
              className="input-field w-full text-xs py-1.5">
              {FACING.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Expression">
            <select value={person.expression} onChange={e => onChange({ ...person, expression: e.target.value })}
              className="input-field w-full text-xs py-1.5">
              {EXPRESSIONS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Occlusion">
            <select value={String(person.occlusion)} onChange={e => onChange({ ...person, occlusion: parseFloat(e.target.value) })}
              className="input-field w-full text-xs py-1.5">
              {[0, 0.1, 0.25, 0.5, 0.75, 1.0].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hair Color">
            <select value={person.hair?.color || 'unknown'} onChange={e => onChange({ ...person, hair: { ...person.hair, color: e.target.value } })}
              className="input-field w-full text-xs py-1.5">
              {HAIR_COLORS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Hair Style">
            <select value={person.hair?.style || 'unknown'} onChange={e => onChange({ ...person, hair: { ...person.hair, style: e.target.value } })}
              className="input-field w-full text-xs py-1.5">
              {HAIR_STYLES.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
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
            <div key={i} className="flex gap-2 mb-1">
              <select value={c.type} onChange={e => {
                const next = [...(person.clothing || [])]
                next[i] = { ...next[i], type: e.target.value }
                onChange({ ...person, clothing: next })
              }} className="input-field flex-1 text-xs py-1">
                {CLOTHING_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <select value={c.color} onChange={e => {
                const next = [...(person.clothing || [])]
                next[i] = { ...next[i], color: e.target.value }
                onChange({ ...person, clothing: next })
              }} className="input-field w-24 text-xs py-1">
                {CLOTHING_COLORS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
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
          <select value={object.category} onChange={e => onChange({ ...object, category: e.target.value })}
            className="input-field w-full text-xs py-1.5">
            {OBJECT_CATEGORIES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Color">
          <select value={object.color} onChange={e => onChange({ ...object, color: e.target.value })}
            className="input-field w-full text-xs py-1.5">
            {CLOTHING_COLORS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
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
