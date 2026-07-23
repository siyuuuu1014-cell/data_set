'use client'

import type { SceneAnnotation, CameraAnnotation, EventAnnotation } from '@/services/video-annotation/types'
import {
  PLACE_TYPES, LIGHTING, TIME_OF_DAY,
  CAMERA_SHOTS, CAMERA_ANGLES, LENS_TYPES, STABILIZATION,
  EVENT_TYPES,
} from '@/services/video-annotation/constants'

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
          <select value={place.type}
            onChange={e => onChange({ scene: { ...scene, place: { ...place, type: e.target.value } } })}
            className="input-field w-full text-xs py-1.5">
            {PLACE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
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
          <select value={place.lighting}
            onChange={e => onChange({ scene: { ...scene, place: { ...place, lighting: e.target.value } } })}
            className="input-field w-full text-xs py-1.5">
            {LIGHTING.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Time of Day">
          <select value={place.timeOfDay}
            onChange={e => onChange({ scene: { ...scene, place: { ...place, timeOfDay: e.target.value } } })}
            className="input-field w-full text-xs py-1.5">
            {TIME_OF_DAY.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
      </div>

      <hr className="border-gv-border-light" />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Shot">
          <select value={camera.shot || 'unknown'}
            onChange={e => onChange({ camera: { ...camera, shot: e.target.value } })}
            className="input-field w-full text-xs py-1.5">
            {CAMERA_SHOTS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Angle">
          <select value={camera.angle || 'unknown'}
            onChange={e => onChange({ camera: { ...camera, angle: e.target.value } })}
            className="input-field w-full text-xs py-1.5">
            {CAMERA_ANGLES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Lens">
          <select value={camera.lens || 'unknown'}
            onChange={e => onChange({ camera: { ...camera, lens: e.target.value } })}
            className="input-field w-full text-xs py-1.5">
            {LENS_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Stabilization">
          <select value={camera.stabilization || 'unknown'}
            onChange={e => onChange({ camera: { ...camera, stabilization: e.target.value } })}
            className="input-field w-full text-xs py-1.5">
            {STABILIZATION.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
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
            <div key={i} className="flex gap-2 mt-1">
              <select value={ev.type}
                onChange={e => { const next = [...events]; next[i] = { ...next[i], type: e.target.value }; onChange({ events: next }) }}
                className="input-field flex-1 text-xs py-1">
                {EVENT_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <input type="number" value={ev.confidence} min={0} max={1} step={0.1}
                onChange={e => { const next = [...events]; next[i] = { ...next[i], confidence: parseFloat(e.target.value) || 0 }; onChange({ events: next }) }}
                className="input-field w-16 text-xs py-1 text-center" />
              <button onClick={() => onChange({ events: events.filter((_, j) => j !== i) })}
                className="text-xs text-gv-pink hover:text-gv-pink-dark">✕</button>
            </div>
          ))}
        </Field>
      )}
      <button onClick={() => onChange({ events: [...events, { type: 'unknown', confidence: 0.5 }] })}
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
