import { useEffect, useState } from 'react'
import type { FacilityDetail as FacilityDetailData, Overview } from '../types'
import { getFacility, getOverview } from '../api'
import { fmtInt, fmtMoney, fmtPct, titleCase } from '../format'
import { Stars } from './Stars'
import { FineTimeline } from './FineTimeline'
import '../detail.css'

// National context is identical across facility views — fetch at most once.
let overviewCache: Overview | null = null
async function loadOverview(signal?: AbortSignal): Promise<Overview> {
  if (overviewCache) return overviewCache
  const o = await getOverview(signal)
  overviewCache = o
  return o
}

type Props = {
  ccn: string
  onBack: () => void
  onSelectChain: (chainId: string) => void
}

export function FacilityDetail({ ccn, onBack, onSelectChain }: Props) {
  const [data, setData] = useState<FacilityDetailData | null>(null)
  const [overview, setOverview] = useState<Overview | null>(overviewCache)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    setData(null)
    loadOverview(ctrl.signal).then(setOverview).catch(() => {})
    getFacility(ccn, ctrl.signal)
      .then(setData)
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Failed to load facility')
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [ccn])

  return (
    <div className="detail-view">
      <button className="back-link" onClick={onBack}>
        ← Back
      </button>

      {loading && <div className="panel state-cell">Loading facility…</div>}
      {!loading && error && (
        <div className="panel state-cell error">{error}</div>
      )}
      {!loading && !error && data && (
        <FacilityBody data={data} overview={overview} onSelectChain={onSelectChain} />
      )}
    </div>
  )
}

