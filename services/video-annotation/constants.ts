// ── Canvas ───────────────────────────────────────────────

export const CANVAS_MAX_W = 1280
export const CANVAS_MAX_H = 1024
export const CANVAS_MIN_BOX_SIZE = 4

export const BOX_COLORS = [
  '#FF6CCE', '#CCED68', '#F5B840', '#60A5FA', '#F472B6',
  '#34D399', '#A78BFA', '#FB923C', '#38BDF8', '#A3E635',
  '#F87171', '#818CF8',
]

// ── Upload limits ────────────────────────────────────────

export const MAX_BATCH_FILES = 20
export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024  // 2GB
export const MAX_DURATION_SEC = 3600  // 60 min
export const ALLOWED_VIDEO_TYPES = ['mp4', 'mov', 'avi', 'mkv', 'webm']

// ── Scene detection defaults ─────────────────────────────

export const MIN_SEGMENT_SEC = 0.5
export const DEFAULT_MAX_SEGMENT_SEC = 10
export const OVERLONG_SPLIT_SEC = 8
export const SCENE_THRESHOLD = 27

// ── Inference defaults ───────────────────────────────────

export const SAMPLE_FPS = 0.5
export const MAX_FRAMES = 8
export const MAX_NEW_TOKENS = 900
export const MAX_PIXELS = 256 * 256
export const CONFIDENCE_THRESHOLD = 0.5

// ── Worker ───────────────────────────────────────────────

export const WORKER_URL = 'http://127.0.0.1:8765'
export const WORKER_POLL_INTERVAL_MS = 2000

// ── Model names ──────────────────────────────────────────

export const YOLO_MODEL = 'yolo11n'
export const QWEN_MODEL = 'Qwen/Qwen3-VL-2B-Instruct'
export const LOCATE_ANYTHING_MODEL = 'nvidia/LocateAnything-3B'
export const DEPTH_ANYTHING_MODEL = 'depth-anything-v2-small'

// ── Ontology: Hair ───────────────────────────────────────

export const HAIR_COLORS = ['black', 'brown', 'blonde', 'red', 'gray', 'white', 'blue', 'pink', 'green', 'bald', 'unknown']
export const HAIR_STYLES = ['short', 'medium', 'long', 'curly', 'straight', 'wavy', 'buzz_cut', 'ponytail', 'bun', 'braid', 'afro', 'dreadlocks', 'bald', 'unknown']

// ── Ontology: Person ─────────────────────────────────────

export const GENDERS = ['male', 'female', 'unknown']
export const AGE_GROUPS = ['infant', 'child', 'teen', 'young_adult', 'middle_aged', 'elderly', 'unknown']
export const EXPRESSIONS = ['neutral', 'happy', 'sad', 'surprised', 'angry', 'fearful', 'disgusted', 'focused', 'unknown']
export const POSES = ['standing', 'sitting', 'lying', 'walking', 'running', 'kneeling', 'crouching', 'jumping', 'unknown']
export const FACING = ['front', 'back', 'left', 'right', 'front_left', 'front_right', 'back_left', 'back_right', 'unknown']

// ── Ontology: Actions ────────────────────────────────────

export const ACTIONS = [
  'walking', 'running', 'sitting', 'standing', 'lying',
  'jumping', 'dancing', 'swimming', 'climbing', 'falling',
  'eating', 'drinking', 'smoking', 'reading', 'writing',
  'typing', 'talking', 'shouting', 'singing', 'laughing',
  'crying', 'sleeping', 'waving', 'pointing', 'clapping',
  'hugging', 'shaking_hands', 'fighting', 'playing',
  'carrying', 'pushing', 'pulling', 'lifting', 'throwing',
  'catching', 'kicking', 'hitting',
  'looking_up', 'looking_down', 'looking_left', 'looking_right',
  'playing_piano', 'playing_guitar', 'cooking', 'cleaning',
  'driving', 'riding_bicycle', 'riding_motorcycle',
  'using_phone', 'taking_photo', 'filming',
  'unknown',
]

// ── Ontology: Clothing ───────────────────────────────────

export const CLOTHING_TYPES = [
  'tshirt', 'shirt', 'blouse', 'polo', 'sweater', 'hoodie',
  'jacket', 'coat', 'blazer', 'vest', 'tank_top',
  'dress', 'skirt', 'jeans', 'pants', 'shorts', 'leggings',
  'suit', 'uniform', 'robe', 'pajamas', 'swimwear',
  'hat', 'cap', 'helmet', 'scarf', 'tie', 'gloves',
  'shoes', 'boots', 'sandals', 'sneakers',
  'backpack', 'bag', 'suitcase',
  'unknown',
]

