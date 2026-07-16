import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChainSummary,
  FacilitySearchItem,
  Overview,
  Ownership,
  SortKey,
} from '../types'
import { getChains, getFacilities, ApiError } from '../api'
import { US_STATES } from '../states'
import { fmtInt, fmtMoney, fmtPct, titleCase } from '../format'
import { Stars } from './Stars'

type SizeBand = 'small' | 'medium' | 'large'

// Lifted filter state (owned by App so returning restores the exact list).
export type ChainFilters = {
  query: string
  state: string
  band: SizeBand | ''
  ownership: Ownership | ''
  hasAbuse: boolean
  sortBy: SortKey
  descending: boolean
}

export const DEFAULT_CHAIN_FILTERS: ChainFilters = {
  query: '',
  state: '',
  // Land on large national operators: recognizable names, and per-facility
  // rates over 25+ facilities are statistically sturdy. One click widens to All.
  band: 'large',
  ownership: '',
  hasAbuse: false,
  // First load: flagged share, ties broken by size — the biggest fully
  // flagged operators lead, matching the computed headline above the table.
  sortBy: 'flag_rate_pct',
  descending: true,
}

type Props = {
  overview: Overview | null
  filters: ChainFilters
  setFilters: React.Dispatch<React.SetStateAction<ChainFilters>>
  onSelectChain: (chainId: string) => void
  onSelectFacility: (ccn: string) => void
  onOpenNearMe: () => void
}

type BandTab = { label: string; value: SizeBand | '' }
const BAND_TABS: BandTab[] = [
  { label: 'All', value: '' },
  { label: 'Small (2–5)', value: 'small' },
  { label: 'Medium (6–24)', value: 'medium' },
  { label: 'Large (25+)', value: 'large' },
]

type OwnOption = { label: string; value: Ownership | '' }
const OWNERSHIP_OPTIONS: OwnOption[] = [
  { label: 'All ownership', value: '' },
  { label: 'For-profit', value: 'for_profit' },
  { label: 'Non-profit', value: 'non_profit' },
  { label: 'Government', value: 'government' },
  { label: 'Mixed', value: 'mixed' },
]

const BAND_WORD: Record<SizeBand, string> = {
  small: 'small',
  medium: 'mid-size',
  large: 'large',
}
const OWN_WORD: Record<Ownership, string> = {
  for_profit: 'for-profit',
  non_profit: 'non-profit',
  government: 'government',
  mixed: 'mixed-ownership',
}
const OWN_SHORT: Record<Ownership, string> = {
  for_profit: 'For-profit',
  non_profit: 'Non-profit',
  government: "Gov't",
  mixed: 'Mixed',
}

// Methodology text, moved off the prime real estate into a tooltip + <details>.
const METHOD_TEXT =
  'Default view: large chains sorted by flagged share (ties broken by ' +
  'facility count). Fines per facility = total fines ÷ facilities in data. ' +
  'Fines per bed normalizes for facility size. Per-facility and per-bed ' +
  'normalization keep large chains from dominating by sheer size. Rank ' +
  'restarts within the active filters. Small operators dominate ' +
  'per-facility rankings; use the size bands to compare like with like.'

type Col = {
  key: SortKey
  label: string
  numeric: boolean
  title?: string
}

