export type ApiFormat = 'openai' | 'anthropic'

export interface LlmConfig {
  apiKey: string
  baseUrl: string
  model: string
  apiFormat: ApiFormat
}

export type ColumnType = 'text' | 'number' | 'boolean' | 'date' | 'foreign_key' | 'foreign_key_array' | 'id' | 'phone' | 'city'

export type PhoneCountry = 'CN' | 'US' | 'JP' | 'KR' | 'GB' | 'DE' | 'FR' | 'IN' | 'BR' | 'AU'

export type IdFormat = 'uuid4' | 'uuid7' | 'snowflake' | 'auto_increment' | 'cuid2' | 'objectid' | 'nanoid' | 'ulid'

export type DateFormat = 'iso' | 'datetime' | 'date' | 'date_slash' | 'date_us' | 'date_eu' | 'time' | 'unix_s' | 'unix_ms'

export interface DateRange {
  label: string
  minDays: number
  maxDays: number // 0 means no upper bound
  ratio: number   // 0-100 weight
}

export interface ColumnDef {
  id: string
  name: string
  type: ColumnType
  llmPrompt?: string
  generationCode?: string
  foreignTable?: string
  foreignColumn?: string
  idFormat?: IdFormat
  dateFormat?: DateFormat
  dateDistribution?: DateRange[]
  phoneCountry?: PhoneCountry
  cityCountry?: PhoneCountry
  nullable?: boolean
  nullRatio?: number   // 0-100, percentage of null values
}

export interface TableDef {
  id: string
  name: string
  columns: ColumnDef[]
  rows: Record<string, unknown>[]
}

export interface Project {
  id: string
  name: string
  createdAt: string
}
