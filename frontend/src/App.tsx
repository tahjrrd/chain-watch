import { useEffect, useState } from 'react'
import type { Overview } from './types'
import { getOverview } from './api'
import { fmtInt, fmtMoney, fmtPct } from './format'
import { ChainTable } from './components/ChainTable'
import type { ChainFilters } from './components/ChainTable'
import { DEFAULT_CHAIN_FILTERS } from './components/ChainTable'
import { NearMe } from './components/NearMe'
import { ChainDetail } from './components/ChainDetail'
import { FacilityDetail } from './components/FacilityDetail'
import './App.css'

type View =
  | { kind: 'list' }
  | { kind: 'near' }
  | { kind: 'chain'; chainId: string }
  | { kind: 'facility'; ccn: string; fromChainId?: string }

function App() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [ovError, setOvError] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'list' })
  // Lifted so returning from a chain/facility restores the exact list.
  const [filters, setFilters] = useState<ChainFilters>(DEFAULT_CHAIN_FILTERS)

  useEffect(() => {
    const ctrl = new AbortController()
    getOverview(ctrl.signal)
      .then(setOverview)
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return
        setOvError(err instanceof Error ? err.message : 'Failed to load overview')
      })
    return () => ctrl.abort()
  }, [])

  const processingDate = overview?.processing_date

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand-row">
          <div className="brand">
            <span className="brand-mark">Chain Watch</span>
            <span className="brand-sub">
              Operator-level accountability for U.S. nursing homes — CMS Care
              Compare data
              {processingDate ? `, processed ${processingDate}` : ''}
            </span>
          </div>
        </div>
        <NationalStrip overview={overview} error={ovError} />
      </header>

      <main className="app-main">
        {view.kind === 'list' && (
          <ChainTable
            overview={overview}
            filters={filters}
            setFilters={setFilters}
            onSelectChain={(chainId) => setView({ kind: 'chain', chainId })}
            onSelectFacility={(ccn) => setView({ kind: 'facility', ccn })}
            onOpenNearMe={() => setView({ kind: 'near' })}
          />
        )}
        {view.kind === 'near' && (
          <NearMe
            overview={overview}
            onBack={() => setView({ kind: 'list' })}
            onSelectFacility={(ccn) => setView({ kind: 'facility', ccn })}
          />
        )}
        {view.kind === 'chain' && (
          <ChainDetail
            chainId={view.chainId}
            onBack={() => setView({ kind: 'list' })}
            onSelectFacility={(ccn) =>
              setView({ kind: 'facility', ccn, fromChainId: view.chainId })
            }
          />
        )}
        {view.kind === 'facility' && (
          <FacilityDetail
            ccn={view.ccn}
            onBack={() =>
              setView(
                view.fromChainId
                  ? { kind: 'chain', chainId: view.fromChainId }
                  : { kind: 'list' },
              )
            }
            onSelectChain={(chainId) => setView({ kind: 'chain', chainId })}
          />
        )}
      </main>
    </div>
  )
}

function NationalStrip({
  overview,
  error,
}: {
  overview: Overview | null
  error: string | null
}) {
  if (error) {
    return <div className="natl-strip natl-error">Overview unavailable: {error}</div>
  }
  if (!overview) {
    return <div className="natl-strip natl-loading">Loading national context…</div>
  }
  return (
    <div className="natl-strip">
      <NatlStat label="Facilities" value={fmtInt(overview.facilities)} />
      <NatlStat label="Chains" value={fmtInt(overview.chains)} />
      <NatlStat
        label="In chains"
        value={fmtPct(overview.pct_facilities_in_chains)}
      />
      <NatlStat
        label="Total fines"
        value={fmtMoney(overview.total_fines_dollars)}
      />
      <NatlStat
        label="Abuse flags"
        value={fmtInt(overview.abuse_flag_count)}
        danger={overview.abuse_flag_count > 0}
      />
    </div>
  )
}

function NatlStat({
  label,
  value,
  danger,
}: {
  label: string
  value: string
  danger?: boolean
}) {
  return (
    <div className="natl-stat">
      <span className="natl-value tnum">{value}</span>
      <span className={'natl-label' + (danger ? ' danger' : '')}>{label}</span>
    </div>
  )
}

export default App