const COLUMNS: Col[] = [
  { key: 'chain_name', label: 'Chain', numeric: false },
  {
    key: 'facilities_in_data',
    label: 'Facilities',
    numeric: true,
    title: "Number of the chain's facilities in the current CMS data",
  },
  {
    key: 'majority_ownership',
    label: 'Ownership',
    numeric: false,
    title:
      'Majority ownership across the chain\'s facilities (>50% share; otherwise "Mixed"). Hover a cell for the exact for-profit share.',
  },
  {
    key: 'avg_overall_rating',
    label: 'Avg Overall',
    numeric: true,
    title:
      "Average CMS Overall five-star rating across the chain's facilities (1 = much below average, 5 = much above average). Combines health inspections, staffing, and quality measures.",
  },
  {
    key: 'avg_turnover_pct',
    label: 'Turnover',
    numeric: true,
    title:
      'Average annual nursing staff turnover (RNs, LPNs, and nurse aides) across facilities. National median is about 45%; high turnover is linked to worse care.',
  },
  {
    key: 'fines_per_facility',
    label: 'Fines / facility',
    numeric: true,
    title: METHOD_TEXT,
  },
  {
    key: 'fines_per_bed',
    label: 'Fines / bed',
    numeric: true,
    title:
      'Total federal fines (~ last 3 years) divided by total certified beds — normalizes for facility size, not just count',
  },
  {
    key: 'abuse_count',
    label: 'Abuse',
    numeric: true,
    title:
      'Facilities carrying the CMS abuse icon: cited for abuse or neglect causing harm on the latest inspection cycle, or potential harm on both of the last two cycles. Hover a cell for the chain\'s Special Focus count.',
  },
  {
    key: 'flag_rate_pct',
    label: 'Flagged',
    numeric: true,
    title:
      'Share of facilities with at least one red flag: abuse icon, Special Focus, inspection over 2 years old, turnover above the national 75th percentile, fines above the 90th percentile, or staffing rating of 2 or less',
  },
]

