# Chain Watch API contract (internal build doc)

All endpoints served by FastAPI on :8000. Frontend calls via /api proxy.
"Chain" = group of facilities sharing `Chain ID`. Facilities with null
Chain ID are independents (excluded from chain rankings, reachable via
facility endpoints).

## GET /api/overview
National context for the header bar.
```json
{
  "facilities": 14000, "chains": 600, "independents": 4000,
  "pct_facilities_in_chains": 71.4, "states": 53,
  "total_fines_dollars": 123456789, "abuse_flag_count": 400,
  "thresholds": {"high_turnover_pct": 59.7, "heavy_fines_dollars": 250000},
  "processing_date": "2026-06-01"
}
```
`thresholds` are computed from the data (75th pct turnover, 90th pct of
nonzero facility fine totals) and reused in flag logic — single source of truth.

## GET /api/chains?q=&state=&min_facilities=&size_band=&ownership=&has_abuse=&sort_by=&descending=
Ranked chain list. `state` filters to chains with ≥1 facility in that state
(aggregates still national — note this in UI). Default sort:
fines_per_facility desc (see Size normalization below).
```json
{"total": 600, "chains": [{
  "chain_id": "...", "chain_name": "...",
  "facilities_in_data": 142, "states": ["OH","PA"],
  "avg_overall_rating": 2.1, "avg_staffing_rating": 1.9,
  "avg_turnover_pct": 55.3,
  "total_fines_dollars": 4200000, "total_penalties": 310,
  "total_certified_beds": 17040, "fines_per_bed": 247,
  "abuse_count": 11, "special_focus_count": 3,
  "flagged_facilities": 88, "flag_rate_pct": 62.0,
  "fines_per_facility": 29577, "abuse_rate_pct": 7.7,
  "penalties_per_facility": 2.2,
  "for_profit_pct": 85.9, "majority_ownership": "for_profit"
}]}
```

### Size normalization (added)
Absolute totals reward small bad chains with invisibility. Per-facility
normalized metrics are first-class: `fines_per_facility` (total fines /
facilities_in_data, int), `abuse_rate_pct` (abuse_count / facilities_in_data),
`penalties_per_facility` (1 decimal). `fines_per_bed` (total fines /
`total_certified_beds`, int, null when the chain's beds total is 0/unknown)
normalizes for facility size, not just facility count. All are valid `sort_by`
values. DEFAULT SORT for /api/chains stays `fines_per_facility` desc.

### Size bands (added)
Small and large operators are different populations — a 2-facility operator
and a 200-facility chain shouldn't share a ranking. Each chain gets a
`size_band` field computed from facilities_in_data: "small" (2–5),
"medium" (6–24), "large" (25+). Chains with exactly 1 facility in data get
"single" (they exist but are de-emphasized). /api/chains accepts
`size_band=small|medium|large|single` as a filter. The UI replaces the
min-facilities dropdown with segmented tabs: All | Small (2–5) |
Medium (6–24) | Large (25+); default tab = All, but rank numbers restart
within whatever filter is active (frontend derives rank from row order).

### Ownership rollup (added)
Each chain rolls up the CMS "Ownership Type" column across its in-data
facilities into two fields (both also on /api/chains/{id}):
- `for_profit_pct`: share of facilities whose Ownership Type starts with
  "For profit" (1 decimal; facilities with missing ownership count in the
  denominator).
- `majority_ownership`: `"for_profit" | "non_profit" | "government" | "mixed"`.
  A category (For profit / Non profit / Government prefix) that holds a strict
  majority (>50%) of the chain's facilities wins; otherwise `"mixed"`.

/api/chains accepts two filters built on these:
- `ownership=for_profit|non_profit|government|mixed` — keep chains whose
  `majority_ownership` equals the value (400 on any other value).
- `has_abuse=true|false` — `true` keeps chains with `abuse_count > 0`, `false`
  keeps chains with `abuse_count == 0`, absent applies no filter.

Both combine with the existing `q`, `state`, `min_facilities`, and
`size_band` filters.

## GET /api/chains/{chain_id}
Chain detail: same aggregate fields plus `facilities` array:
```json
{"...chain aggregates...", "facilities": [{
  "ccn": "365248", "name": "...", "city": "...", "state": "OH",
  "lat": 40.1, "lng": -82.9, "certified_beds": 120,
  "overall_rating": 2, "staffing_rating": 1, "qm_rating": 3,
  "turnover_pct": 71.2, "fines_dollars": 310000, "fines_count": 4,
  "flags": ["abuse", "high_turnover"]
}]}
```

## GET /api/facilities?q=&state=&limit=
Facility name search for the UI search box. Case-insensitive substring on
name; `limit` validated 1–50 (422 outside that range). Returns
`{total, facilities: [{ccn, name, city, state, chain_name, overall_rating,
flags}]}` with flags as string keys.

## GET /api/facilities/{ccn}
Full facility detail: identity, ownership type, chain (id+name if any),
all ratings, staffing hours (reported + adjusted RN/total), turnover,
fines/penalties, inspection recency, and `flags` as objects:
```json
{"flags": [{"key": "abuse", "label": "Abuse citation flag",
  "detail": "CMS abuse icon is set for this facility"}]}
```

## Red-flag definitions (compute at load; verify actual column values first)
- `abuse`: Abuse Icon == Y
- `special_focus`: Special Focus Status non-null (SFF or candidate)
- `stale_inspection`: "Most Recent Health Inspection More Than 2 Years Ago" == Y
- `ownership_change`: "Provider Changed Ownership in Last 12 Months" == Y
- `high_turnover`: Total nursing staff turnover ≥ dataset 75th percentile
- `heavy_fines`: Total Amount of Fines in Dollars ≥ 90th percentile of nonzero
- `low_staffing`: Staffing Rating ≤ 2
