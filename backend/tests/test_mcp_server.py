"""Tests for the Chain Watch MCP server.

Two layers: direct tool-function tests (fast, most cases) and one full
stdio protocol round-trip (initialize, list_tools, call_tool) proving the
server speaks MCP, not just Python.
"""

import asyncio
import json

import pytest

from app import mcp_server as m


def call(tool, *args, **kwargs):
    fn = getattr(tool, "fn", None) or tool
    return fn(*args, **kwargs)


def test_overview_shape():
    ov = call(m.overview)
    assert ov["facilities"] > 10000
    assert ov["chains"] > 500
    assert 0 < ov["pct_facilities_in_chains"] < 100
    assert "thresholds" in ov


def test_rank_chains_default_sort_and_limit():
    r = call(m.rank_chains, min_facilities=25, limit=3)
    assert r["returned"] == 3
    assert len(r["chains"]) == 3
    fpf = [c["fines_per_facility"] for c in r["chains"]]
    assert fpf == sorted(fpf, reverse=True)


def test_rank_chains_matches_api_directly():
    """The MCP surface must agree with the API computation path exactly."""
    from app import main as api

    api_rows = api.chains(min_facilities=25)["chains"]
    mcp_rows = call(m.rank_chains, min_facilities=25, limit=len(api_rows))["chains"]
    assert mcp_rows == api_rows[: len(mcp_rows)]


def test_rank_chains_bad_sort_surfaces_error():
    with pytest.raises(ValueError, match="400"):
        call(m.rank_chains, sort_by="bogus")


def test_chain_detail_roundtrip():
    top = call(m.rank_chains, min_facilities=25, limit=1)["chains"][0]
    d = call(m.chain_detail, str(top["chain_id"]))
    assert d["chain_name"] == top["chain_name"]


def test_facility_search_and_detail():
    s = call(m.search_facilities, q="care", state="NY", limit=3)
    assert s["total"] >= 1
    first = s["facilities"][0]
    fd = call(m.facility_detail, first["ccn"])
    assert fd["name"] == first["name"]


def test_facilities_near_and_bad_zip():
    n = call(m.facilities_near, "10001")
    assert len(n["facilities"]) > 0
    with pytest.raises(ValueError, match="404|400"):
        call(m.facilities_near, "00000")


def test_stdio_protocol_roundtrip():
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    async def run():
        params = StdioServerParameters(
            command="python3", args=["-m", "app.mcp_server"], cwd="."
        )
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                names = {t.name for t in tools.tools}
                assert {
                    "overview",
                    "rank_chains",
                    "chain_detail",
                    "search_facilities",
                    "facility_detail",
                    "facilities_near",
                } <= names
                res = await session.call_tool("overview", {})
                data = json.loads(res.content[0].text)
                assert data["chains"] > 500

    asyncio.run(run())
