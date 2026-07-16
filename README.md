# Chain Watch

**Rank nursing-home operators — not just homes — by conduct.**

CMS Care Compare rates nursing homes one facility at a time. But 71.4% of
facilities belong to a chain, and the operator behind a home is invisible when
you only look at that home. Chain Watch shifts the unit of analysis from the
facility to the chain. A family vetting the company that runs a home, a
journalist, or a regulator can rank chains by accountability signals: total
fines (CMS reports roughly the trailing three years), abuse-flagged
facilities, Special Focus program counts (SFF and candidates), staff
turnover, and red-flag rates. From a ranking you can open a chain's facility
footprint on a map, then the red flags on any single facility.

<img width="2236" height="1612" alt="image" src="https://github.com/user-attachments/assets/e70a1c5b-4018-4d10-8189-284e46b3cee4" />


## Verification

Every statistic shown is computed from the bundled CMS files at startup, not
hardcoded or estimated. The methodology was checked three ways:
our chain averages reproduce CMS's own published "Chain Average Overall
5-star Rating" within 0.05 stars for 98.1% of all 635 chains; the provider
file's fine totals, the penalties file's independently summed records, and
the UI's timelines agree to the dollar on spot-checked chains; and a
36-point raw-CSV recompute across three chains matched 35 checks exactly;
the single difference traced to an exact .05 floating-point boundary where
two rounding implementations legitimately disagree at display level.
Details in DESIGN_NOTES.md.

## How this was built

Built in a single 90-minute timebox. Claude Code generated most of the code
under my direction: parallel agents built the backend and frontend against an
API contract I fixed up front, and separate adversarial-review agents
recomputed every statistic from the raw CSVs before anything shipped. The
framing, scope, and product decisions are mine. Full methodology in
DESIGN_NOTES.md.

## Why this doesn't already exist

The two serious public tools in this space are facility-level. CMS Care
Compare is a facility finder: search a home, see its stars. ProPublica's
Nursing Home Inspect is an inspection-report search engine: full-text search
across hundreds of thousands of deficiency reports, one facility at a time.
Both answer "how is this home?" Neither answers "how is the company that
runs it?" You can see that a home is owned by a chain, but nowhere can you
rank operators by conduct, normalized for size, across their whole footprint.
That's the gap Chain Watch fills, and the dataset supports it: CMS added chain
columns to the provider file, and 71.4% of facilities belong to one.

## The 90-second tour

1. The app opens on large chains (25+ facilities) with a computed headline —
   for example, a 149-facility operator where every single home carries a
   red flag. Change any filter and the headline recomputes for that slice.
2. Click the top chain. The dossier shows its rank among all 635 chains,
   fines per facility against the national average, a fines-by-year trend,
   and every facility on a severity-coded map.
3. Click a facility. Each red flag states the actual value and the
   percentile threshold that triggered it.
4. Hit "Near me" and enter a ZIP. You get the flagged facilities nearby, the
   nearest abuse-cited home, and the three nearest clean 4+ star options.

## Features

- Chains ranked by accountability signals, normalized two ways (fines per
  facility and per bed), segmented by size band, with search, state,
  ownership, and abuse-citation filters
- A dynamic headline: an insight engine scores several candidate facts
  (worst fines/facility, abuse-citation share, all-flagged operators, worst
  turnover, ownership rating gap) for the active slice and surfaces the most
  extreme one
- Facility search: typing a facility name (not just a chain) surfaces matching
  facilities inline, so independents are reachable too
- "Near me": enter a ZIP for a decision aid — summary stats, a severity map,
  the nearest abuse-cited facility, and a "worth a look" shortlist of clean
  4+ star homes nearby (GeoNames ZIP centroids, resolved locally)
- Chain detail with the full facility footprint plotted on a map
- Per-chain fine timeline: fines-by-year bar chart on chain and facility detail,
  built by joining the second CMS file, `NH_Penalties_Jun2026.csv`, so you can
  see whether an operator is trending better or worse
- Per-facility red flags: abuse citation, special-focus status, stale
  inspection, recent ownership change, high turnover, heavy fines, low staffing
- National context bar (facilities, chains, fines, abuse flags)
- Red-flag thresholds computed from the dataset's own percentiles, not
  hardcoded

## Requirements

- Python 3.12+ managed via [uv](https://docs.astral.sh/uv/) (`brew install uv`)
- Node.js 20+ (`brew install node`)

## Setup

```bash
# Backend
cd backend
uv sync

# Frontend
cd ../frontend
npm install
```

## Run

From the project root:

```bash
./dev.sh
```

Or run the two halves separately:

```bash
# Terminal 1 — API on http://localhost:8000
cd backend && uv run uvicorn app.main:app --reload --port 8000

# Terminal 2 — UI on http://localhost:5173
cd frontend && npm run dev
```

Then open http://localhost:5173.

Coverage is national: all 50 states plus DC and the territories CMS
certifies (53 jurisdictions).

The data is bundled in `data/` — no download needed. It is the CMS Provider
Data Catalog "Provider Information" file (June 2026 refresh),
`NH_ProviderInfo_Jun2026.csv`, plus the CMS Penalties file
(`NH_Penalties_Jun2026.csv`) and the CMS data dictionary PDF. ZIP centroids
for the near-me search come from `us_zip_centroids.csv`, derived from the
GeoNames postal database (CC BY 4.0, geonames.org).

## Project structure

```
backend/    FastAPI app (data loading, analysis endpoints)
frontend/   React + Vite UI
data/       Dataset file(s)
```

## Known limits

No deep links (view state is not in the URL), no uncertainty intervals on
small-chain rates (see DESIGN_NOTES's analyst notes), and fines reflect CMS's
trailing ~3-year reporting window bucketed by inspection date.
