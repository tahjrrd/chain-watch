// Formatting helpers. null / undefined always render as an em dash.

export const DASH = '—'

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH
  return n.toLocaleString('en-US')
}

// Compact dollars: $0, $450, $45k, $1.2M
export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH
  if (n === 0) return '$0'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) {
    return `$${trim(n / 1_000_000)}M`
  }
  if (abs >= 1_000) {
    return `$${trim(n / 1_000)}k`
  }
  return `$${Math.round(n).toLocaleString('en-US')}`
}

function trim(v: number): string {
  // one decimal, drop a trailing .0
  const s = v.toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

export function fmtPct(
  n: number | null | undefined,
  digits = 1,
): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH
  return `${n.toFixed(digits)}%`
}

// Rating number rendered to one decimal (e.g. avg 2.1) or whole (facility 2).
export function fmtRating(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

// Number of filled stars out of 5, rounded to nearest whole. Rendered as
// monochrome ★ glyphs (filled = ink, empty = faint border) by <Stars>.
export function starFillCount(n: number | null | undefined): number | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null
  return Math.max(0, Math.min(5, Math.round(n)))
}

// Bucket a facility overall rating into a color band.
export type RatingBand = 'low' | 'mid' | 'high' | 'none'

export function ratingBand(n: number | null | undefined): RatingBand {
  if (n === null || n === undefined || Number.isNaN(n)) return 'none'
  if (n <= 2) return 'low'
  if (n === 3) return 'mid'
  return 'high'
}

export const BAND_COLOR: Record<RatingBand, string> = {
  low: '#b91c1c',
  mid: '#b45309',
  high: '#15803d',
  none: '#9aa2ab',
}

// Human labels for flag keys used in chain-detail chips.
export const FLAG_LABELS: Record<string, string> = {
  abuse: 'Abuse citation',
  special_focus: 'Special Focus',
  stale_inspection: 'Inspection > 2yr',
  ownership_change: 'Ownership change',
  high_turnover: 'High turnover',
  heavy_fines: 'Heavy fines',
  low_staffing: 'Low staffing',
}

export const FLAG_DETAIL: Record<string, string> = {
  abuse: 'CMS abuse icon is set for this facility',
  special_focus: 'Special Focus Facility or candidate',
  stale_inspection: 'Most recent health inspection more than 2 years ago',
  ownership_change: 'Provider changed ownership in the last 12 months',
  high_turnover: 'Total nursing staff turnover at or above dataset 75th percentile',
  heavy_fines: 'Total fines at or above 90th percentile of nonzero fine totals',
  low_staffing: 'Staffing rating of 2 stars or fewer',
}

export function flagLabel(key: string): string {
  return FLAG_LABELS[key] ?? key
}

export function flagDetail(key: string): string {
  return FLAG_DETAIL[key] ?? ''
}

// Title-case raw CMS uppercase strings ("ICARE CONSULTING SERVICES" ->
// "Icare Consulting Services"). Standalone state codes stay uppercase.
const KEEP_UPPER = new Set(['Ii', 'Iii', 'Iv', 'Llc', 'Snf'])
export function titleCase(s: string | null | undefined): string {
  if (!s) return '—'
  if (/^[A-Z]{2}$/.test(s.trim())) return s.trim()
  return s
    .toLowerCase()
    .replace(/\b([a-z])(\w*)/g, (_, a: string, rest: string) => a.toUpperCase() + rest)
    .replace(/\b(Ii|Iii|Iv|Llc|Snf)\b/g, (m) => (KEEP_UPPER.has(m) ? m.toUpperCase() : m))
}