export const CLOTHING_COLORS = [
  'white', 'black', 'gray', 'red', 'blue', 'green', 'yellow',
  'orange', 'purple', 'pink', 'brown', 'beige', 'navy',
  'multi_color', 'unknown',
]

export const CLOTHING_ATTRIBUTES = [
  'short_sleeve', 'long_sleeve', 'sleeveless',
  'solid', 'striped', 'plaid', 'floral', 'graphic', 'camo',
  'tight', 'loose', 'cropped', 'oversized',
  'zippered', 'buttoned', 'hooded',
]

// ── Ontology: Place ──────────────────────────────────────

export const PLACE_TYPES = [
  'living_room', 'bedroom', 'kitchen', 'bathroom', 'dining_room',
  'office', 'classroom', 'library', 'laboratory',
  'street', 'sidewalk', 'park', 'playground', 'garden',
  'store', 'restaurant', 'cafe', 'bar', 'gym',
  'hospital', 'clinic', 'airport', 'station', 'subway',
  'stadium', 'theater', 'museum', 'church', 'temple',
  'beach', 'forest', 'mountain', 'desert', 'lake', 'river',
  'parking_lot', 'highway', 'bridge', 'tunnel',
  'indoor_unknown', 'outdoor_unknown', 'unknown',
]

export const LIGHTING = ['natural', 'artificial', 'dim', 'bright', 'backlit', 'frontlit', 'mixed', 'unknown']
export const TIME_OF_DAY = ['morning', 'afternoon', 'evening', 'night', 'dawn', 'dusk', 'unknown']

// ── Ontology: Camera ─────────────────────────────────────

export const CAMERA_SHOTS = [
  'extreme_long', 'long', 'full', 'medium_long', 'medium',
  'medium_close_up', 'close_up', 'extreme_close_up', 'unknown',
]

export const CAMERA_ANGLES = [
  'eye_level', 'high_angle', 'low_angle', 'overhead',
  'ground_level', 'dutch_angle', 'pov', 'unknown',
]

export const CAMERA_MOVEMENTS = [
  'static', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down',
  'push_in', 'pull_out', 'zoom_in', 'zoom_out',
  'tracking', 'crane_up', 'crane_down', 'handheld',
  'orbit_left', 'orbit_right', 'unknown',
]

export const LENS_TYPES = ['standard', 'wide', 'telephoto', 'macro', 'fisheye', 'unknown']
export const STABILIZATION = ['tripod', 'gimbal', 'handheld_stable', 'handheld_shaky', 'drone', 'unknown']

// ── Ontology: Events ─────────────────────────────────────

export const EVENT_TYPES = [
  'music_performance', 'sports_activity', 'dance_performance',
  'conversation', 'argument', 'celebration', 'ceremony',
  'cooking', 'eating', 'cleaning', 'repairing',
  'shopping', 'commuting', 'exercising',
  'playing', 'studying', 'working',
  'accident', 'emergency',
  'unknown',
]

// ── Ontology: Objects ────────────────────────────────────

export const OBJECT_CATEGORIES = [
  'furniture', 'instrument', 'vehicle', 'electronics',
  'kitchenware', 'tool', 'toy', 'sports_equipment',
  'food', 'beverage', 'plant', 'animal',
  'book', 'container', 'decoration', 'sign',
  'weapon', 'medical_equipment', 'office_supply',
  'text', 'other', 'unknown',
]

// ── Error codes ──────────────────────────────────────────

export const ERROR_CODES = {
  VIDEO_FILE_TOO_LARGE: 'VIDEO_FILE_TOO_LARGE',
  VIDEO_FORMAT_UNSUPPORTED: 'VIDEO_FORMAT_UNSUPPORTED',
  VIDEO_METADATA_FAILED: 'VIDEO_METADATA_FAILED',
  SCENE_DETECTION_FAILED: 'SCENE_DETECTION_FAILED',
  SEGMENTS_NOT_CONFIRMED: 'SEGMENTS_NOT_CONFIRMED',
  WORKER_UNAVAILABLE: 'WORKER_UNAVAILABLE',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  CUDA_UNAVAILABLE: 'CUDA_UNAVAILABLE',
  CUDA_OUT_OF_MEMORY: 'CUDA_OUT_OF_MEMORY',
  SEMANTIC_PROVIDER_FAILED: 'SEMANTIC_PROVIDER_FAILED',
  DETECTOR_PROVIDER_FAILED: 'DETECTOR_PROVIDER_FAILED',
  TRACKER_FAILED: 'TRACKER_FAILED',
  MERGE_FAILED: 'MERGE_FAILED',
  SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',
  STORAGE_PERMISSION_DENIED: 'STORAGE_PERMISSION_DENIED',
  EXPORT_FAILED: 'EXPORT_FAILED',
} as const
