import { useMemo, useState } from 'react'
import type { NearResponse, NearbyFacility, Overview } from '../types'
import { getNear, ApiError } from '../api'
import { fmtInt, fmtMoney, fmtRating, titleCase, flagLabel } from '../format'
import { Stars } from './Stars'
import { FacilityMap } from './FacilityMap'

type Props = {
  overview: Overview | null
  onBack: () => void
  onSelectFacility: (ccn: string) => void
}

type SortMode = 'nearest' | 'concerning'

// "Most concerning first": abuse flag desc, then flag count desc, then fines desc.
function concerningCompare(a: NearbyFacility, b: NearbyFacility): number {
  const aAbuse = a.flags.includes('abuse') ? 1 : 0
  const bAbuse = b.flags.includes('abuse') ? 1 : 0
  if (aAbuse !== bAbuse) return bAbuse - aAbuse
  if (a.flags.length !== b.flags.length) return b.flags.length - a.flags.length
  return (b.fines_dollars ?? 0) - (a.fines_dollars ?? 0)
}

// Plain-language flagged share, e.g. "about 1 in 2 nearby facilities is flagged".
function flaggedSharePhrase(flagged: number, total: number): string {
  if (total <= 0) return 'no facilities to assess nearby'
  if (flagged === 0) return 'none of the nearby facilities are flagged'
  const ratio = total / flagged
  const per = Math.max(1, Math.round(ratio))
  return `about 1 in ${per} nearby facilities is flagged`
}

