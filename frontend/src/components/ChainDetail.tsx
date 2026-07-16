import { useEffect, useMemo, useState } from 'react'
import type { ChainDetail as ChainDetailData, Overview } from '../types'
import { getChain, getOverview, getChains } from '../api'
import { fmtInt, fmtMoney, fmtPct, fmtRating, flagLabel, flagDetail, titleCase } from '../format'
import { FineTimeline } from './FineTimeline'
import { FacilityMap } from './FacilityMap'
import '../detail.css'

type Props = {
  chainId: string
  onBack: () => void
  onSelectFacility: (ccn: string) => void
}

// Module-scope caches: national context + the fines/facility ranking are the
// same across every chain view in a session, so fetch each at most once.
let overviewCache: Overview | null = null
let rankCache: { order: string[]; total: number } | null = null

async function loadOverview(signal?: AbortSignal): Promise<Overview> {
  if (overviewCache) return overviewCache
  const o = await getOverview(signal)
  overviewCache = o
  return o
}

async function loadRank(
  signal?: AbortSignal,
): Promise<{ order: string[]; total: number }> {
  if (rankCache) return rankCache
  // Default sort is fines_per_facility desc — row order == ranking.
  const res = await getChains(
    { sort_by: 'fines_per_facility', descending: true },
    signal,
  )
  rankCache = { order: res.chains.map((c) => c.chain_id), total: res.total }
  return rankCache
}

export function ChainDetail({ chainId, onBack, onSelectFacility }: Props) {
  const [data, setData] = useState<ChainDetailData | null>(null)
  const [overview, setOverview] = useState<Overview | null>(overviewCache)
  const [rank, setRank] = useState<{ order: string[]; total: number } | null>(
    rankCache,
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    setData(null)
    getChain(chainId, ctrl.signal)
      .then(setData)
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Failed to load chain')
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    // Context fetches are best-effort — never block or error the detail view.
    loadOverview(ctrl.signal).then(setOverview).catch(() => {})
    loadRank(ctrl.signal).then(setRank).catch(() => {})
    return () => ctrl.abort()
  }, [chainId])

  return (
    <div className="detail-view">
      <button className="back-link" onClick={onBack}>
        ← All chains
      </button>

      {loading && <div className="panel state-cell">Loading chain…</div>}
      {!loading && error && (
        <div className="panel state-cell error">{error}</div>
      )}
      {!loading && !error && data && (
        <ChainDetailBody
          data={data}
          overview={overview}
          rank={rank}
          onSelectFacility={onSelectFacility}
        />
      )}
    </div>
  )
}

