import type {
  ObjectAnnotation,
  PersonAnnotation,
  SegmentAnnotation,
  SegmentState,
  VideoTaskItem,
} from './types'
import { fillEmptyPersonAttributes } from './frame-annotations'

function emptyLabel(value: string | null | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return !normalized || normalized === 'unknown'
}

function completePersonSuggestion(
  suggestion: Partial<PersonAnnotation> & Pick<PersonAnnotation, 'trackId'>,
): PersonAnnotation {
  return {
    trackId: suggestion.trackId,
    personId: suggestion.personId || null,
    gender: suggestion.gender || 'unknown',
    ageGroup: suggestion.ageGroup || 'unknown',
    hair: {
      color: suggestion.hair?.color || 'unknown',
      style: suggestion.hair?.style || 'unknown',
    },
    expression: suggestion.expression || 'unknown',
    pose: suggestion.pose || 'unknown',
    action: suggestion.action || [],
    facing: suggestion.facing || 'unknown',
    occlusion: suggestion.occlusion || 0,
    clothing: suggestion.clothing || [],
    bbox: suggestion.bbox || { x: 0, y: 0, width: 1, height: 1 },
    depth: suggestion.depth ?? null,
    keypoints: suggestion.keypoints || [],
  }
}

/**
 * Surface newly bound model semantics in an existing review copy without
 * replacing any value the reviewer already chose.
 */
export function reconcileEmptyHumanEntityAttributes(
  human: SegmentAnnotation,
  model: SegmentAnnotation,
): void {
  const modelPersonsByIdentity = new Map(
    (model.persons || []).flatMap(person => person.personId ? [[person.personId, person] as const] : []),
  )
  const modelPersonsByTrack = new Map((model.persons || []).map(person => [person.trackId, person]))
  human.persons = (human.persons || []).map(person => {
    const suggestion = (person.personId && modelPersonsByIdentity.get(person.personId))
      || (person._className === 'manual' ? undefined : modelPersonsByTrack.get(person.trackId))
    return suggestion ? fillEmptyPersonAttributes(person, suggestion) : person
  })

  const modelObjectsByTrack = new Map((model.objects || []).map(object => [object.trackId, object]))
  human.objects = (human.objects || []).map(object => {
    const suggestion = modelObjectsByTrack.get(object.trackId)
    if (!suggestion) return object
    return {
      ...object,
      name: emptyLabel(object.name) ? suggestion.name : object.name,
      category: emptyLabel(object.category) ? suggestion.category : object.category,
      color: emptyLabel(object.color) ? suggestion.color : object.color,
      brand: object.brand || suggestion.brand,
    }
  })
}

/**
 * Store a completed Worker result without discarding a human-reviewed copy.
 *
 * Human annotations intentionally remain authoritative in the review UI. The
 * newly generated model result is still retained separately for diagnostics
 * and future comparison.
 */
export function applyCompletedModelResult(
  segment: SegmentState,
  result: SegmentAnnotation,
): void {
  const completedMode = segment.processingMode || 'standard'
  const hasTransportMetadata = Boolean(
    result._identity_aliases
    || result._review_person_suggestions
    || result._review_object_suggestions,
  )
  const persistedResult = hasTransportMetadata
    ? {
        ...result,
        _identity_aliases: undefined,
        _review_person_suggestions: undefined,
        _review_object_suggestions: undefined,
      }
    : result
  segment.modelAnnotation = persistedResult
  if (segment.humanAnnotation) {
    const reviewModel: SegmentAnnotation = {
      ...persistedResult,
      persons: [
        ...(persistedResult.persons || []),
        ...(result._review_person_suggestions || []).map(completePersonSuggestion),
      ],
      objects: [
        ...(persistedResult.objects || []),
        ...((result._review_object_suggestions || []) as ObjectAnnotation[]),
      ],
    }
    reconcileEmptyHumanEntityAttributes(segment.humanAnnotation, reviewModel)
  }
  segment.status = result._pipeline_status === 'partial_completed'
    ? 'partial_completed'
    : 'completed'

  const errors = result._pipeline_errors
  if (errors?.length) {
    segment.error = errors.join('; ')
  } else {
    delete segment.error
  }
  delete segment.progressPhase
  segment.lastCompletedMode = completedMode
  delete segment.processingMode
}

/** Apply Worker identity reconciliation to every saved segment of one video. */
export function applyIdentityAliasesToVideo(
  video: VideoTaskItem,
  aliases: Record<string, string> | undefined,
): void {
  if (!aliases || Object.keys(aliases).length === 0) return

  const resolve = (personId: string): string => {
    let current = personId
    const visited = new Set<string>()
    while (aliases[current] && !visited.has(current)) {
      visited.add(current)
      current = aliases[current]
    }
    return current
  }

  for (const segment of video.segments || []) {
    for (const annotation of [segment.modelAnnotation, segment.humanAnnotation]) {
      if (!annotation) continue
      for (const person of annotation.persons || []) {
        if (person.personId) person.personId = resolve(person.personId)
      }
    }
  }
}
