'use client'

import { useLang } from '@/services/i18n'

// UI-only sentinel; custom text itself is persisted in the original field.
const CUSTOM_VALUE = '__nuwa_custom_value__'

interface Props {
  value: string
  options: readonly string[]
  onChange: (value: string) => void
  selectClassName?: string
  inputClassName?: string
  placeholder?: string
}

export function EditableSelect({
  value,
  options,
  onChange,
  selectClassName = 'input-field w-full text-sm py-1.5',
  inputClassName = 'input-field w-full text-sm py-1.5',
  placeholder,
}: Props) {
  const { t } = useLang()
  const isCustom = !options.includes(value)

  return (
    <div className="space-y-1">
      <select
        value={isCustom ? CUSTOM_VALUE : value}
        onChange={event => {
          const next = event.target.value
          onChange(next === CUSTOM_VALUE ? '' : next)
        }}
        className={selectClassName}
      >
        {options.map(option => <option key={option} value={option}>{option}</option>)}
        <option value={CUSTOM_VALUE}>{t('annotation.custom_option')}</option>
      </select>
      {isCustom && (
        <input
          type="text"
          value={value}
          onChange={event => onChange(event.target.value)}
          className={inputClassName}
          placeholder={placeholder || t('annotation.custom_placeholder')}
        />
      )}
    </div>
  )
}