function ChainDetailBody({
  data,
  overview,
  rank,
  onSelectFacility,
}: {
  data: ChainDetailData
  overview: Overview | null
  rank: { order: string[]; total: number } | null
  onSelectFacility: (ccn: string) => void
}) {
  const mapped = useMemo(
    () =>
      data.facilities.filter(
        (f) => f.lat !== null && f.lng !== null && !Number.isNaN(f.lat) && !Number.isNaN(f.lng),
      ),
    [data.facilities],
  )

  // National average fines per facility, for the benchmark multiple.
  const natlAvgFinesPerFac =
    overview && overview.facilities > 0
      ? overview.total_fines_dollars / overview.facilities
      : null
  const finesMultiple =
    natlAvgFinesPerFac && natlAvgFinesPerFac > 0
      ? data.fines_per_facility / natlAvgFinesPerFac
      : null

  const allFlagged =
    data.facilities_in_data > 0 &&
    data.flagged_facilities >= data.facilities_in_data
  const turnoverThreshold = overview?.thresholds.high_turnover_pct ?? null

  // Rank by fines/facility among all chains.
  const rankPos =
    rank && rank.order.includes(data.chain_id)
      ? rank.order.indexOf(data.chain_id) + 1
      : null

  return (
    <>
      <div className="detail-header">
        <div>
          <h2 className="detail-title">{titleCase(data.chain_name)}</h2>
          <p className="dsr-summary">
            {summarySentence(data, finesMultiple)}
          </p>
          {rankPos !== null && rank !== null && (
            <div className="dsr-rank">
              <span className="dsr-rank-num">#{fmtInt(rankPos)}</span> of{' '}
              {fmtInt(rank.total)} chains by fines per facility
            </div>
          )}
        </div>
      </div>

      {/* Primary stats — large */}
      <div className="dsr-primary">
        <PrimaryStat
          label="Fines / facility"
          value={fmtMoney(data.fines_per_facility)}
          sub={
            finesMultiple !== null
              ? `${finesMultiple.toFixed(1)}× national avg`
              : undefined
          }
          valueRed={finesMultiple !== null && finesMultiple >= 2}
          subRed={finesMultiple !== null && finesMultiple >= 2}
        />
        <PrimaryStat
          label="Fines / bed"
          value={fmtMoney(data.fines_per_bed)}
          sub={
            data.total_certified_beds > 0
              ? `${fmtInt(data.total_certified_beds)} certified beds`
              : undefined
          }
        />
        <div className="dsr-pstat">
          <div className="dsr-pstat-label">Flagged</div>
          <div
            className={
              'dsr-pstat-value dsr-value-phrase' +
              (allFlagged ? ' dsr-value-red' : '')
            }
          >
            {allFlagged
              ? `All ${fmtInt(data.facilities_in_data)} flagged`
              : `${fmtInt(data.flagged_facilities)} of ${fmtInt(
                  data.facilities_in_data,
                )} flagged`}
          </div>
          <div className="dsr-pstat-sub">
            {fmtPct(data.flag_rate_pct, 0)} of facilities
          </div>
        </div>
        <div className="dsr-pstat">
          <div className="dsr-pstat-label">Abuse citations</div>
          {data.abuse_count > 0 ? (
            <span className="dsr-abuse-pill">{fmtInt(data.abuse_count)}</span>
          ) : (
            <div className="dsr-pstat-value">0</div>
          )}
          <div className="dsr-pstat-sub">
            {fmtPct(data.abuse_rate_pct, 1)} of facilities
          </div>
        </div>
      </div>

      {/* Secondary stats — small */}
      <div className="dsr-secondary">
        <SecondaryStat label="Facilities" value={fmtInt(data.facilities_in_data)} />
        <SecondaryStat
          label="States"
          value={fmtInt(data.states.length)}
          title={data.states.join(', ')}
        />
        <SecondaryStat label="Beds" value={fmtInt(data.total_certified_beds)} />
        <SecondaryStat label="Avg overall" value={fmtRating(data.avg_overall_rating)} />
        <SecondaryStat label="Avg staffing" value={fmtRating(data.avg_staffing_rating)} />
        <SecondaryStat
          label="Avg health insp."
          value={fmtRating(data.avg_health_inspection_rating ?? null)}
          title="Average CMS Health Inspection rating — the most objective of the four ratings; driven by state survey findings"
        />
        <SecondaryStat
          label="Avg quality"
          value={fmtRating(data.avg_qm_rating ?? null)}
          title="Average CMS Quality Measures rating, from clinical quality data"
        />
        <SecondaryStat
          label="Avg turnover"
          value={fmtPct(data.avg_turnover_pct)}
          title={
            turnoverThreshold !== null
              ? `National 75th pct: ${fmtPct(turnoverThreshold)}`
              : undefined
          }
          red={
            turnoverThreshold !== null &&
            data.avg_turnover_pct !== null &&
            data.avg_turnover_pct >= turnoverThreshold
          }
        />
        <SecondaryStat label="Penalties" value={fmtInt(data.total_penalties)} />
        <SecondaryStat
          label="Special focus"
          value={fmtInt(data.special_focus_count)}
          red={data.special_focus_count > 0}
        />
      </div>

      {data.fine_timeline.length > 0 && (
        <div className="panel chart-panel">
          <FineTimeline data={data.fine_timeline} />
        </div>
      )}

      <div className="detail-grid dsr-chain-grid">
        <div className="panel map-panel">
          {mapped.length > 0 ? (
            <FacilityMap facilities={mapped} onSelectFacility={onSelectFacility} />
          ) : (
            <div className="state-cell">No mappable facility coordinates.</div>
          )}
        </div>

        <div className="panel table-panel">
          <div className="table-wrap">
            <table className="dsr-fac-table">
              <thead>
                <tr>
                  <th>Facility</th>
                  <th>City</th>
                  <th className="col-st">St</th>
                  <th className="dsr-num">Overall</th>
                  <th className="dsr-num">Turnover</th>
                  <th className="dsr-num">Fines</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {data.facilities.map((f) => (
                  <tr
                    key={f.ccn}
                    className="row-clickable"
                    onClick={() => onSelectFacility(f.ccn)}
                  >
                    <td className="dsr-fac-name" title={titleCase(f.name)}>
                      {titleCase(f.name)}
                    </td>
                    <td className="dsr-fac-city">{f.city ? titleCase(f.city) : '—'}</td>
                    <td className="col-st">{f.state ?? '—'}</td>
                    <td className="dsr-num">
                      <RatingNum value={f.overall_rating} />
                    </td>
                    <td className="dsr-num">{fmtPct(f.turnover_pct)}</td>
                    <td className="dsr-num">{fmtMoney(f.fines_dollars)}</td>
                    <td>
                      <FlagChips flags={f.flags} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}

// Build the one-sentence dossier summary entirely from served numbers.
function summarySentence(
  data: ChainDetailData,
  finesMultiple: number | null,
): React.ReactNode {
  const statesLabel = data.states.join(', ') || 'multiple states'
  const allFlagged =
    data.facilities_in_data > 0 &&
    data.flagged_facilities >= data.facilities_in_data

  const parts: React.ReactNode[] = []
  parts.push(
    allFlagged ? (
      <span className="dsr-red" key="fl">
        all {fmtInt(data.facilities_in_data)} flagged
      </span>
    ) : (
      <span key="fl">
        {fmtInt(data.flagged_facilities)} of {fmtInt(data.facilities_in_data)}{' '}
        flagged
      </span>
    ),
  )
  if (data.abuse_count > 0) {
    parts.push(
      <span className="dsr-red" key="ab">
        abuse citations at {fmtInt(data.abuse_count)}
      </span>,
    )
  }

  const fineTail =
    finesMultiple !== null
      ? `${fmtMoney(data.fines_per_facility)} per facility, ${finesMultiple.toFixed(
          1,
        )}× the national average`
      : `${fmtMoney(data.fines_per_facility)} per facility`

  return (
    <>
      {fmtInt(data.facilities_in_data)} facilities in {statesLabel} —{' '}
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && ', '}
          {p}
        </span>
      ))}
      ,{' '}
      <span className="dsr-strong">{fmtMoney(data.total_fines_dollars)}</span> in
      federal fines (
      <span className={finesMultiple !== null && finesMultiple >= 2 ? 'dsr-red' : undefined}>
        {fineTail}
      </span>
      ).
    </>
  )
}

