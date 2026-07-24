"""Chain Watch MCP server.

Exposes the Chain Watch dataset (CMS nursing-home provider + penalty files)
to MCP clients such as Claude Code and Claude Desktop.

Design: this is a thin adapter over the existing FastAPI backend. Every tool
calls the same functions that serve the web API, so the MCP surface and the
web UI can never disagree about a number. No statistics are recomputed here.

Run (from backend/):
    uv run python -m app.mcp_server

Register with Claude Code (from repo root):
    claude mcp add chainwatch -- uv --directory backend run python -m app.mcp_server
"""

from typing import Any

from fastapi import HTTPException
from mcp.server.fastmcp import FastMCP

# Importing app.main loads the CSVs and precomputes all served structures
# (module-level load_data()/load_penalties()/build_geo() calls).
from app import main as api

mcp = FastMCP(
    "chainwatch",
    instructions=(
        "Chain Watch ranks U.S. nursing-home OPERATORS (chains), not just "
        "individual homes, by conduct signals computed from CMS public data: "
        "fines, abuse flags, Special Focus status, staffing turnover, and "
        "red-flag rates. Start with overview() for national context, "
        "rank_chains() to rank operators, then chain_detail()/facility_detail() "
        "to drill in. All statistics come from the bundled CMS files via the "
        "same computation path as the Chain Watch web API."
    ),
)


def _call(fn, *args, **kwargs) -> dict[str, Any]:
    """Invoke an API route function, translating HTTP errors to tool errors."""
    try:
        return fn(*args, **kwargs)
    except HTTPException as exc:  # surface the API's own message to the model
        raise ValueError(f"{exc.status_code}: {exc.detail}") from exc


@mcp.tool()
def overview() -> dict[str, Any]:
    """National context: facility/chain/independent counts, share of
    facilities in chains, total fines, abuse-flag count, the data-derived
    thresholds used in red-flag logic, and the CMS processing date."""
    return _call(api.overview)


@mcp.tool()
def rank_chains(
    q: str | None = None,
    state: str | None = None,
    min_facilities: int = 0,
    size_band: str | None = None,
    ownership: str | None = None,
    has_abuse: bool | None = None,
    sort_by: str = "fines_per_facility",
    descending: bool = True,
    limit: int = 25,
) -> dict[str, Any]:
    """Rank nursing-home chains by a conduct signal.

    Args:
        q: substring match on chain name.
        state: two-letter state; keeps chains with at least one facility
            there (aggregates remain national).
        min_facilities: minimum facilities in the chain.
        size_band: one of small (2-9), medium (10-24), large (25+).
        ownership: for_profit, non_profit, or government (majority type).
        has_abuse: True keeps only chains with at least one abuse-flagged
            facility.
        sort_by: fines_per_facility (default), total_fines, fines_per_bed,
            avg_overall, facilities, red_flag_rate, abuse_facilities,
            sff_count, avg_turnover, or other fields the API accepts;
            invalid values return the valid list in the error.
        descending: sort direction.
        limit: rows returned (keep small; each row is verbose).
    """
    result = _call(
        api.chains,
        q=q,
        state=state,
        min_facilities=min_facilities,
        size_band=size_band,
        ownership=ownership,
        has_abuse=has_abuse,
        sort_by=sort_by,
        descending=descending,
    )
    # Trim for context economy: the web UI paginates client-side; an LLM
    # should not receive 635 chains unless it asks for them.
    chains = result.get("chains", [])
    return {
        "total_matching": result.get("total", len(chains)),
        "returned": min(limit, len(chains)),
        "sort_by": sort_by,
        "chains": chains[: max(1, min(limit, 100))],
    }


@mcp.tool()
def chain_detail(chain_id: str) -> dict[str, Any]:
    """Full dossier for one chain: rank among all chains, fines per facility
    vs the national average, fines-by-year timeline, flag counts, and its
    facility footprint."""
    return _call(api.chain_detail, chain_id)


@mcp.tool()
def search_facilities(
    q: str | None = None,
    state: str | None = None,
    limit: int = 25,
) -> dict[str, Any]:
    """Search individual facilities by name substring and/or state.
    Returns lightweight rows with CCN identifiers for facility_detail()."""
    return _call(api.facilities_search, q=q, state=state, limit=min(limit, 50))


@mcp.tool()
def facility_detail(ccn: str) -> dict[str, Any]:
    """Full detail for one facility by CMS Certification Number (CCN):
    ratings, staffing, fines and fine timeline, red flags with the actual
    values behind each flag, and the chain it belongs to (if any)."""
    return _call(api.facility_detail, ccn)


@mcp.tool()
def facilities_near(zip_code: str) -> dict[str, Any]:
    """Facilities within 40 miles of a 5-digit ZIP code, nearest first,
    with distance in miles. Useful for 'vet the homes near me' questions."""
    return _call(api.near, zip=zip_code)


if __name__ == "__main__":
    mcp.run()