function FacilityBody({
  data,
  overview,
  onSelectChain,
}: {
  data: FacilityDetailData
  overview: Overview | null
  onSelectChain: (chainId: string) => void
}) {
  const cityTc = data.city ? titleCase(data.city) : null
  const location = [cityTc, data.state].filter(Boolean).join(', ')
  const mapQuery = [data.address, data.city, data.state].filter(Boolean).join(', ')
  const turnoverThreshold = overview?.thresholds.high_turnover_pct ?? null
  const finesThreshold = overview?.thresholds.heavy_fines_dollars ?? null
  const turnoverBreach =
    turnoverThreshold !== null &&
    data.turnover_pct !== null &&
    data.turnover_pct >= turnoverThreshold
  const finesBreach =
    finesThreshold !== null &&
    data.fines_dollars !== null &&
    data.fines_dollars !== undefined &&
    data.fines_dollars >= finesThreshold
  return (
    <>
      <div className="detail-header">
        <div>
          <h2 className="detail-title">{titleCase(data.name)}</h2>
          <div className="detail-sub dim">CCN {data.ccn}</div>
        </div>
      </div>

      <div className="detail-grid detail-grid-facility">
        <div className="panel">
          <h3 className="panel-title">Identity</h3>
          <dl className="kv">
            <Row label="Address" value={data.address ?? null} />
            <Row label="Location" value={location || null} />
            <Row label="Ownership" value={data.ownership_type ?? null} />
            <Row label="Certified beds" value={fmtIntOrNull(data.certified_beds)} />
            <div className="kv-row">
              <dt>Chain</dt>
              <dd>
                {data.chain_id ? (
                  <button
                    className="inline-link"
                    onClick={() => onSelectChain(data.chain_id!)}
                  >
                    {data.chain_name}
                  </button>
                ) : (
                  <span className="dim">Independent (no chain)</span>
                )}
              </dd>
            </div>
            <div className="kv-row">
              <dt>Links</dt>
              <dd className="fac-links">
                <a
                  className="fac-link"
                  href={`https://www.medicare.gov/care-compare/details/nursing-home/${data.ccn}`}
                  target="_blank"
                  rel="noopener"
                >
                  View on CMS Care Compare
                </a>
                {mapQuery && (
                  <a
                    className="fac-link"
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`}
                    target="_blank"
                    rel="noopener"
                  >
                    Open in Google Maps
                  </a>
                )}
              </dd>
            </div>
          </dl>
        </div>

        <div className="panel">
          <h3 className="panel-title">Ratings</h3>
          <div className="rating-row">
            <RatingCell label="Overall" value={data.overall_rating} />
            <RatingCell label="Staffing" value={data.staffing_rating} />
            <RatingCell label="Quality" value={data.qm_rating ?? null} />
            <RatingCell
              label="Health Insp."
              value={data.health_inspection_rating ?? null}
            />
          </div>

          <h3 className="panel-title mt">Staffing hours (per resident / day)</h3>
          <table className="mini-table">
            <thead>
              <tr>
                <th></th>
                <th className="num">Reported</th>
                <th className="num">Adjusted</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>RN hours</td>
                <td className="num">{fmtHours(data.reported_rn_staffing_hours)}</td>
                <td className="num">{fmtHours(data.adjusted_rn_staffing_hours)}</td>
              </tr>
              <tr>
                <td>Total nurse hours</td>
                <td className="num">{fmtHours(data.reported_total_staffing_hours)}</td>
                <td className="num">{fmtHours(data.adjusted_total_staffing_hours)}</td>
              </tr>
              <tr>
                <td>Total nursing staff turnover (annual)</td>
                <td className="num" colSpan={2}>
                  <span className={turnoverBreach ? 'dsr-cell-breach' : undefined}>
                    {fmtPct(data.turnover_pct)}
                  </span>
                  {turnoverThreshold !== null && (
                    <div className="dsr-bench">
                      national 75th pct: {fmtPct(turnoverThreshold)}
                    </div>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h3 className="panel-title">Fines &amp; penalties</h3>
          <dl className="kv">
            <Row
              label="Fines (last 3 yrs)"
              value={fmtMoney(data.fines_dollars)}
              breach={finesBreach}
              breachNote={
                finesThreshold !== null
                  ? `heavy-fines threshold: ${fmtMoney(finesThreshold)} (90th pct)`
                  : undefined
              }
            />
            <Row label="Fine count" value={fmtIntOrNull(data.fines_count)} />
            <Row
              label="Total penalties"
              value={fmtIntOrNull(data.total_penalties)}
            />
            <Row
              label="Payment denials"
              value={fmtIntOrNull(data.payment_denials)}
            />
            <Row
              label="Last inspection"
              value={data.last_inspection_date ?? null}
            />
          </dl>
          {data.fine_timeline && data.fine_timeline.length > 0 && (
            <div className="panel-chart">
              <FineTimeline data={data.fine_timeline} />
            </div>
          )}
        </div>

        <div className="panel panel-flags">
          <h3 className="panel-title">Red flags</h3>
          {data.flags && data.flags.length > 0 ? (
            <ul className="flag-list">
              {data.flags.map((f) => (
                <li key={f.key} className="flag-item dsr-flag-item">
                  <span className="flag-label">{f.label}</span>
                  <span className="flag-detail dim">{f.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dim">No red flags in our checks.</div>
          )}
        </div>
      </div>
    </>
  )
}

function Row({
  label,
  value,
  breach,
  breachNote,
}: {
  label: string
  value: string | null
  breach?: boolean
  breachNote?: string
}) {
  return (
    <div className="kv-row">
      <dt>{label}</dt>
      <dd>
        {value ? (
          <span className={breach ? 'dsr-cell-breach' : undefined}>{value}</span>
        ) : (
          <span className="dim">—</span>
        )}
        {breach && breachNote && <div className="dsr-bench">{breachNote}</div>}
      </dd>
    </div>
  )
}

function RatingCell({
  label,
  value,
}: {
  label: string
  value: number | null
}) {
  return (
    <div className="rating-cell">
      <div className="stat-label">{label}</div>
      <div className="rating-stars">
        <Stars value={value} />
      </div>
    </div>
  )
}

function fmtIntOrNull(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null
  return fmtInt(n)
}

function fmtHours(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toFixed(2)
}
