# Chain Watch

**Rank nursing-home operators—not just individual homes—by conduct.**

CMS Care Compare evaluates nursing homes one facility at a time. But 71.4% of facilities in the bundled dataset belong to a chain, making operator-level patterns difficult to see when each home is considered in isolation.

Chain Watch changes the unit of analysis from the facility to the operator. A family, journalist, analyst, or regulator can rank chains using accountability signals including fines, abuse citations, Special Focus Facility status, staff turnover, and red-flag rates. From the ranking, users can inspect a chain's complete facility footprint and then drill into the evidence behind an individual facility's flags.

<img width="2236" height="1612" alt="Chain Watch operator ranking dashboard with chain-level accountability metrics" src="https://github.com/user-attachments/assets/e70a1c5b-4018-4d10-8189-284e46b3cee4" />

## Verification

Every statistic shown is computed from the bundled CMS source files at application startup rather than hardcoded or estimated.

The July 2026 snapshot was checked in three ways:

1. **Methodology against CMS:** Independently computed chain-average ratings reproduce CMS's published "Chain Average Overall 5-star Rating" within 0.05 stars for 98.7% of the 634 chains in the snapshot (the remaining differences sit exactly on the 0.05 rounding boundary).

2. **Cross-file reconciliation:** For spot-checked chains, provider-file fine totals, independently summed penalty records, and the user interface's fine timelines agree to the dollar.

3. **Raw-data recomputation:** A separate 36-point recomputation across three chains matched all 36 checks exactly. (The same check on the June snapshot surfaced one display-rounding difference at an exact `.05` floating-point boundary; the underlying value agreed.)

The full methodology, limitations, and analytical tradeoffs are documented in [DESIGN_NOTES.md](DESIGN_NOTES.md).

## How this was built

The initial end-to-end application was built in a 90-minute timebox. The MCP server and monthly data-refresh workflow were added later.

Claude Code generated most of the implementation under my direction. I owned the problem selection, operator-level product framing, scope, API contract, acceptance criteria, adversarial verification requirements, review, and shipping decisions.

The repository includes a local MCP server exposing six bounded, read-only tools through the same backend computation path used by the API. A compatible MCP client can use those tools after cloning and configuring the repository; there is no hosted public MCP endpoint.

See [API_CONTRACT.md](API_CONTRACT.md) for the shared interface and [MCP.md](MCP.md) for the MCP tool surface and local setup.

## Why I built it

The two established public tools I evaluated are primarily facility-level:

- CMS Care Compare helps users find a nursing home and review its ratings.
- ProPublica's Nursing Home Inspect supports inspection-report research and facility-level investigation.

Neither is designed to rank operators across their complete facility footprints using normalized conduct signals. Although the CMS data identifies facilities associated with chains, operator-level patterns remain difficult to evaluate from facility pages alone.

Chain Watch explores that product gap by making the operator the primary unit of analysis while preserving the ability to drill down to the underlying facilities and evidence.

## The 90-second tour

1. The application opens on large chains with 25 or more facilities. A computed headline surfaces an unusual accountability signal for the active filter selection.

2. Select a chain to view its rank, fines per facility, fines per bed, national comparisons, fines by year, and complete facility footprint.

3. Select a facility to inspect each red flag, the underlying value, and the percentile threshold that triggered it.

4. Use **Near me** to find flagged facilities near a ZIP code, identify the nearest abuse-cited facility, and see nearby facilities that meet the tool's clean four-star-or-better criteria.

## Features

- Chain rankings based on accountability signals
- Normalization by facility count and certified bed count
- Size bands separating small, medium, and large operators
- Search, state, ownership, and abuse-citation filters
- Dynamic headlines computed for the active result set
- Facility-name search, including independent facilities
- Chain-level facility maps
- Per-chain and per-facility fine timelines
- Facility-level explanations for every red flag
- ZIP-based nearby-facility analysis
- National context for facilities, chains, fines, and abuse flags
- Thresholds computed from the bundled dataset rather than fixed constants
- Six bounded, read-only MCP tools over the shared backend computation path

