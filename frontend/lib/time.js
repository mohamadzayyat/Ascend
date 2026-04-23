import { formatDistanceToNow } from 'date-fns'

export function parseApiTime(value) {
  if (!value) return null
  const text = String(value)
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(text) ? text : `${text}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function relativeLocalTime(value) {
  const date = parseApiTime(value)
  if (!date) return '-'
  return formatDistanceToNow(date, { addSuffix: true })
}

export function absoluteLocalTime(value) {
  const date = parseApiTime(value)
  if (!date) return '-'
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function localDate(value) {
  const date = parseApiTime(value)
  if (!date) return '-'
  return date.toLocaleDateString()
}
