'use client'

import { useState, type CSSProperties } from 'react'
import styles from './ui-review.module.css'

export interface SlidingOption<T extends string> {
  value: T
  label: string
  description?: string
}

export function SlidingControl<T extends string>({
  value,
  options,
  onChange,
  label,
  orientation = 'horizontal',
}: {
  value: T
  options: SlidingOption<T>[]
  onChange: (value: T) => void
  label: string
  orientation?: 'horizontal' | 'vertical'
}) {
  const [hoveredValue, setHoveredValue] = useState<T | null>(null)
  const visualValue = hoveredValue ?? value
  const visualIndex = Math.max(0, options.findIndex(option => option.value === visualValue))
  const style = {
    '--slide-count': options.length,
    '--slide-index': visualIndex,
  } as CSSProperties

  return (
    <div
      className={styles.slidingControl}
      data-orientation={orientation}
      onMouseLeave={() => setHoveredValue(null)}
      role="group"
      aria-label={label}
      style={style}
    >
      <span className={styles.slidingIndicator} aria-hidden="true" />
      {options.map(option => (
        <button
          type="button"
          aria-pressed={value === option.value}
          data-visual={visualValue === option.value}
          onMouseEnter={() => setHoveredValue(option.value)}
          onClick={() => {
            onChange(option.value)
            setHoveredValue(null)
          }}
          key={option.value}
        >
          <strong>{option.label}</strong>
          {option.description && <small>{option.description}</small>}
        </button>
      ))}
    </div>
  )
}
