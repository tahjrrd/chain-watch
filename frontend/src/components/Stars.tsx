import { starFillCount, fmtRating } from '../format'

// Rating renderer. In `compact` mode (used by the dense ranking table) it
// renders the numeral only, red when the rating is punishingly low (≤ 2).
export function Stars({
  value,
  compact,
}: {
  value: number | null | undefined
  compact?: boolean
}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className="dim">—</span>
  }
  if (compact) {
    const low = value <= 2
    return (
      <span
        className={'star-compact' + (low ? ' star-low' : '')}
        title={`${fmtRating(value)} of 5`}
      >
        {fmtRating(value)}
      </span>
    )
  }
  const filled = starFillCount(value) ?? 0
  return (
    <span className="stars" title={`${fmtRating(value)} of 5`}>
      <span className="star-glyph">
        {'★'.repeat(filled)}
        <span className="star-glyph-empty">{'★'.repeat(5 - filled)}</span>
      </span>
      <span className="star-num">{fmtRating(value)}</span>
    </span>
  )
}
