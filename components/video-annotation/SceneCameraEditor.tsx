'use client'

import type { SceneAnnotation, CameraAnnotation, EventAnnotation } from '@/services/video-annotation/types'
import {
  PLACE_TYPES, LIGHTING, TIME_OF_DAY,
  CAMERA_SHOTS, CAMERA_ANGLES, LENS_TYPES, STABILIZATION,
  EVENT_TYPES,
} from '@/services/video-annotation/constants'
import { EditableSelect } from './EditableSelect'
import { useLang } from '@/services/i18n'

interface Props {
  scene: SceneAnnotation
  camera: CameraAnnotation
  events: EventAnnotation[]
  onChange: (update: { scene?: SceneAnnotation; camera?: CameraAnnotation; events?: EventAnnotation[] }) => void
  onSave: () => void
  dirty: boolean
}

export function SceneCameraEditor({ scene, camera, events, onChange, onSave, dirty }: Props) {
  const { t } = useLang()
  const place = scene?.place || { type: 'unknown', indoor: true, weather: null, lighting: 'unknown', timeOfDay: 'unknown' }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('annotation.place_type')}>
          <EditableSelect value={place.type} options={PLACE_TYPES}
            onChange={value => onChange({ scene: { ...scene, place: { ...place, type: value } } })} />
        </Field>
        <Field label={t('annotation.indoor')}>
          <select value={String(place.indoor)}
            onChange={e => onChange({ scene: { ...scene, place: { ...place, indoor: e.target.value === 'true' } } })}
            className="input-field w-full text-sm py-1.5">
            <option value="true">{t('annotation.yes')}</option>
            <option value="false">{t('annotation.no')}</option>
          </select>
        </Field>
        <Field label={t('annotation.lighting')}>
          <EditableSelect value={place.lighting} options={LIGHTING}
            onChange={value => onChange({ scene: { ...scene, place: { ...place, lighting: value } } })} />
        </Field>
        <Field label={t('annotation.time_of_day')}>
          <EditableSelect value={place.timeOfDay} options={TIME_OF_DAY}
            onChange={value => onChange({ scene: { ...scene, place: { ...place, timeOfDay: value } } })} />
        </Field>
      </div>

      <hr className="border-gv-border-light" />

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('annotation.shot')}>
          <EditableSelect value={camera.shot || 'unknown'} options={CAMERA_SHOTS}
            onChange={value => onChange({ camera: { ...camera, shot: value } })} />
        </Field>
        <Field label={t('annotation.angle')}>
          <EditableSelect value={camera.angle || 'unknown'} options={CAMERA_ANGLES}
            onChange={value => onChange({ camera: { ...camera, angle: value } })} />
        </Field>
        <Field label={t('annotation.lens')}>
          <EditableSelect value={camera.lens || 'unknown'} options={LENS_TYPES}
            onChange={value => onChange({ camera: { ...camera, lens: value } })} />
        </Field>
        <Field label={t('annotation.stabilization')}>
          <EditableSelect value={camera.stabilization || 'unknown'} options={STABILIZATION}
            onChange={value => onChange({ camera: { ...camera, stabilization: value } })} />
        </Field>
      </div>

      <Field label={t('annotation.camera_movement')}>
        <input type="text" value={(camera.movement || []).join(', ')}
          onChange={e => onChange({ camera: { ...camera, movement: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })}
          className="input-field w-full text-sm py-1.5"
          placeholder={t('annotation.camera_movement_placeholder')} />
      </Field>

      {events.length > 0 && (
        <Field label={t('annotation.events')}>
          {events.map((ev, i) => (
            <div key={i} className="grid grid-cols-[minmax(9rem,0.7fr)_minmax(12rem,1.3fr)_4rem_auto] gap-2 mt-1">
              <EditableSelect value={ev.type} options={EVENT_TYPES}
                onChange={value => { const next = [...events]; next[i] = { ...next[i], type: value }; onChange({ events: next }) }}
                selectClassName="input-field w-full text-sm py-1"
                inputClassName="input-field w-full text-sm py-1" />
              <input type="text" value={ev.description || ''}
                onChange={e => { const next = [...events]; next[i] = { ...next[i], description: e.target.value }; onChange({ events: next }) }}
                className="input-field w-full text-sm py-1"
                placeholder={t('annotation.event_summary_placeholder')} />
              <input type="number" value={ev.confidence} min={0} max={1} step={0.1}
                onChange={e => { const next = [...events]; next[i] = { ...next[i], confidence: parseFloat(e.target.value) || 0 }; onChange({ events: next }) }}
                className="input-field w-16 text-sm py-1 text-center" />
              <button onClick={() => onChange({ events: events.filter((_, j) => j !== i) })}
                className="text-xs text-gv-pink hover:text-gv-pink-dark" aria-label={t('annotation.remove_event', i + 1)} title={t('annotation.remove_event', i + 1)}>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </Field>
      )}
      <button onClick={() => onChange({ events: [...events, { type: 'unknown', description: '', confidence: 0.5 }] })}
        className="inline-flex items-center gap-1 text-xs text-gv-green-deep hover:underline">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        {t('annotation.add_event')}
      </button>

      <button onClick={onSave} disabled={!dirty}
        className={`rounded px-4 py-1.5 text-sm font-medium transition-colors mt-2 ${dirty ? 'btn-primary' : 'bg-gv-border text-gv-text-muted cursor-not-allowed'}`}>
        {t('annotation.save_scene_camera')}
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
