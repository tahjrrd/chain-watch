# Design notes

## What I built

Chain Watch ranks nursing-home chains by accountability signals, then lets you
drill from a chain into its facility footprint on a map and into the red flags
on any single facility. This is the less obvious build. The obvious one on
this dataset is a facility finder: search a home, see its stars. But CMS Care
Compare already does that, and it shows facilities one at a time. 71.4% of
facilities belong to a chain, so the operator patterns — a company whose homes
carry repeated abuse flags or heavy fines — are invisible in the per-facility
view. Chain Watch makes the operator the unit of analysis.

## How chains are defined, and where that breaks

Facilities roll up to operators using CMS's own `Chain ID` — the agency's
published grouping of homes that share an individual or organizational
owner, officer, or entity with operational control. I deliberately did not
do name-based entity resolution on top of it. That choice has known failure
modes, in both directions: false splits, where one real operator hides
behind multiple corporate names and receives multiple Chain IDs (the
per-operator numbers understate); and staleness, where an ownership change
mid-window attributes a prior operator's fines to the current one (the
`Provider Changed Ownership in Last 12 Months` column would flag this, but
it is uniformly "N" in this refresh, so the tool cannot see it). I checked
what could be checked: CMS's declared per-chain facility count equals the
in-file count for all 635 chains this refresh, and independents (28.6% of
facilities) are reachable through facility search rather than silently
dropped. Real entity resolution against the CMS ownership file is the first
thing I would add with more time.

## Why this scope

The core slice is one flow end to end: rank chains, open a chain, open a
facility. Everything else had to earn its way in against that path. Two
things did: the CMS penalties file (it turns a fine total into a trend,
which changes the judgment you can make about an operator) and the near-me
view (it turns the dataset into a decision for a family, not just a ranking
for a journalist). Account systems, saved searches, and export did not. I
would rather ship the drill-down working than three half-built tabs.

The dataset supports the chain framing directly. Abuse-flagged facilities
average 1.64 stars against 3.16 for unflagged. 44.7% of facilities have been
fined, with a median fine total of $33,677 among those fined and a max of
$883,180. There are 86 Special Focus Facilities and 440 SFF candidates.
Deficiency count correlates with rating at r = -0.572. These are facility-level
facts; aggregating them to the chain is what this tool adds.

## Tradeoffs

- **Pandas in memory, not a database.** 14,695 rows and 99 columns fit in
  memory with room to spare. A database would add setup and deployment cost for
  no query I actually run. If the data grew or needed joins across CMS files,
  this would change.
- **Precomputed aggregates at startup.** Chain rankings are computed once when
  the API loads, not per request. The tradeoff is a stale view between monthly
  refreshes, which is acceptable for a monthly dataset.
- **Thresholds from the data's own percentiles.** High turnover is the 75th
  percentile of turnover; heavy fines is the 90th percentile of nonzero facility
  fine totals. These are computed at load and reused in the flag logic, rather
  than hardcoded numbers that drift from the data. Median nursing staff turnover
  is 45.3%, so the threshold sits well above
  the middle of the distribution.
- **Per-facility normalization as the default ranking.** Sorting chains by
  total fines rewards small bad operators with invisibility — the largest
  chains dominate by sheer footprint. Fines per facility is the headline metric,
  with absolute totals still available; the landing view sorts by flagged
  share with facility-count tie-breaks, so the largest fully flagged
  operators lead the first screen. This surfaced operators with over
  $380,000 in fines per facility that a total-fines sort buries under chains
  ten times their size. Fines per facility still favors chains of large homes,
  so a per-bed normalization (total fines divided by summed Number of Certified
  Beds) corrects for facility size and is offered as an additional sort.
- **Size bands instead of one ranking.** A 3-facility operator and a
  200-facility chain are different populations, so chains are segmented into
  small (2–5 facilities), medium (6–24), and large (25+). In this refresh the
  bands hold 143, 399, and 93 chains respectively; CMS assigns a Chain ID only
  at 2+ facilities, so there are no single-facility chains to exclude.
- **Second CMS file for the fine timeline.** The chain and facility detail views
  show a fines-by-year bar chart built by joining `NH_Penalties_Jun2026.csv`
  (dated fine records) to the provider file on CCN; every one of its 13,710 fine
  rows matched a facility in the provider file (100% join rate), so no fine is
  dropped for lack of a match. Payment-denial rows are counted but excluded from
  the dollar timeline.
