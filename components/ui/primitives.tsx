import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from 'react'
import styles from './ui.module.css'

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes(styles.button, styles[variant], styles[size], className)}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      <span>{children}</span>
    </button>
  )
}

export type SurfaceVariant = 'default' | 'raised' | 'subtle'
export type SurfacePadding = 'none' | 'sm' | 'md' | 'lg'

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SurfaceVariant
  padding?: SurfacePadding
}

export function Surface({
  variant = 'default',
  padding = 'md',
  className,
  ...props
}: SurfaceProps) {
  return (
    <div
      {...props}
      className={classes(styles.surface, styles[`surface_${variant}`], styles[`padding_${padding}`], className)}
    />
  )
}

export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone
  dot?: boolean
}

export function StatusBadge({
  tone = 'neutral',
  dot = true,
  className,
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <span {...props} className={classes(styles.badge, styles[`tone_${tone}`], className)}>
      {dot && <span className={styles.badgeDot} aria-hidden="true" />}
      {children}
    </span>
  )
}

export interface InlineNoticeProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Exclude<StatusTone, 'neutral' | 'accent'>
  title?: string
}

export function InlineNotice({
  tone = 'info',
  title,
  className,
  children,
  ...props
}: InlineNoticeProps) {
  return (
    <div
      {...props}
      role={tone === 'danger' ? 'alert' : 'status'}
      className={classes(styles.notice, styles[`notice_${tone}`], className)}
    >
      <span className={styles.noticeMark} aria-hidden="true" />
      <span className={styles.noticeCopy}>
        {title && <strong>{title}</strong>}
        <span>{children}</span>
      </span>
    </div>
  )
}

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div {...props} className={classes(styles.emptyState, className)}>
      {icon && <span className={styles.emptyIcon}>{icon}</span>}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  )
}

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  width?: string | number
  height?: string | number
}

export function Skeleton({ width, height, className, style, ...props }: SkeletonProps) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={classes(styles.skeleton, className)}
      style={{ ...style, width, height }}
    />
  )
}

export type PageWidth = 'narrow' | 'default' | 'wide' | 'full'

export interface PageShellProps extends HTMLAttributes<HTMLElement> {
  width?: PageWidth
}

export function PageShell({ width = 'default', className, ...props }: PageShellProps) {
  return <main {...props} className={classes(styles.pageShell, styles[`width_${width}`], className)} />
}

export interface PageHeaderProps extends HTMLAttributes<HTMLElement> {
  title: string
  description?: string
  actions?: ReactNode
}

export function PageHeader({
  title,
  description,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header {...props} className={classes(styles.pageHeader, className)}>
      <div className={styles.pageHeaderCopy}>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className={styles.pageHeaderActions}>{actions}</div>}
    </header>
  )
}