## Architecture

```text
CMS provider and penalties CSVs
        |
        v
Pandas startup load and precomputation
        |
        +--> Facility flags and chain aggregates
        |
        +--> FastAPI endpoints --> React/TypeScript interface
        |
        +--> Six FastMCP tools
```

The API and MCP layers reuse the same backend functions rather than maintaining separate analytical implementations.

## Requirements

- Python 3.12+
- [uv](https://docs.astral.sh/uv/)
- Node.js 20+
- npm

## Setup

Clone the repository:

```bash
git clone https://github.com/tahjrrd/chain-watch.git
cd chain-watch
```

Install the backend dependencies:

```bash
cd backend
uv sync --frozen
```

Install the frontend dependencies:

```bash
cd ../frontend
npm ci
```

## Run

From the project root:

```bash
./dev.sh
```

Alternatively, run the backend and frontend separately.

Backend:

```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

## Testing

The repository currently includes 35 backend, API, and MCP tests.

Run the backend suite:

```bash
cd backend
uv sync --frozen
uv run pytest -q
```

Run the frontend checks:

```bash
cd frontend
npm ci
npm run lint
npm run build
```

The backend test suite and frontend production build pass on the current main branch. Behavioral frontend test coverage has not yet been added.

## Data

The current main branch contains the July 2026 CMS snapshot:

- `NH_ProviderInfo_Jul2026.csv`
- `NH_Penalties_Jul2026.csv`
- CMS nursing-home data dictionary
- Locally resolved ZIP centroids derived from the GeoNames postal database

The snapshot contains:

- 14,693 facilities
- 634 chains
- 53 CMS jurisdictions, covering all 50 states, Washington, DC, and the territories represented in the source data

CMS reports fines over an approximately three-year trailing window. Fine timelines are bucketed by inspection date.

ZIP centroids are derived from the GeoNames postal database under CC BY 4.0.

## Automated data refresh

A scheduled GitHub Actions workflow checks for a newer CMS provider and penalties release each month.

When new data is available, the workflow:

1. Downloads and validates the source files.
2. Recomputes the aggregate snapshot through the existing backend pipeline.
3. Runs the backend test suite against the refreshed data.
4. Produces a human-readable summary of the changes.
5. Opens a pull request for review.

The workflow does not merge data automatically. Refreshes remain behind a human review step so that aggregate changes, documentation, and analytical assumptions can be evaluated together.

## Project structure

```text
backend/
  app/main.py          FastAPI application and shared data computations
  app/mcp_server.py    Six read-only MCP tools
  tests/               Backend, API, and MCP tests

frontend/              React and TypeScript user interface
data/                  Bundled CMS source files and computed snapshot
scripts/               Monthly CMS refresh logic
.github/workflows/     Scheduled refresh automation

API_CONTRACT.md        Shared backend/frontend contract
DESIGN_NOTES.md        Product decisions, validation, and analytical limits
MCP.md                 MCP tool definitions and local setup
```

## Scope and known limits

Chain Watch is a portfolio artifact rather than a production service. Its current scope is intentionally constrained:

- Local operation only; there is no hosted deployment
- Read-only API and MCP surfaces
- No production authentication, authorization, or observability
- No frontend behavioral test coverage
- No general pull-request CI
- No deep links because view state is not encoded in the URL
- No uncertainty intervals for small-chain rates
- A single monthly snapshot rather than a historical panel
- Reliance on CMS Chain IDs, which can contain false splits or stale ownership relationships
- Fines reflect CMS's trailing approximately three-year reporting window
- Accessibility work remains before this could become a public production service

See [DESIGN_NOTES.md](DESIGN_NOTES.md) for a more detailed discussion of the analytical limitations and the next improvements I would prioritize.