function PrimaryStat({
  label,
  value,
  sub,
  valueRed,
  subRed,
}: {
  label: string
  value: string
  sub?: string
  valueRed?: boolean
  subRed?: boolean
}) {
  return (
    <div className="dsr-pstat">
      <div className="dsr-pstat-label">{label}</div>
      <div className={'dsr-pstat-value' + (valueRed ? ' dsr-value-red' : '')}>
        {value}
      </div>
      {sub && (
        <div className={'dsr-pstat-sub' + (subRed ? ' dsr-sub-red' : '')}>
          {sub}
        </div>
      )}
    </div>
  )
}

function SecondaryStat({
  label,
  value,
  title,
  red,
}: {
  label: string
  value: string
  title?: string
  red?: boolean
}) {
  return (
    <div className="dsr-sstat" title={title}>
      <div className="dsr-sstat-label">{label}</div>
      <div className={'dsr-sstat-value' + (red ? ' dsr-value-red' : '')}>
        {value}
      </div>
    </div>
  )
}

// Rating as a numeral; red at 2 or below (an accountability signal, not a glyph).
function RatingNum({ value }: { value: number | null }) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className="dim">—</span>
  }
  const low = value <= 2
  return (
    <span
      className={'dsr-rating-num' + (low ? ' dsr-rating-low' : '')}
      title={`${fmtRating(value)} of 5`}
    >
      {fmtRating(value)}
    </span>
  )
}

function FlagChips({ flags }: { flags: string[] }) {
  if (!flags || flags.length === 0) return <span className="dim">—</span>
  return (
    <span className="dsr-flags">
      {flags.map((k) => (
        <span
          key={k}
          className="dsr-flag-chip"
          title={flagDetail(k) || flagLabel(k)}
        >
          {flagLabel(k)}
        </span>
      ))}
    </span>
  )
}
