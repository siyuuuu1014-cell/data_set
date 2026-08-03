'use client'

import { useState, type CSSProperties, type ReactNode } from 'react'
import styles from './sliding-control.module.css'

export interface SlidingOption<T extends string> {
  value: T
  label: ReactNode
  ariaLabel?: string
  description?: string
  disabled?: boolean
}

export interface SlidingControlProps<T extends string> {
  value: T
  options: SlidingOption<T>[]
  onChange: (value: T) => void
  label: string
  className?: string
  compact?: boolean
}

export function SlidingControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  compact = false,
}: SlidingControlProps<T>) {
  const [previewValue, setPreviewValue] = useState<T | null>(null)
  const visualValue = previewValue ?? value
  const matchedIndex = options.findIndex(option => option.value === visualValue)
  const visualIndex = Math.max(0, matchedIndex)
  const style = {
    '--slide-count': options.length,
    '--slide-index': visualIndex,
  } as CSSProperties

  return (
    <div
      className={[styles.control, compact ? styles.compact : '', className ?? ''].filter(Boolean).join(' ')}
      role="group"
      aria-label={label}
      data-has-selection={matchedIndex >= 0}
      onMouseLeave={() => setPreviewValue(null)}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPreviewValue(null)
      }}
      style={style}
    >
      <span className={styles.indicator} aria-hidden="true" />
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          aria-label={option.ariaLabel}
          aria-pressed={value === option.value}
          data-visual={visualValue === option.value}
          disabled={option.disabled}
          onMouseEnter={() => !option.disabled && setPreviewValue(option.value)}
          onFocus={() => !option.disabled && setPreviewValue(option.value)}
          onClick={() => {
            onChange(option.value)
            setPreviewValue(null)
          }}
        >
          <strong>{option.label}</strong>
          {option.description && <small>{option.description}</small>}
        </button>
      ))}
    </div>
  )
}