export function ChainTable({
  overview,
  filters,
  setFilters,
  onSelectChain,
  onSelectFacility,
  onOpenNearMe,
}: Props) {
  const { query, state, band, ownership, hasAbuse, sortBy, descending } = filters
  const update = (patch: Partial<ChainFilters>) =>
    setFilters((f) => ({ ...f, ...patch }))

  // Raw (undebounced) search text — local so typing is snappy. Seeded from the
  // lifted filter so returning to the list restores the box contents.
  const [rawQuery, setRawQuery] = useState(query)

  const [chains, setChains] = useState<ChainSummary[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // False once the backend rejects the advanced filters (degrade gracefully).
  const [advancedOk, setAdvancedOk] = useState(true)

  // Unfiltered baseline (all chains) — used by the insight engine for
  // "vs all chains" comparisons. Fetched once.
  const [baseline, setBaseline] = useState<ChainSummary[] | null>(null)

  // Facility search results (only fetched when a query is present).
  const [facilities, setFacilities] = useState<FacilitySearchItem[]>([])
  const [facTotal, setFacTotal] = useState<number | null>(null)
  const [facLoading, setFacLoading] = useState(false)

  // Debounce the search box (300ms) -> commit into the lifted filter.
  const debounceRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(
      () => update({ query: rawQuery.trim() }),
      300,
    )
    return () => window.clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawQuery])

  // One-time baseline load.
  useEffect(() => {
    const ctrl = new AbortController()
    getChains({}, ctrl.signal)
      .then((res) => setBaseline(res.chains))
      .catch(() => {
        /* baseline is best-effort; insights degrade without it */
      })
    return () => ctrl.abort()
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    let cancelled = false
    const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError'

    async function load() {
      setLoading(true)
      setError(null)
      const base = {
        q: query || undefined,
        state: state || undefined,
        size_band: band || undefined,
        sort_by: sortBy,
        descending,
      }
      try {
        const res = await getChains(
          {
            ...base,
            ownership: ownership || undefined,
            has_abuse: hasAbuse || undefined,
          },
          ctrl.signal,
        )
        if (cancelled) return
        setChains(res.chains)
        setTotal(res.total)
        setAdvancedOk(true)
      } catch (err) {
        if (cancelled || isAbort(err)) return
        // Backend rejected the advanced params: retry the base query so the
        // view keeps working, and disable the effect of those controls.
        if (err instanceof ApiError && err.status === 400 && (ownership || hasAbuse)) {
          try {
            const res = await getChains(base, ctrl.signal)
            if (cancelled) return
            setChains(res.chains)
            setTotal(res.total)
            setAdvancedOk(false)
          } catch (e2) {
            if (!cancelled && !isAbort(e2)) {
              setError(e2 instanceof Error ? e2.message : 'Failed to load chains')
            }
          }
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load chains')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [query, state, band, ownership, hasAbuse, sortBy, descending])

  // Facility search — mirrors the chain query so a facility name isn't a
  // dead end. Only runs when the user has typed something.
  useEffect(() => {
    if (!query) {
      setFacilities([])
      setFacTotal(null)
      setFacLoading(false)
      return
    }
    const ctrl = new AbortController()
    let cancelled = false
    setFacLoading(true)
    getFacilities({ q: query, state: state || undefined, limit: 20 }, ctrl.signal)
      .then((res) => {
        if (cancelled) return
        setFacilities(res.facilities)
        setFacTotal(res.total)
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return
        if (!cancelled) {
          setFacilities([])
          setFacTotal(null)
        }
      })
      .finally(() => {
        if (!cancelled) setFacLoading(false)
      })
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [query, state])

  function toggleSort(key: SortKey) {
    if (key === sortBy) {
      update({ descending: !descending })
    } else {
      // Text columns default ascending; numeric metrics default descending.
      update({ sortBy: key, descending: key !== 'chain_name' && key !== 'majority_ownership' })
    }
  }

  const noChains = !loading && !error && chains.length === 0
  const noFacilities = !query || (!facLoading && facilities.length === 0)
  const emptyBoth = noChains && noFacilities

  return (
    <div className="chain-view">
      <div className="controls">
        <input
          className="search"
          type="search"
          placeholder="Search chain or facility name…"
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          aria-label="Search chain or facility name"
        />
        <select
          className="select"
          value={state}
          onChange={(e) => update({ state: e.target.value })}
          aria-label="Filter by state"
        >
          <option value="">All states</option>
          {US_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={ownership}
          onChange={(e) => update({ ownership: e.target.value as Ownership | '' })}
          aria-label="Filter by ownership"
        >
          {OWNERSHIP_OPTIONS.map((o) => (
            <option key={o.value || 'all'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label className="toggle" title="Only chains with at least one abuse citation">
          <input
            type="checkbox"
            checked={hasAbuse}
            onChange={(e) => update({ hasAbuse: e.target.checked })}
          />
          Abuse citations
        </label>
        <div className="segmented" role="tablist" aria-label="Chain size">
          {BAND_TABS.map((t) => (
            <button
              key={t.value || 'all'}
              role="tab"
              aria-selected={band === t.value}
              className={'seg' + (band === t.value ? ' seg-active' : '')}
              onClick={() => update({ band: t.value })}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="seg"
          onClick={onOpenNearMe}
          title="Find problematic nursing homes near a ZIP code"
        >
          Near me
        </button>
        <span className="result-count">
          {total === null ? '' : `${fmtInt(total)} ${total === 1 ? 'chain' : 'chains'}`}
        </span>
      </div>

      {state && (
        <div className="note">
          Filtered to chains operating in {state}. Aggregate metrics remain
          national.
        </div>
      )}

      <InsightBanner
        onSelectChain={onSelectChain}
        chains={chains}
        baseline={baseline}
        overview={overview}
        loading={loading}
        error={error}
        emptyBoth={emptyBoth}
        facMatched={facTotal ?? 0}
        filters={filters}
      />

      {!advancedOk && (
        <div className="note note-warn">
          Ownership / abuse filtering is unavailable right now — showing the
          unfiltered ranking for these controls.
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="col-rank">#</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={
                    (c.numeric ? 'num ' : '') +
                    'sortable' +
                    (sortBy === c.key ? ' active' : '')
                  }
                  onClick={() => toggleSort(c.key)}
                  title={c.title}
                >
                  <span className="th-inner">
                    {c.label}
                    <span className="sort-arrow">
                      {sortBy === c.key ? (descending ? '▼' : '▲') : ''}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="state-cell">
                  Loading chains…
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="state-cell error">
                  {error}
                </td>
              </tr>
            )}
            {noChains && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="state-cell">
                  {emptyBoth
                    ? 'No chains or facilities match these filters.'
                    : query
                      ? `No chains match “${query}”. See matching facilities below.`
                      : 'No chains match these filters.'}
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              chains.map((c, i) => (
                <ChainRow
                  key={c.chain_id}
                  chain={c}
                  rank={i + 1}
                  onClick={() => onSelectChain(c.chain_id)}
                />
              ))}
          </tbody>
        </table>
      </div>

      {query && (
        <FacilityResults
          query={query}
          loading={facLoading}
          facilities={facilities}
          total={facTotal}
          onSelectFacility={onSelectFacility}
        />
      )}

      <details className="method-details">
        <summary>How ranking works</summary>
        <p>{METHOD_TEXT}</p>
      </details>
    </div>
  )
}

// --------------------------------------------------------------------------- //
// Insight engine
// --------------------------------------------------------------------------- //

type Insight = {
  score: number
  lead: React.ReactNode
  support: React.ReactNode
}

const abuseShare = (rows: ChainSummary[]): number =>
  rows.length ? rows.filter((c) => c.abuse_count > 0).length / rows.length : 0

const meanRating = (rows: ChainSummary[]): number => {
  const v = rows
    .map((c) => c.avg_overall_rating)
    .filter((r): r is number => r !== null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
}

const meanFlagRate = (rows: ChainSummary[]): number =>
  rows.length
    ? rows.reduce((a, b) => a + b.flag_rate_pct, 0) / rows.length
    : 0

// Human descriptor for the current slice ("large for-profit chains", etc.).
function sliceSubject(filters: ChainFilters): string {
  const parts = [
    filters.band ? BAND_WORD[filters.band] : '',
    filters.ownership ? OWN_WORD[filters.ownership] : '',
    filters.hasAbuse ? 'abuse-flagged' : '',
  ].filter(Boolean)
  return parts.length ? `${parts.join(' ')} chains` : 'chains'
}

/**
 * Pure insight selector: builds every applicable candidate, scores each by the
 * magnitude of its deviation/extremity (normalized so candidates are
 * comparable), and returns the single highest-scoring one. Deterministic —
 * identical inputs always yield the identical insight. Returns null for an
 * empty slice.
 */
export function buildInsight(
  chains: ChainSummary[],
  baseline: ChainSummary[] | null,
  overview: Overview,
  filters: ChainFilters,
  onSelectChain?: (chainId: string) => void,
): Insight | null {
  const chainLink = (chain: ChainSummary) =>
    onSelectChain ? (
      <button className="ins-name ins-link" onClick={() => onSelectChain(chain.chain_id)}>
        {titleCase(chain.chain_name)}
      </button>
    ) : (
      <span className="ins-name">{titleCase(chain.chain_name)}</span>
    )
  const N = chains.length
  if (N === 0) return null

  const natlAvgFPF =
    overview.facilities > 0
      ? overview.total_fines_dollars / overview.facilities
      : 0
  const p75 = overview.thresholds?.high_turnover_pct ?? 0
  const subject = sliceSubject(filters)
  const stateClause = filters.state ? ` operating in ${filters.state}` : ''
  const cands: Insight[] = []

  // (a) Worst operator by fines per facility, as a multiple of national avg.
  if (natlAvgFPF > 0) {
    const worst = chains.reduce((a, b) =>
      b.fines_per_facility > a.fines_per_facility ? b : a,
    )
    const mult = worst.fines_per_facility / natlAvgFPF
    if (mult > 1) {
      const M = chains.filter((c) => c.abuse_count > 0).length
      const anyFilter =
        !!(filters.band || filters.state || filters.ownership || filters.hasAbuse || filters.query)
      cands.push({
        score: (mult - 1) / 10,
        lead: (
          <>
            {anyFilter ? (
              <>Highest fines per facility among the {fmtInt(N)} {subject}{stateClause}: </>
            ) : (
              <>Highest fines per facility of any U.S. chain: </>
            )}
            {chainLink(worst)} —{' '}
            <span className="ins-red">
              {fmtMoney(worst.fines_per_facility)} per facility
            </span>
            ,{' '}
            <span className="ins-red">{mult.toFixed(1)}× the national average</span>.
          </>
        ),
        support: (
          <>
            {fmtInt(M)} of {fmtInt(N)} {subject} carry an abuse citation. National
            average: {fmtMoney(natlAvgFPF)} in CMS-reported fines per facility,
            trailing ~3-year window.
          </>
        ),
      })
    }
  }

  // (b) Slice's abuse-citation share vs all chains (non-state slices).
  // Skipped under the abuse filter, where the share is tautologically 100%.
  if (baseline && !filters.state && !filters.hasAbuse && N >= 5) {
    const share = abuseShare(chains)
    const base = abuseShare(baseline)
    if (share > base && base > 0) {
      const M = chains.filter((c) => c.abuse_count > 0).length
      cands.push({
        score: ((share - base) / Math.max(base, 0.05)) * 1.6,
        lead: (
          <>
            <span className="ins-red">{fmtPct(share * 100, 0)}</span> of {subject}{' '}
            carry an abuse citation —{' '}
            <span className="ins-red">
              {fmtInt(M)} of {fmtInt(N)}
            </span>
            .
          </>
        ),
        support: (
          <>
            That's well above the{' '}
            <span className="ins-name">{fmtPct(base * 100, 0)}</span> abuse rate
            across all {fmtInt(baseline.length)} chains.
          </>
        ),
      })
    }
  }

  // (c) A chain where every facility carries a red flag (≥10 facilities).
  const allFlagged = chains.filter(
    (c) => c.flag_rate_pct >= 100 && c.facilities_in_data >= 10,
  )
  if (allFlagged.length) {
    const big = allFlagged.reduce((a, b) =>
      b.facilities_in_data > a.facilities_in_data ? b : a,
    )
    const baseFlag = baseline ? meanFlagRate(baseline) : meanFlagRate(chains)
    cands.push({
      score: 0.55 + Math.min(big.facilities_in_data, 60) / 120,
      lead: (
        <>
          Every one of {chainLink(big)}'s{' '}
          <span className="ins-red">
            {fmtInt(big.facilities_in_data)} facilities
          </span>{' '}
          carries at least one red flag.
        </>
      ),
      support: (
        <>
          Abuse, Special Focus, stale inspections, high turnover, heavy fines, or
          low staffing. The average chain flags{' '}
          <span className="ins-name">{fmtPct(baseFlag, 0)}</span> of its facilities.
        </>
      ),
    })
  }

  // (d) Worst average nursing-staff turnover vs the national 75th percentile.
  if (p75 > 0) {
    const withT = chains.filter((c) => c.avg_turnover_pct !== null)
    if (withT.length) {
      const worst = withT.reduce((a, b) =>
        (b.avg_turnover_pct ?? 0) > (a.avg_turnover_pct ?? 0) ? b : a,
      )
      const wt = worst.avg_turnover_pct as number
      if (wt > p75) {
        const K = withT.filter((c) => (c.avg_turnover_pct ?? 0) >= p75).length
        cands.push({
          score: ((wt - p75) / p75) * 1.3,
          lead: (
            <>
              {chainLink(worst)} churns
              through nursing staff fastest{filters.state || filters.ownership || filters.band ? ` among ${subject}${stateClause}` : ''}:{' '}
              <span className="ins-red">
                {fmtPct(wt, 0)} average annual turnover
              </span>
              .
            </>
          ),
          support: (
            <>
              Above the national 75th-percentile threshold of {fmtPct(p75)}.{' '}
              {fmtInt(K)} of {fmtInt(withT.length)} {subject} exceed it.
            </>
          ),
        })
      }
    }
  }

  // (e) State slice: abuse-citation share vs the national chain rate.
  // Skipped under the abuse filter (share is tautologically 100%).
  if (baseline && filters.state && !filters.hasAbuse && N > 0) {
    const share = abuseShare(chains)
    const base = abuseShare(baseline)
    const M = chains.filter((c) => c.abuse_count > 0).length
    const above = share >= base
    cands.push({
      score: (Math.abs(share - base) / Math.max(base, 0.05)) * 1.6,
      lead: (
        <>
          <span className="ins-red">{fmtPct(share * 100, 0)}</span> of the{' '}
          {fmtInt(N)} chains operating in {filters.state} carry an abuse citation
          — {above ? 'above' : 'below'} the{' '}
          <span className="ins-name">{fmtPct(base * 100, 0)}</span> national rate.
        </>
      ),
      support: (
        <>
          {fmtInt(M)} of {fmtInt(N)} chains with a {filters.state} footprint are
          abuse-flagged.
        </>
      ),
    })
  }

  // (f) Slice's average overall rating gap vs all chains.
  if (baseline) {
    const sliceAvg = meanRating(chains)
    const baseAvg = meanRating(baseline)
    const gap = baseAvg - sliceAvg
    if (sliceAvg > 0 && gap > 0) {
      const lead = filters.ownership
        ? `Majority ${OWN_WORD[filters.ownership]} chains in this view`
        : `The ${subject} in this view`
      cands.push({
        score: gap / 0.4,
        lead: (
          <>
            {lead} average{' '}
            <span className="ins-red">{sliceAvg.toFixed(1)} stars</span> —{' '}
            <span className="ins-red">
              {gap.toFixed(1)} below
            </span>{' '}
            the <span className="ins-name">{baseAvg.toFixed(1)}</span> national
            chain average.
          </>
        ),
        support: (
          <>
            The CMS Overall rating combines health inspections, staffing, and
            quality measures.
          </>
        ),
      })
    }
  }

  if (!cands.length) return null
  // Deterministic: highest score wins; stable order breaks ties by build order.
  return cands.reduce((a, b) => (b.score > a.score ? b : a))
}

function InsightBanner({
  chains,
  baseline,
  overview,
  loading,
  error,
  emptyBoth,
  facMatched,
  filters,
  onSelectChain,
}: {
  chains: ChainSummary[]
  baseline: ChainSummary[] | null
  overview: Overview | null
  loading: boolean
  error: string | null
  emptyBoth: boolean
  facMatched: number
  filters: ChainFilters
  onSelectChain: (chainId: string) => void
}) {
  if (error) return null
  if (!overview || (loading && chains.length === 0)) {
    return (
      <div className="insight insight-muted">Computing the headline number…</div>
    )
  }
  if (chains.length === 0) {
    if (emptyBoth) {
      return (
        <div className="insight insight-muted">
          No chains or facilities match these filters.
        </div>
      )
    }
    return (
      <div className="insight insight-muted">
        No chains match — {fmtInt(facMatched)}{' '}
        {facMatched === 1 ? 'facility' : 'facilities'} match “{filters.query}”
        below.
      </div>
    )
  }

  const insight = buildInsight(chains, baseline, overview, filters, onSelectChain)
  if (!insight) {
    return <div className="insight insight-muted">No chains match these filters.</div>
  }

  return (
    <div className="insight">
      <div className="insight-kicker">Headline finding · recomputed for the active filters</div>
      <div className="insight-lead">{insight.lead}</div>
      <div className="insight-support">{insight.support}</div>
    </div>
  )
}

// --------------------------------------------------------------------------- //
// Facility search results (rendered below the chain ranking)
// --------------------------------------------------------------------------- //

function FacilityResults({
  query,
  loading,
  facilities,
  total,
  onSelectFacility,
}: {
  query: string
  loading: boolean
  facilities: FacilitySearchItem[]
  total: number | null
  onSelectFacility: (ccn: string) => void
}) {
  return (
    <section className="facility-results">
      <h2 className="section-heading">
        Facilities matching “{query}”
        {total !== null && (
          <span className="result-count">
            {' '}
            {fmtInt(total)} {total === 1 ? 'match' : 'matches'}
            {total > facilities.length ? ` (showing ${fmtInt(facilities.length)})` : ''}
          </span>
        )}
      </h2>
      {loading && facilities.length === 0 ? (
        <div className="note">Searching facilities…</div>
      ) : facilities.length === 0 ? (
        <div className="note">No facilities match “{query}”.</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Facility</th>
                <th>City</th>
                <th>State</th>
                <th>Operator</th>
                <th className="num">Overall</th>
                <th className="num">Flags</th>
              </tr>
            </thead>
            <tbody>
              {facilities.map((f) => (
                <tr
                  key={f.ccn}
                  className="row-clickable"
                  onClick={() => onSelectFacility(f.ccn)}
                >
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
                  <td className="num">
                    <CountPill n={f.flags.length} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ChainRow({
  chain,
  rank,
  onClick,
}: {
  chain: ChainSummary
  rank: number
  onClick: () => void
}) {
  const statesTitle = chain.states.join(', ')
  const stateCount = chain.states.length
  const flagRate = chain.flag_rate_pct
  const barWidth = useMemo(
    () => `${Math.max(0, Math.min(100, flagRate))}%`,
    [flagRate],
  )
  const flaggedHot = flagRate >= 75

  const own = chain.majority_ownership
  const ownLabel =
    own && own in OWN_SHORT ? OWN_SHORT[own as Ownership] : '—'
  const ownTitle =
    chain.for_profit_pct !== null && chain.for_profit_pct !== undefined
      ? `${fmtPct(chain.for_profit_pct)} of facilities are for-profit`
      : undefined
  const sfTitle = `${fmtInt(chain.special_focus_count)} in CMS Special Focus program`

  return (
    <tr className="row-clickable" onClick={onClick}>
      <td className="col-rank num dim">{rank}</td>
      <td className="chain-name-cell">
        <span className="chain-name-text">{titleCase(chain.chain_name)}</span>
        <span className="chain-name-states" title={statesTitle}>
          {stateCount} {stateCount === 1 ? 'state' : 'states'}
        </span>
      </td>
      <td className="num">{fmtInt(chain.facilities_in_data)}</td>
      <td title={ownTitle}>{ownLabel}</td>
      <td className="num">
        <Stars value={chain.avg_overall_rating} />
      </td>
      <td className="num">{fmtPct(chain.avg_turnover_pct)}</td>
      <td className="num strong">{fmtMoney(chain.fines_per_facility)}</td>
      <td className="num">{fmtMoney(chain.fines_per_bed)}</td>
      <td className="num" title={sfTitle}>
        <CountPill n={chain.abuse_count} />
      </td>
      <td className="flagged-cell">
        <div className="flagged-inner">
          <span className="flagged-num">
            {fmtInt(chain.flagged_facilities)}
            <span className="dim"> ({fmtPct(flagRate, 0)})</span>
          </span>
          <span className="minibar" aria-hidden="true">
            <span
              className={'minibar-fill' + (flaggedHot ? ' minibar-hot' : '')}
              style={{ width: barWidth }}
            />
          </span>
        </div>
      </td>
    </tr>
  )
}

// A count rendered as a red-tinted pill when > 0, dim "0" otherwise.
function CountPill({ n }: { n: number }) {
  if (!n || n <= 0) return <span className="dim">0</span>
  return <span className="count-pill">{fmtInt(n)}</span>
}
