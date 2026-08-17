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

function countWord(count: number): string {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][count]
    || String(count)
}

function pluralizeLabel(label: string): string {
  if (/(?:s|x|z|ch|sh)$/i.test(label)) return `${label}es`
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`
  return `${label}s`
}

export function deriveGroundedVisualEvent(
  persons: PersonAnnotation[] = [],
  objects: ObjectAnnotation[] = [],
  options: {
    context?: 'frame' | 'segment'
    exactCounts?: boolean
  } = {},
): EventAnnotation | null {
  const context = options.context || 'frame'
  const exactCounts = options.exactCounts ?? true
  const actions = [...new Set(
    persons
      .flatMap(person => person.action || [])
      .map(action => action.replace(/\s+/g, ' ').trim())
      .filter(action => action && action !== 'unknown'),
  )].slice(0, 3)
  const objectCounts = new Map<string, number>()
  for (const object of objects) {
    if (!object.bbox || object.category === 'text') continue
    const name = typeof object.name === 'string'
      ? object.name.replace(/\s+/g, ' ').trim()
      : ''
    if (!name || name === 'unknown') continue
    objectCounts.set(name, (objectCounts.get(name) || 0) + 1)
  }
  const visibleObjectGroups = [...objectCounts.entries()]
    .slice(0, 3)
    .map(([name, count]) => (
      exactCounts
        ? `${countWord(count)} ${count === 1 ? name : pluralizeLabel(name)}`
        : count === 1 ? `a ${name}` : pluralizeLabel(name)
    ))

  const parts: string[] = []
  if (persons.length) {
    const people = exactCounts
      ? persons.length === 1 ? 'one person' : `${countWord(persons.length)} people`
      : persons.length === 1 ? 'a person' : 'people'
    parts.push(actions.length
      ? `The ${context} shows ${people}, with visible actions including ${joinNatural(actions)}`
      : `The ${context} shows ${people}`)
  }
  if (visibleObjectGroups.length) {
    const visibleObjects = joinNatural(visibleObjectGroups)
    parts.push(parts.length ? `alongside ${visibleObjects}` : `The ${context} shows ${visibleObjects}`)
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
    .filter(event => typeof event.type !== 'string' || !event.type.startsWith('[Speech]'))
  if (visualEvents.length) return visualEvents
  const fallback = deriveGroundedVisualEvent(
    annotation.persons || [],
    annotation.objects || [],
    { context: 'segment', exactCounts: false },
  )
  return fallback ? [fallback] : []
}
