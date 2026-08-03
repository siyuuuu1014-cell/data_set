'use client'

import { useEffect, useState } from 'react'
import type { ManualSection } from './MarkdownManual'

type ManualTocProps = {
  sections: ManualSection[]
  className?: string
  linkClassName?: string
  activeLinkClassName?: string
}

export function ManualToc({
  sections,
  className,
  linkClassName,
  activeLinkClassName,
}: ManualTocProps) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? '')

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      let next = sections[0]?.id ?? ''

      for (const section of sections) {
        const heading = document.getElementById(section.id)
        if (!heading || heading.getBoundingClientRect().top > 168) break
        next = section.id
      }

      setActiveId(previous => previous === next ? previous : next)
    }
    const handleScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [sections])

  return (
    <nav className={className} aria-label="用户手册目录">
      {sections.map(section => (
        <a
          className={`${linkClassName ?? ''} ${activeId === section.id ? activeLinkClassName ?? '' : ''}`.trim()}
          href={`#${section.id}`}
          key={section.id}
          aria-current={activeId === section.id ? 'location' : undefined}
        >
          {section.label}
        </a>
      ))}
    </nav>
  )
}
