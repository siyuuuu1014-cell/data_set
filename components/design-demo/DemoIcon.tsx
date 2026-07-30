import type { SVGProps } from 'react'

export type DemoIconName =
  | 'annotations'
  | 'archive'
  | 'box'
  | 'chevron'
  | 'check'
  | 'clock'
  | 'dataset'
  | 'layers'
  | 'more'
  | 'pause'
  | 'play'
  | 'publish'
  | 'redo'
  | 'review'
  | 'search'
  | 'settings'
  | 'spark'
  | 'undo'
  | 'warning'
  | 'zoomIn'
  | 'zoomOut'

const paths: Record<DemoIconName, React.ReactNode> = {
  annotations: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 9 5 3-5 3V9Z"/></>,
  archive: <><path d="M4 7h16v13H4z"/><path d="M3 4h18v3H3zM9 11h6"/></>,
  box: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.7 7.5 4.2 7.5-4.2M12 12v9"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  dataset: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  pause: <><path d="M9 7v10M15 7v10"/></>,
  play: <path d="m9 7 8 5-8 5V7Z"/>,
  publish: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 14v5h14v-5"/></>,
  redo: <><path d="m17 7 4 4-4 4"/><path d="M3 18v-2a5 5 0 0 1 5-5h13"/></>,
  review: <><path d="M4 5h16v14H4z"/><path d="m8 12 2.5 2.5L16 9"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1-2.8 2.8-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-.9 1.5V21h-4v-.2a1.6 1.6 0 0 0-.9-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1-2.8-2.8.1-.1A1.6 1.6 0 0 0 5 15a1.6 1.6 0 0 0-1.5-.9H3v-4h.5A1.6 1.6 0 0 0 5 9.2a1.6 1.6 0 0 0-.3-1.8l-.1-.1 2.8-2.8.1.1A1.6 1.6 0 0 0 9.3 5a1.6 1.6 0 0 0 .9-1.5V3h4v.5a1.6 1.6 0 0 0 .9 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1 2.8 2.8-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5.9h.1v4h-.1a1.6 1.6 0 0 0-1.5.8Z"/></>,
  spark: <><path d="m13 2-1 7H5l6 4-2 9 7-10h-7l4-10Z"/></>,
  undo: <><path d="m7 7-4 4 4 4"/><path d="M21 18v-2a5 5 0 0 0-5-5H3"/></>,
  warning: <><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17h.01"/></>,
  zoomIn: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M10 7v6M7 10h6"/></>,
  zoomOut: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6"/></>,
}

export function DemoIcon({ name, ...props }: { name: DemoIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  )
}
