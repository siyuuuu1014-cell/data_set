'use client'

import type { SceneAnnotation, CameraAnnotation, EventAnnotation } from '@/services/video-annotation/types'
import {
  PLACE_TYPES, LIGHTING, TIME_OF_DAY,
  CAMERA_SHOTS, CAMERA_ANGLES, LENS_TYPES, STABILIZATION,
  EVENT_TYPES,
} from '@/services/video-annotation/constants'
import { EditableSelect } from './EditableSelect'

interface Props {
  scene: SceneAnnotation
  camera: CameraAnnotation
  events: EventAnnotation[]
  onChange: (update: { scene?: SceneAnnotation; camera?: CameraAnnotation; events?: EventAnnotation[] }) => void
  onSave: () => void
  dirty: boolean
}

export function SceneCameraEditor({ scene, camera, events, onChange, onSave, dirty }: Props) {
  const place = scene?.place || { type: 'unknown', indoor: true, weather: null, lighting: 'unknown', timeOfDay: 'unknown' }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Place Type">
          <EditableSelect value={place.type} options={PLACE_TYPES}
            onChange={value => onChange({ scene: { ...scene, place: { ...place, type: value } } })} />
        </Field>
        <Field label="Indoor">
          <select value={String(place.indoor)}
            onChange={e => onChange({ scene: { ...scene, place: { ...place, indoor: e.target.value === 'true' } } })}
            className="input-field w-full text-xs py-1.5">
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </Field>
        <Field label="Lighting">
          <EditableSelect value={place.lighting} options={LIGHTING}
            onChange={value => onChange({ scene: { ...scene, place: { ...place, lighting: value } } })} />
        </Field>
        <Field label="Time of Day">
          <EditableSelect value={place.timeOfDay} options={TIME_OF_DAY}
            onChange={value => onChange({ scene: { ...scene, place: { ...place, timeOfDay: value } } })} />
        </Field>
      </div>

      <hr className="border-gv-border-light" />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Shot">
          <EditableSelect value={camera.shot || 'unknown'} options={CAMERA_SHOTS}
            onChange={value => onChange({ camera: { ...camera, shot: value } })} />
        </Field>
        <Field label="Angle">
          <EditableSelect value={camera.angle || 'unknown'} options={CAMERA_ANGLES}
            onChange={value => onChange({ camera: { ...camera, angle: value } })} />
        </Field>
        <Field label="Lens">
          <EditableSelect value={camera.lens || 'unknown'} options={LENS_TYPES}
            onChange={value => onChange({ camera: { ...camera, lens: value } })} />
        </Field>
        <Field label="Stabilization">
          <EditableSelect value={camera.stabilization || 'unknown'} options={STABILIZATION}
            onChange={value => onChange({ camera: { ...camera, stabilization: value } })} />
        </Field>
      </div>

      <Field label="Camera Movement (comma separated)">
        <input type="text" value={(camera.movement || []).join(', ')}
          onChange={e => onChange({ camera: { ...camera, movement: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })}
          className="input-field w-full text-xs py-1.5"
          placeholder="e.g. static, pan_left" />
      </Field>

      {events.length > 0 && (
        <Field label="Events">
          {events.map((ev, i) => (
            <div key={i} className="grid grid-cols-[minmax(9rem,0.7fr)_minmax(12rem,1.3fr)_4rem_auto] gap-2 mt-1">
              <EditableSelect value={ev.type} options={EVENT_TYPES}
                onChange={value => { const next = [...events]; next[i] = { ...next[i], type: value }; onChange({ events: next }) }}
                selectClassName="input-field w-full text-xs py-1"
                inputClassName="input-field w-full text-xs py-1" />
              <input type="text" value={ev.description || ''}
                onChange={e => { const next = [...events]; next[i] = { ...next[i], description: e.target.value }; onChange({ events: next }) }}
                className="input-field w-full text-xs py-1"
                placeholder="Visual event summary" />
              <input type="number" value={ev.confidence} min={0} max={1} step={0.1}
                onChange={e => { const next = [...events]; next[i] = { ...next[i], confidence: parseFloat(e.target.value) || 0 }; onChange({ events: next }) }}
                className="input-field w-16 text-xs py-1 text-center" />
              <button onClick={() => onChange({ events: events.filter((_, j) => j !== i) })}
                className="text-xs text-gv-pink hover:text-gv-pink-dark">✕</button>
            </div>
          ))}
        </Field>
      )}
      <button onClick={() => onChange({ events: [...events, { type: 'unknown', description: '', confidence: 0.5 }] })}
        className="text-xs text-gv-green-deep hover:underline">+ Add event</button>

      <button onClick={onSave} disabled={!dirty}
        className={`rounded px-4 py-1.5 text-sm font-medium transition-colors mt-2 ${dirty ? 'btn-primary' : 'bg-gv-border text-gv-text-muted cursor-not-allowed'}`}>
        Save Scene/Camera
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gv-text-muted mb-0.5">{label}</p>
      {children}
    </div>
  )
}