export function NearMe({ onBack, onSelectFacility }: Props) {
  const [raw, setRaw] = useState('')
  const [data, setData] = useState<NearResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<SortMode>('nearest')

  function search(e: React.FormEvent) {
    e.preventDefault()
    const zip = raw.trim()
    if (!/^\d{5}$/.test(zip)) {
      setError('Enter a 5-digit ZIP code.')
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    setSort('nearest')
    getNear(zip)
      .then((res) => {
        setData(res)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setLoading(false)
        setData(null)
        if (err instanceof ApiError && err.status === 404) {
          setError(err.message)
        } else {
          setError(err instanceof Error ? err.message : 'Search failed')
        }
      })
  }

  const flagged = data ? data.flagged_total : 0
  const abuse = data ? data.abuse_total : 0

  // Everything below is computed from the fetched list — no hardcoded numbers.
  const facilities = data?.facilities ?? []

  const avgOverall = useMemo(() => {
    const rated = facilities
      .map((f) => f.overall_rating)
      .filter((r): r is number => r !== null && !Number.isNaN(r))
    if (rated.length === 0) return null
    return rated.reduce((s, r) => s + r, 0) / rated.length
  }, [facilities])

  // Facilities are returned nearest-first, so the first match is the nearest.
  const worthALook = useMemo(
    () =>
      facilities
        .filter((f) => f.flags.length === 0 && (f.overall_rating ?? 0) >= 4)
        .slice(0, 3),
    [facilities],
  )
  const nearestAny = facilities[0] ?? null

  const nearestAbuse = useMemo(
    () => facilities.find((f) => f.flags.includes('abuse')) ?? null,
    [facilities],
  )

  const displayed = useMemo(
    () => (sort === 'nearest' ? facilities : [...facilities].sort(concerningCompare)),
    [facilities, sort],
  )

  return (
    <div className="chain-view">
      <button className="back-link" onClick={onBack}>
        ← Back to ranking
      </button>

      <h2 className="section-heading">Nursing homes near you</h2>
      <div className="note">
        Enter a ZIP code to see facilities within 40 miles, ranked by distance.
        Flags mark abuse citations, Special Focus status, stale inspections, high
        turnover, heavy fines, and low staffing.
      </div>

      <form className="controls" onSubmit={search}>
        <input
          className="search"
          type="text"
          inputMode="numeric"
          placeholder="ZIP code…"
          value={raw}
          maxLength={5}
          onChange={(e) => setRaw(e.target.value.replace(/[^\d]/g, ''))}
          aria-label="ZIP code"
        />
        <button type="submit" className="seg seg-active">
          Search
        </button>
      </form>

      {error && <div className="note note-warn">{error}</div>}
      {loading && <div className="note">Finding facilities near {raw}…</div>}

      {data && (
        <>
          {/* Decision-aid summary */}
          <div className="dsr-primary nm-stats">
            <div className="dsr-pstat">
              <div className="dsr-pstat-label">Within 40 miles</div>
              <div className="dsr-pstat-value">{fmtInt(data.total)}</div>
              <div className="dsr-pstat-sub">
                {data.total > facilities.length
                  ? `showing nearest ${fmtInt(facilities.length)}`
                  : `${data.total === 1 ? 'facility' : 'facilities'}`}
              </div>
            </div>
            <div className="dsr-pstat">
              <div className="dsr-pstat-label">Flagged</div>
              <div className="dsr-pstat-value dsr-value-red">
                {fmtInt(flagged)}
                {data.total > 0 && (
                  <span className="nm-pct">
                    {' '}
                    ({Math.round((flagged / data.total) * 100)}%)
                  </span>
                )}
              </div>
              <div className="dsr-pstat-sub">of facilities within 40 mi</div>
            </div>
            <div className="dsr-pstat">
              <div className="dsr-pstat-label">Abuse citations</div>
              <div
                className={'dsr-pstat-value' + (abuse > 0 ? ' dsr-value-red' : '')}
              >
                {fmtInt(abuse)}
              </div>
              <div className="dsr-pstat-sub">
                {abuse === 1 ? 'facility carries one' : 'facilities carry one'}
              </div>
            </div>
            <div className="dsr-pstat">
              <div className="dsr-pstat-label">Avg overall (nearby)</div>
              <div className="dsr-pstat-value">
                {avgOverall !== null ? fmtRating(avgOverall) : '—'}
              </div>
              <div className="dsr-pstat-sub">
                {flaggedSharePhrase(flagged, data.total)}
              </div>
            </div>
          </div>

          {/* Worth a look */}
          <div className="nm-worth">
            <div className="nm-worth-title">Worth a look</div>
            {worthALook.length > 0 ? (
              <>
                <div className="nm-worth-note">
                  Nearest facilities with no red flags and a 4+ star overall rating.
                </div>
                <ul className="nm-worth-list">
                  {worthALook.map((f) => (
                    <li key={f.ccn}>
                      <button
                        className="nm-worth-item"
                        onClick={() => onSelectFacility(f.ccn)}
                      >
                        <span className="nm-worth-name">{titleCase(f.name)}</span>
                        <span className="nm-worth-meta">
                          {f.distance_miles.toFixed(1)} mi · {fmtRating(f.overall_rating)}★ ·{' '}
                          {f.chain_name ? titleCase(f.chain_name) : 'Independent'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="nm-worth-note">
                No unflagged 4+ star facility within 40 miles
                {nearestAny
                  ? ` — nearest is ${titleCase(nearestAny.name)} at ${nearestAny.distance_miles.toFixed(
                      1,
                    )} mi (${fmtRating(nearestAny.overall_rating)}★).`
                  : '.'}
              </div>
            )}
          </div>

          {/* Approach with caution */}
          {nearestAbuse && (
            <div className="nm-caution">
              Approach with caution — nearest abuse-cited facility:{' '}
              <button
                className="nm-caution-link"
                onClick={() => onSelectFacility(nearestAbuse.ccn)}
              >
                {titleCase(nearestAbuse.name)}
              </button>
              , {nearestAbuse.distance_miles.toFixed(1)} mi.
            </div>
          )}

          {/* Map */}
          <div className="nm-map">
            <FacilityMap
              facilities={facilities}
              centroid={{
                lat: data.centroid.lat,
                lng: data.centroid.lng,
                label: `ZIP ${data.zip} (area centroid)`,
              }}
              onSelectFacility={onSelectFacility}
            />
          </div>

          {/* Sort toggle */}
          <div className="nm-sort" role="group" aria-label="Sort order">
            <button
              className={'seg' + (sort === 'nearest' ? ' seg-active' : '')}
              onClick={() => setSort('nearest')}
            >
              Nearest first
            </button>
            <button
              className={'seg' + (sort === 'concerning' ? ' seg-active' : '')}
              onClick={() => setSort('concerning')}
            >
              Most concerning first
            </button>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="num">Miles</th>
                  <th>Facility</th>
                  <th>City</th>
                  <th>State</th>
                  <th>Operator</th>
                  <th className="num">Overall</th>
                  <th className="num">Fines</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((f) => (
                  <tr
                    key={f.ccn}
                    className="row-clickable"
                    onClick={() => onSelectFacility(f.ccn)}
                  >
                    <td className="num strong">{f.distance_miles.toFixed(1)}</td>
                    <td className="chain-name-cell">
                      <span className="chain-name-text">{titleCase(f.name)}</span>
                    </td>
                    <td>{f.city ? titleCase(f.city) : '—'}</td>
                    <td>{f.state ?? '—'}</td>
                    <td>
                      {f.chain_name ? (
                        titleCase(f.chain_name)
                      ) : (
                        <span className="dim">Independent</span>
                      )}
                    </td>
                    <td className="num">
                      <Stars value={f.overall_rating} compact />
                    </td>
                    <td className="num">{fmtMoney(f.fines_dollars)}</td>
                    <td>
                      {f.flags.length === 0 ? (
                        <span className="dim">—</span>
                      ) : (
                        <span className="flag-chips">
                          {f.flags.map((k) => (
                            <span key={k} className="count-pill" title={flagLabel(k)}>
                              {flagLabel(k)}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
