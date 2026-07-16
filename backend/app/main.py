"""Chain Watch API.

Ranks nursing-home chains (operators) by accountability signals built on the
CMS Provider Information CSV. The dataset is loaded once at startup, per-facility
flags and per-chain aggregates are precomputed, and every endpoint serves from
these in-memory structures (only filtering/sorting happens per request).
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
CSV_PATH = DATA_DIR / "NH_ProviderInfo_Jun2026.csv"
PENALTIES_CSV_PATH = DATA_DIR / "NH_Penalties_Jun2026.csv"

app = FastAPI(title="Chain Watch API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------------------------------- #
# Column name constants (verified against the CSV header)
# --------------------------------------------------------------------------- #
CCN = "CMS Certification Number (CCN)"
NAME = "Provider Name"
CHAIN_ID = "Chain ID"
CHAIN_NAME = "Chain Name"
OWNERSHIP = "Ownership Type"
BEDS = "Number of Certified Beds"
CITY = "City/Town"
STATE = "State"
LAT = "Latitude"
LNG = "Longitude"
OVERALL = "Overall Rating"
HEALTH = "Health Inspection Rating"
STAFFING = "Staffing Rating"
QM = "QM Rating"
REP_RN = "Reported RN Staffing Hours per Resident per Day"
REP_TOTAL = "Reported Total Nurse Staffing Hours per Resident per Day"
ADJ_RN = "Adjusted RN Staffing Hours per Resident per Day"
ADJ_TOTAL = "Adjusted Total Nurse Staffing Hours per Resident per Day"
TURNOVER = "Total nursing staff turnover"
FINES_COUNT = "Number of Fines"
FINES_DOLLARS = "Total Amount of Fines in Dollars"
PENALTIES = "Total Number of Penalties"
DENIALS = "Number of Payment Denials"
ABUSE = "Abuse Icon"
SFF = "Special Focus Status"
STALE = "Most Recent Health Inspection More Than 2 Years Ago"
OWNERSHIP_CHANGE = "Provider Changed Ownership in Last 12 Months"
PROC_DATE = "Processing Date"

FLAG_KEYS = [
    "abuse",
    "special_focus",
    "stale_inspection",
    "ownership_change",
    "high_turnover",
    "heavy_fines",
    "low_staffing",
]

FLAG_LABELS = {
    "abuse": "Abuse citation flag",
    "special_focus": "Special Focus program (SFF or candidate)",
    "stale_inspection": "Inspection more than 2 years old",
    "ownership_change": "Ownership change in last 12 months",
    "high_turnover": "High nursing staff turnover",
    "heavy_fines": "Heavy fines",
    "low_staffing": "Low staffing rating",
}

# --------------------------------------------------------------------------- #
# In-memory stores populated at load
# --------------------------------------------------------------------------- #
FACILITIES: dict[str, dict[str, Any]] = {}          # ccn -> full detail record
FACILITY_SEARCH: list[dict[str, Any]] = []          # light records for search
CHAINS: dict[str, dict[str, Any]] = {}              # chain_id -> aggregate dict
CHAIN_FACILITIES: dict[str, list[dict]] = {}        # chain_id -> facility summaries
OVERVIEW: dict[str, Any] = {}
THRESHOLDS: dict[str, float] = {}
FACILITY_TIMELINE: dict[str, list[dict]] = {}       # ccn -> yearly fine aggregates
CHAIN_TIMELINE: dict[str, list[dict]] = {}          # chain_id -> yearly fine aggregates
FACILITY_GEO: list[dict[str, Any]] = []             # facilities with valid lat/lng
ZIP_CENTROIDS: dict[str, tuple[float, float]] = {}  # 5-digit ZIP -> (lat, lng)
PREFIX_CENTROIDS: dict[str, tuple[float, float]] = {}  # 3-digit prefix -> (lat, lng)


def _clean(v: Any) -> Any:
    """Convert pandas NaN/NaT to None so the JSON is always valid."""
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


def _int_or_none(v: Any) -> int | None:
    v = _clean(v)
    return None if v is None else int(v)


def _float_or_none(v: Any, ndigits: int | None = None) -> float | None:
    v = _clean(v)
    if v is None:
        return None
    return round(float(v), ndigits) if ndigits is not None else float(v)


def _flag_detail(key: str, row: dict[str, Any]) -> str:
    if key == "abuse":
        return "CMS abuse icon is set for this facility"
    if key == "special_focus":
        return f"Special Focus Status: {row['_sff_value']}"
    if key == "stale_inspection":
        return "Most recent health inspection was more than 2 years ago"
    if key == "ownership_change":
        return "Provider changed ownership in the last 12 months"
    if key == "high_turnover":
        t = row["turnover_pct"]
        return (
            f"Nursing staff turnover {t}% ≥ 75th percentile "
            f"({THRESHOLDS['high_turnover_pct']}%)"
        )
    if key == "heavy_fines":
        f = row["fines_dollars"]
        thr = THRESHOLDS["heavy_fines_dollars"]
        return (
            f"Total fines ${f:,} ≥ 90th percentile of nonzero "
            f"(${thr:,})"
        )
    if key == "low_staffing":
        return f"Staffing rating {row['staffing_rating']} ≤ 2"
    return ""


def load_penalties(provider_ccns: set[str]) -> None:
    """Read the penalties CSV and precompute per-facility/per-chain yearly
    fine timelines (fines only; payment denials counted separately)."""
    pen = pd.read_csv(PENALTIES_CSV_PATH, dtype=str)

    total_rows = len(pen)
    matched = pen[CCN].isin(provider_ccns)
    join_rate = round(100.0 * matched.mean(), 2) if total_rows else 0.0

    fines = pen[pen["Penalty Type"] == "Fine"].copy()
    denials_count = int((pen["Penalty Type"] == "Payment Denial").sum())
    fines["_year"] = pd.to_datetime(fines["Penalty Date"], errors="coerce").dt.year
    fines["_amt"] = pd.to_numeric(fines["Fine Amount"], errors="coerce").fillna(0)

    # Only fine rows that map to a known facility and have a valid year.
    valid = fines[fines[CCN].isin(provider_ccns) & fines["_year"].notna()].copy()
    valid["_year"] = valid["_year"].astype(int)

    # Per-facility yearly aggregates.
    grp = valid.groupby([CCN, "_year"], sort=True)
    agg = grp.agg(fine_count=("_amt", "size"), fine_dollars=("_amt", "sum"))
    for (ccn, year), row in agg.iterrows():
        FACILITY_TIMELINE.setdefault(ccn, []).append(
            {
                "year": int(year),
                "fine_count": int(row["fine_count"]),
                "fine_dollars": int(row["fine_dollars"]),
            }
        )

    # Per-chain yearly aggregates (roll up facilities to their chain).
    ccn_to_chain = {c: rec["chain_id"] for c, rec in FACILITIES.items()}
    valid = valid.assign(_chain=valid[CCN].map(ccn_to_chain))
    chain_rows = valid[valid["_chain"].notna()]
    cgrp = chain_rows.groupby(["_chain", "_year"], sort=True)
    cagg = cgrp.agg(fine_count=("_amt", "size"), fine_dollars=("_amt", "sum"))
    for (chain_id, year), row in cagg.iterrows():
        CHAIN_TIMELINE.setdefault(chain_id, []).append(
            {
                "year": int(year),
                "fine_count": int(row["fine_count"]),
                "fine_dollars": int(row["fine_dollars"]),
            }
        )

    OVERVIEW["penalties_join_rate_pct"] = join_rate
    OVERVIEW["penalties_payment_denial_count"] = denials_count


def load_data() -> None:
    """Read the CSV once and precompute all served structures."""
    df = pd.read_csv(CSV_PATH, dtype=str)

    # Numeric coercions (kept as float Series; NaN preserved).
    num = {
        "beds": pd.to_numeric(df[BEDS], errors="coerce"),
        "lat": pd.to_numeric(df[LAT], errors="coerce"),
        "lng": pd.to_numeric(df[LNG], errors="coerce"),
        "overall": pd.to_numeric(df[OVERALL], errors="coerce"),
        "health": pd.to_numeric(df[HEALTH], errors="coerce"),
        "staffing": pd.to_numeric(df[STAFFING], errors="coerce"),
        "qm": pd.to_numeric(df[QM], errors="coerce"),
        "rep_rn": pd.to_numeric(df[REP_RN], errors="coerce"),
        "rep_total": pd.to_numeric(df[REP_TOTAL], errors="coerce"),
        "adj_rn": pd.to_numeric(df[ADJ_RN], errors="coerce"),
        "adj_total": pd.to_numeric(df[ADJ_TOTAL], errors="coerce"),
        "turnover": pd.to_numeric(df[TURNOVER], errors="coerce"),
        "fines_count": pd.to_numeric(df[FINES_COUNT], errors="coerce"),
        "fines_dollars": pd.to_numeric(df[FINES_DOLLARS], errors="coerce"),
        "penalties": pd.to_numeric(df[PENALTIES], errors="coerce"),
        "denials": pd.to_numeric(df[DENIALS], errors="coerce"),
    }

    # Thresholds (single source of truth, reused in flag logic + overview).
    turnover_p75 = float(num["turnover"].quantile(0.75))
    nonzero_fines = num["fines_dollars"][num["fines_dollars"] > 0]
    fines_p90 = float(nonzero_fines.quantile(0.90))
    THRESHOLDS["high_turnover_pct"] = round(turnover_p75, 1)
    THRESHOLDS["heavy_fines_dollars"] = int(round(fines_p90))

    # Flag boolean Series.
    is_abuse = df[ABUSE].eq("Y")
    is_sff = df[SFF].notna()
    is_stale = df[STALE].eq("Y")
    is_own_change = df[OWNERSHIP_CHANGE].eq("Y")
    is_high_turnover = num["turnover"] >= turnover_p75
    is_heavy_fines = num["fines_dollars"] >= fines_p90
    is_low_staffing = num["staffing"] <= 2

    # Ownership category per facility (For profit / Non profit / Government).
    def _own_cat(o: Any) -> str | None:
        if not isinstance(o, str):
            return None
        if o.startswith("For profit"):
            return "for_profit"
        if o.startswith("Non profit"):
            return "non_profit"
        if o.startswith("Government"):
            return "government"
        return None

    own_cat = df[OWNERSHIP].map(_own_cat)

    flag_map = {
        "abuse": is_abuse,
        "special_focus": is_sff,
        "stale_inspection": is_stale,
        "ownership_change": is_own_change,
        "high_turnover": is_high_turnover,
        "heavy_fines": is_heavy_fines,
        "low_staffing": is_low_staffing,
    }

    for i in range(len(df)):
        ccn = df[CCN].iat[i]
        chain_id = _clean(df[CHAIN_ID].iat[i])
        chain_name = _clean(df[CHAIN_NAME].iat[i])
        keys = [k for k in FLAG_KEYS if bool(flag_map[k].iat[i])]

        rec: dict[str, Any] = {
            "ccn": ccn,
            "name": _clean(df[NAME].iat[i]),
            "address": _clean(df["Provider Address"].iat[i]),
            "zip": _clean(df["ZIP Code"].iat[i]),
            "last_inspection_date": _clean(
                df["Rating Cycle 1 Standard Survey Health Date"].iat[i]
            ),
            "ownership_type": _clean(df[OWNERSHIP].iat[i]),
            "certified_beds": _int_or_none(num["beds"].iat[i]),
            "city": _clean(df[CITY].iat[i]),
            "state": _clean(df[STATE].iat[i]),
            "lat": _float_or_none(num["lat"].iat[i]),
            "lng": _float_or_none(num["lng"].iat[i]),
            "chain_id": chain_id,
            "chain_name": chain_name,
            "overall_rating": _int_or_none(num["overall"].iat[i]),
            "health_inspection_rating": _int_or_none(num["health"].iat[i]),
            "staffing_rating": _int_or_none(num["staffing"].iat[i]),
            "qm_rating": _int_or_none(num["qm"].iat[i]),
            "reported_rn_staffing_hours": _float_or_none(num["rep_rn"].iat[i]),
            "reported_total_staffing_hours": _float_or_none(num["rep_total"].iat[i]),
            "adjusted_rn_staffing_hours": _float_or_none(num["adj_rn"].iat[i]),
            "adjusted_total_staffing_hours": _float_or_none(num["adj_total"].iat[i]),
            "turnover_pct": _float_or_none(num["turnover"].iat[i], 1),
            "fines_count": _int_or_none(num["fines_count"].iat[i]),
            "fines_dollars": _int_or_none(num["fines_dollars"].iat[i]) or 0,
            "total_penalties": _int_or_none(num["penalties"].iat[i]),
            "payment_denials": _int_or_none(num["denials"].iat[i]),
            "inspection_over_2_years": bool(is_stale.iat[i]),
            "special_focus_status": _clean(df[SFF].iat[i]),
            "_sff_value": _clean(df[SFF].iat[i]),
            "_flag_keys": keys,
        }

        # Build flag objects (with actual-value detail strings).
        rec["flags"] = [
            {"key": k, "label": FLAG_LABELS[k], "detail": _flag_detail(k, rec)}
            for k in keys
        ]
        rec.pop("_sff_value")

        FACILITIES[ccn] = rec
        FACILITY_SEARCH.append(
            {
                "ccn": ccn,
                "name": rec["name"],
                "city": rec["city"],
                "state": rec["state"],
                "chain_name": chain_name,
                "overall_rating": rec["overall_rating"],
                "flags": keys,
            }
        )

    # ---- Chain aggregates (independents excluded: null Chain ID) ---------- #
    chain_df = df[df[CHAIN_ID].notna()].copy()
    idx = chain_df.index  # positions into num Series
    g = pd.DataFrame(
        {
            "chain_id": chain_df[CHAIN_ID].values,
            "chain_name": chain_df[CHAIN_NAME].values,
            "state": chain_df[STATE].values,
            "overall": num["overall"].loc[idx].values,
            "staffing": num["staffing"].loc[idx].values,
            "health": num["health"].loc[idx].values,
            "qm": num["qm"].loc[idx].values,
            "turnover": num["turnover"].loc[idx].values,
            "fines_dollars": num["fines_dollars"].loc[idx].fillna(0).values,
            "beds": num["beds"].loc[idx].values,
            "penalties": num["penalties"].loc[idx].fillna(0).values,
            "own_cat": own_cat.loc[idx].values,
            "abuse": is_abuse.loc[idx].astype(int).values,
            "sff": is_sff.loc[idx].astype(int).values,
            "flagged": chain_df[CCN].map(
                lambda c: 1 if FACILITIES[c]["_flag_keys"] else 0
            ).values,
        }
    )

    grouped = g.groupby("chain_id", sort=False)
    for chain_id, sub in grouped:
        n = len(sub)
        flagged = int(sub["flagged"].sum())
        total_fines = int(sub["fines_dollars"].sum())
        total_penalties = int(sub["penalties"].sum())
        abuse_count = int(sub["abuse"].sum())
        total_beds = int(sub["beds"].fillna(0).sum())
        fines_per_bed = (
            int(round(total_fines / total_beds)) if total_beds > 0 else None
        )
        # Ownership rollup from in-data facilities.
        cat_counts = sub["own_cat"].value_counts()
        for_profit_n = int(cat_counts.get("for_profit", 0))
        for_profit_pct = round(100.0 * for_profit_n / n, 1) if n else 0.0
        majority_ownership = "mixed"
        for cat_name in ("for_profit", "non_profit", "government"):
            if int(cat_counts.get(cat_name, 0)) > n / 2:
                majority_ownership = cat_name
                break
        if n == 1:
            size_band = "single"
        elif n <= 5:
            size_band = "small"
        elif n <= 24:
            size_band = "medium"
        else:
            size_band = "large"
        CHAINS[chain_id] = {
            "chain_id": chain_id,
            "chain_name": _clean(sub["chain_name"].iloc[0]),
            "facilities_in_data": n,
            "states": sorted({s for s in sub["state"] if pd.notna(s)}),
            "avg_overall_rating": _float_or_none(sub["overall"].mean(), 1),
            "avg_staffing_rating": _float_or_none(sub["staffing"].mean(), 1),
            "avg_health_inspection_rating": _float_or_none(sub["health"].mean(), 1),
            "avg_qm_rating": _float_or_none(sub["qm"].mean(), 1),
            "avg_turnover_pct": _float_or_none(sub["turnover"].mean(), 1),
            "total_fines_dollars": total_fines,
            "total_certified_beds": total_beds,
            "fines_per_bed": fines_per_bed,
            "total_penalties": total_penalties,
            "abuse_count": abuse_count,
            "special_focus_count": int(sub["sff"].sum()),
            "flagged_facilities": flagged,
            "flag_rate_pct": round(100.0 * flagged / n, 1) if n else 0.0,
            "fines_per_facility": int(total_fines / n),
            "abuse_rate_pct": round(100.0 * abuse_count / n, 1),
            "penalties_per_facility": round(total_penalties / n, 1),
            "size_band": size_band,
            "for_profit_pct": for_profit_pct,
            "majority_ownership": majority_ownership,
        }

    # Facility summaries per chain (for chain detail endpoint).
    for ccn, rec in FACILITIES.items():
        cid = rec["chain_id"]
        if cid is None:
            continue
        CHAIN_FACILITIES.setdefault(cid, []).append(
            {
                "ccn": rec["ccn"],
                "name": rec["name"],
                "city": rec["city"],
                "state": rec["state"],
                "lat": rec["lat"],
                "lng": rec["lng"],
                "certified_beds": rec["certified_beds"],
                "overall_rating": rec["overall_rating"],
                "staffing_rating": rec["staffing_rating"],
                "qm_rating": rec["qm_rating"],
                "turnover_pct": rec["turnover_pct"],
                "fines_dollars": rec["fines_dollars"],
                "fines_count": rec["fines_count"],
                "flags": rec["_flag_keys"],
            }
        )

    # Drop internal helper keys from stored detail records.
    for rec in FACILITIES.values():
        rec.pop("_flag_keys", None)

    # ---- National overview ------------------------------------------------ #
    n_fac = len(df)
    in_chains = int(df[CHAIN_ID].notna().sum())
    OVERVIEW.update(
        {
            "facilities": n_fac,
            "chains": len(CHAINS),
            "independents": n_fac - in_chains,
            "pct_facilities_in_chains": round(100.0 * in_chains / n_fac, 1),
            "states": int(df[STATE].nunique()),
            "total_fines_dollars": int(num["fines_dollars"].fillna(0).sum()),
            "abuse_flag_count": int(is_abuse.sum()),
            "thresholds": {
                "high_turnover_pct": THRESHOLDS["high_turnover_pct"],
                "heavy_fines_dollars": THRESHOLDS["heavy_fines_dollars"],
            },
            "processing_date": _clean(df[PROC_DATE].dropna().iloc[0])
            if df[PROC_DATE].notna().any()
            else None,
        }
    )


def build_geo() -> None:
    """Index facilities for the 'near me' search. ZIP centroids come from the
    bundled GeoNames US table (41,490 ZIPs, CC-BY); ZIPs absent from it fall
    back to centroids derived from facility coordinates (exact ZIP, then
    3-digit prefix). No external geocoder at runtime."""
    zcta_path = DATA_DIR / "us_zip_centroids.csv"
    if zcta_path.exists():
        with open(zcta_path) as fh:
            next(fh)
            for line in fh:
                z, lat_s, lng_s = line.rstrip("\n").split(",")
                try:
                    ZIP_CENTROIDS[z.zfill(5)] = (float(lat_s), float(lng_s))
                except ValueError:
                    continue
    zip_pts: dict[str, list[tuple[float, float]]] = {}
    prefix_pts: dict[str, list[tuple[float, float]]] = {}
    flag_keys = {f["ccn"]: f["flags"] for f in FACILITY_SEARCH}
    for rec in FACILITIES.values():
        lat, lng = rec["lat"], rec["lng"]
        if lat is None or lng is None:
            continue
        z = rec.get("zip")
        z5 = str(z).split(".")[0].zfill(5)[:5] if z else None
        FACILITY_GEO.append(
            {
                "ccn": rec["ccn"],
                "name": rec["name"],
                "city": rec["city"],
                "state": rec["state"],
                "chain_name": rec["chain_name"],
                "overall_rating": rec["overall_rating"],
                "fines_dollars": rec["fines_dollars"],
                "flags": flag_keys.get(rec["ccn"], []),
                "lat": lat,
                "lng": lng,
            }
        )
        if z5 and z5.isdigit():
            zip_pts.setdefault(z5, []).append((lat, lng))
            prefix_pts.setdefault(z5[:3], []).append((lat, lng))
    for z5, pts in zip_pts.items():
        # GeoNames centroids win; facility-derived fills only the gaps.
        ZIP_CENTROIDS.setdefault(z5, (
            sum(p[0] for p in pts) / len(pts),
            sum(p[1] for p in pts) / len(pts),
        ))
    for pfx, pts in prefix_pts.items():
        PREFIX_CENTROIDS[pfx] = (
            sum(p[0] for p in pts) / len(pts),
            sum(p[1] for p in pts) / len(pts),
        )


def _haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 3958.7613  # Earth radius, miles
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


load_data()
load_penalties(set(FACILITIES.keys()))
build_geo()


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
SORT_FIELDS = {
    "total_fines": "total_fines_dollars",
    "total_fines_dollars": "total_fines_dollars",
    "abuse_count": "abuse_count",
    "avg_overall_rating": "avg_overall_rating",
    "avg_turnover_pct": "avg_turnover_pct",
    "facilities_in_data": "facilities_in_data",
    "flag_rate_pct": "flag_rate_pct",
    "fines_per_facility": "fines_per_facility",
    "fines_per_bed": "fines_per_bed",
    "abuse_rate_pct": "abuse_rate_pct",
    "penalties_per_facility": "penalties_per_facility",
    "majority_ownership": "majority_ownership",
}

SIZE_BANDS = {"single", "small", "medium", "large"}

OWNERSHIP_VALUES = {"for_profit", "non_profit", "government", "mixed"}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/overview")
def overview():
    return OVERVIEW


@app.get("/api/chains")
def chains(
    q: str | None = None,
    state: str | None = None,
    min_facilities: int = Query(0, ge=0),
    size_band: str | None = None,
    ownership: str | None = None,
    has_abuse: bool | None = None,
    sort_by: str = "fines_per_facility",
    descending: bool = True,
):
    if sort_by not in SORT_FIELDS:
        raise HTTPException(400, f"Unknown sort_by {sort_by!r}; valid: {sorted(SORT_FIELDS)}")
    if size_band is not None and size_band not in SIZE_BANDS:
        raise HTTPException(400, f"Unknown size_band {size_band!r}; valid: {sorted(SIZE_BANDS)}")
    if ownership is not None and ownership not in OWNERSHIP_VALUES:
        raise HTTPException(400, f"Unknown ownership {ownership!r}; valid: {sorted(OWNERSHIP_VALUES)}")
    field = SORT_FIELDS[sort_by]

    items = list(CHAINS.values())
    if size_band:
        items = [c for c in items if c["size_band"] == size_band]
    if ownership:
        items = [c for c in items if c["majority_ownership"] == ownership]
    if has_abuse is not None:
        if has_abuse:
            items = [c for c in items if c["abuse_count"] > 0]
        else:
            items = [c for c in items if c["abuse_count"] == 0]
    if q:
        ql = q.lower()
        items = [c for c in items if c["chain_name"] and ql in c["chain_name"].lower()]
    if state:
        su = state.upper()
        items = [c for c in items if su in c["states"]]
    if min_facilities:
        items = [c for c in items if c["facilities_in_data"] >= min_facilities]

    # Sort real values by the chosen direction; null values always trail.
    # Flag rate ties are common (many chains sit at 100%), so that sort
    # breaks ties by facility count — a 149-facility chain at 100% flagged
    # outranks a 3-facility one.
    if sort_by == "flag_rate_pct":
        key = lambda c: (c[field], c["facilities_in_data"])  # noqa: E731
    else:
        key = lambda c: c[field]  # noqa: E731
    non_null = sorted(
        (c for c in items if c[field] is not None),
        key=key,
        reverse=descending,
    )
    null = [c for c in items if c[field] is None]
    items = non_null + null

    return {"total": len(items), "chains": items}


@app.get("/api/chains/{chain_id}")
def chain_detail(chain_id: str):
    chain = CHAINS.get(chain_id)
    if chain is None:
        raise HTTPException(404, f"Unknown chain_id {chain_id!r}")
    facs = sorted(
        CHAIN_FACILITIES.get(chain_id, []),
        key=lambda f: (f["fines_dollars"] is None, -(f["fines_dollars"] or 0)),
    )
    return {
        **chain,
        "fine_timeline": CHAIN_TIMELINE.get(chain_id, []),
        "facilities": facs,
    }


@app.get("/api/facilities")
def facilities_search(
    q: str | None = None,
    state: str | None = None,
    limit: int = Query(50, ge=1, le=50),
):
    items = FACILITY_SEARCH
    if q:
        ql = q.lower()
        items = [f for f in items if f["name"] and ql in f["name"].lower()]
    if state:
        su = state.upper()
        items = [f for f in items if f["state"] == su]
    total = len(items)
    return {"total": total, "facilities": items[:limit]}


NEAR_RADIUS_MILES = 40.0
NEAR_LIMIT = 50


@app.get("/api/near")
def near(zip: str = Query(..., min_length=5, max_length=5)):
    if not zip.isdigit():
        raise HTTPException(400, "ZIP must be 5 digits")
    resolved_by = "zip"
    centroid = ZIP_CENTROIDS.get(zip)
    if centroid is None:
        centroid = PREFIX_CENTROIDS.get(zip[:3])
        resolved_by = "prefix"
    if centroid is None:
        raise HTTPException(
            404, f"No facilities found for ZIP {zip} or its area ({zip[:3]}xx)"
        )
    clat, clng = centroid
    hits = []
    for f in FACILITY_GEO:
        d = _haversine_miles(clat, clng, f["lat"], f["lng"])
        if d <= NEAR_RADIUS_MILES:
            hits.append(
                {
                    "ccn": f["ccn"],
                    "name": f["name"],
                    "city": f["city"],
                    "state": f["state"],
                    "chain_name": f["chain_name"],
                    "overall_rating": f["overall_rating"],
                    "fines_dollars": f["fines_dollars"],
                    "flags": f["flags"],
                    "lat": f["lat"],
                    "lng": f["lng"],
                    "distance_miles": round(d, 1),
                }
            )
    hits.sort(key=lambda h: h["distance_miles"])
    # Summary counts are over the full radius, not just the capped list.
    flagged_total = sum(1 for h in hits if h["flags"])
    abuse_total = sum(1 for h in hits if "abuse" in h["flags"])
    return {
        "zip": zip,
        "centroid": {"lat": round(clat, 4), "lng": round(clng, 4)},
        "resolved_by": resolved_by,
        "total": len(hits),
        "flagged_total": flagged_total,
        "abuse_total": abuse_total,
        "facilities": hits[:NEAR_LIMIT],
    }


@app.get("/api/facilities/{ccn}")
def facility_detail(ccn: str):
    rec = FACILITIES.get(ccn)
    if rec is None:
        raise HTTPException(404, f"Unknown CCN {ccn!r}")
    return {**rec, "fine_timeline": FACILITY_TIMELINE.get(ccn, [])}