- **Single-page UI, no router.** State is held in the app, not the URL. Simpler
  to build and reason about. The cost is no deep links, which I note below.
- **Expose data problems, don't patch them.** Five facilities report exactly
  0.000 RN hours and turnover caps at exactly 100% — both left as-is, since
  silently editing source data is worse for an accountability tool than
  showing it. One red flag (ownership change in the last 12 months) can never
  fire on this refresh because the column is uniformly "N"; the logic stays
  for future refreshes where the field is populated.

## Analyst notes

Judged as analysis rather than software, the choices that matter:

- **Rates, not counts, with two denominators.** Issue counts reward small
  operators with invisibility; per-facility and per-bed normalization are
  both available as sorts, because neither denominator is innocent.
  Per-facility overweights chains of large homes, per-bed overweights
  bed-heavy footprints, so the tool shows both.
- **Small denominators are noisy — including the headline.** The default
  headline can name a 7-facility chain: per-facility normalization is the
  point (totals hide small bad operators), but small-N rates carry more
  variance. I considered a minimum-size threshold for the headline and chose
  visible facility counts plus size-band filters instead — suppressing small
  operators from the default view felt like the wrong side of the tradeoff
  for an accountability tool.
- **The ownership gradient replicates the literature.** For-profit facilities
  in this refresh average 2.83 stars vs 3.59 non-profit and 3.30 government,
  with higher turnover and abuse-flag rates — consistent with a large
  peer-reviewed literature on ownership and nursing-home quality. The tool
  makes that gradient a filter rather than a buried crosstab.
- **What a serious analysis would add next:** resident-day denominators (the
  file carries average daily census), case-mix adjustment beyond CMS's own
  staffing adjustment, uncertainty on small-n rates, the payroll-based (PBJ)
  daily staffing files instead of self-reported hours, and panel structure
  across monthly refreshes instead of one snapshot.

## Validation

Three layers of verification, all run against the shipped files:

- **Methodology vs CMS.** The dataset carries CMS's own "Chain Average
  Overall 5-star Rating." Our independently computed chain average matches it
  within 0.05 stars for 98.1% of all 635 chains (max difference 0.05 —
  CMS rounds to one decimal). The chain-average construct is CMS's own,
  reproduced.
- **Cross-file consistency.** For spot-checked chains, the provider file's
  fine total, the penalties file's independently summed fine records, and the
  UI's fines-by-year timeline agree to the dollar (e.g. one 15-facility chain:
  $5,441,883 in all three).
- **Raw-CSV drill-down.** Three chains were recomputed from the raw CSVs
  across twelve metrics each (facilities, rating averages, turnover, fines,
  beds, normalized metrics, abuse and Special Focus counts, penalties) and
  diffed against the live API: 35 of 36 checks matched exactly. The one
  difference was investigated to ground truth: an averaged turnover of
  exactly 37.55 sits on a floating-point .05 boundary that Python's and
  NumPy's rounding render as 37.5 and 37.6 respectively — the underlying
  mean matches exactly; only the display rounding differs.

## What I'd do with more time

- Join the CMS deficiencies detail file to show the specific citations
  behind a fine total, and the ownership file to catch operators spanning
  multiple Chain IDs.
- Chain name normalization and entity resolution. Chain ID groups facilities,
  but operator names are messy; resolving them would catch chains that hide
  behind multiple corporate names.
- Time series across monthly refreshes, to show a chain getting better or worse
  rather than a single snapshot.
- Export and shareable deep links to a specific chain or facility.
- An accessibility pass — keyboard navigation and screen-reader labels on the
  map and tables.

## How I used AI assistance

Claude Code generated most of the code under my direction. The working
method: parallel agents built the backend and frontend against a shared API
contract I fixed up front; separate agents then adversarially reviewed the
result — one recomputed every statistic from the raw CSVs, one audited every
column interpretation against the CMS data dictionary, one critiqued the
product and one the design, and their findings drove the final revisions.
The framing, scope, and product calls are mine. Every dataset statistic in
the UI, the README, and this document was computed from the files in
`data/` during the session, not recalled or estimated.
