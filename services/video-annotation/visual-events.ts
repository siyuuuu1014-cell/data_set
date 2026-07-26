import type {
  EventAnnotation,
  ObjectAnnotation,
  PersonAnnotation,
  SegmentAnnotation,
} from './types'

function joinNatural(values: string[]): string {
  if (values.length < 2) return values[0] || ''
  if (values.length === 2) return `${values[0]} and ${values[1]}`
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`
}

export function deriveGroundedVisualEvent(
  persons: PersonAnnotation[] = [],
  objects: ObjectAnnotation[] = [],
): EventAnnotation | null {
  const actions = [...new Set(
    persons
      .flatMap(person => person.action || [])
      .map(action => action.replace(/\s+/g, ' ').trim())
      .filter(action => action && action !== 'unknown'),
  )].slice(0, 3)
  const objectNames = [...new Set(
    objects
      .filter(object => object.bbox && object.category !== 'text')
      .map(object => object.name.replace(/\s+/g, ' ').trim())
      .filter(name => name && name !== 'unknown'),
  )].slice(0, 3)

  const parts: string[] = []
  if (persons.length) {
    const people = persons.length === 1 ? 'one person' : `${persons.length} people`
    parts.push(actions.length
      ? `The frame shows ${people}, with visible actions including ${joinNatural(actions)}`
      : `The frame shows ${people}`)
  }
  if (objectNames.length) {
    const visibleObjects = joinNatural(objectNames)
    parts.push(parts.length ? `alongside ${visibleObjects}` : `The frame shows ${visibleObjects}`)
  }
  if (!parts.length) return null

  return {
    type: 'visual_activity',
    description: `${parts.join(', ')}.`,
    confidence: 0.6,
  }
}

export function visualEventsFor(annotation: SegmentAnnotation): EventAnnotation[] {
  const visualEvents = (annotation.events || [])
    .filter(event => !event.type.startsWith('[Speech]'))
  if (visualEvents.length) return visualEvents
  const fallback = deriveGroundedVisualEvent(annotation.persons || [], annotation.objects || [])
  return fallback ? [fallback] : []
}
