"""Smoke tests for the Chain Watch API — one per endpoint plus error cases."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_overview():
    r = client.get("/api/overview")
    assert r.status_code == 200
    d = r.json()
    for k in (
        "facilities",
        "chains",
        "independents",
        "pct_facilities_in_chains",
        "states",
        "total_fines_dollars",
        "abuse_flag_count",
        "thresholds",
        "processing_date",
    ):
        assert k in d
    assert d["facilities"] == 14695
    assert 0 < d["chains"] < d["facilities"]
    assert d["thresholds"]["heavy_fines_dollars"] > 0
    assert d["thresholds"]["high_turnover_pct"] > 0


def test_chains_default_sort_is_fines_per_facility():
    r = client.get("/api/chains")
    assert r.status_code == 200
    d = r.json()
    assert d["total"] == len(d["chains"]) > 0
    fpf = [c["fines_per_facility"] for c in d["chains"]]
    assert fpf == sorted(fpf, reverse=True)


def test_chains_all_sorts():
    for s in (
        "total_fines",
        "abuse_count",
        "avg_overall_rating",
        "avg_turnover_pct",
        "facilities_in_data",
        "flag_rate_pct",
        "fines_per_facility",
        "abuse_rate_pct",
        "penalties_per_facility",
        "majority_ownership",
    ):
        r = client.get("/api/chains", params={"sort_by": s})
        assert r.status_code == 200, s


def test_chains_sort_by_majority_ownership():
    d = client.get(
        "/api/chains", params={"sort_by": "majority_ownership", "descending": "false"}
    ).json()
    vals = [c["majority_ownership"] for c in d["chains"]]
    assert vals == sorted(vals)
    assert set(vals) <= {"for_profit", "non_profit", "government", "mixed"}


def test_chains_fines_per_bed_fields_and_sort():
    d = client.get("/api/chains", params={"sort_by": "fines_per_bed"}).json()
    vals = []
    for c in d["chains"]:
        assert "total_certified_beds" in c and "fines_per_bed" in c
        assert isinstance(c["total_certified_beds"], int)
        if c["fines_per_bed"] is None:
            assert c["total_certified_beds"] == 0
        else:
            assert isinstance(c["fines_per_bed"], int)
            # fines_per_bed = total fines / total beds, rounded.
            assert c["fines_per_bed"] == round(
                c["total_fines_dollars"] / c["total_certified_beds"]
            )
            vals.append(c["fines_per_bed"])
    # Non-null values are sorted descending (nulls trail).
    assert vals == sorted(vals, reverse=True)


def test_chain_detail_has_bed_fields():
    top = client.get("/api/chains").json()["chains"][0]
    d = client.get(f"/api/chains/{top['chain_id']}").json()
    assert "total_certified_beds" in d
    assert "fines_per_bed" in d


def test_chains_bad_sort_400():
    r = client.get("/api/chains", params={"sort_by": "nope"})
    assert r.status_code == 400


def test_chains_normalized_fields_and_size_band():
    chains = client.get("/api/chains").json()["chains"]
    bounds = {"single": (1, 1), "small": (2, 5), "medium": (6, 24), "large": (25, 10**9)}
    for c in chains:
        assert isinstance(c["fines_per_facility"], int)
        assert isinstance(c["abuse_rate_pct"], (int, float))
        assert isinstance(c["penalties_per_facility"], (int, float))
        lo, hi = bounds[c["size_band"]]
        assert lo <= c["facilities_in_data"] <= hi


def test_chains_size_band_filter():
    for band, lo, hi in (("single", 1, 1), ("small", 2, 5), ("medium", 6, 24), ("large", 25, 10**9)):
        d = client.get("/api/chains", params={"size_band": band}).json()
        assert all(lo <= c["facilities_in_data"] <= hi for c in d["chains"]), band
        assert all(c["size_band"] == band for c in d["chains"])


def test_chains_bad_size_band_400():
    assert client.get("/api/chains", params={"size_band": "huge"}).status_code == 400


def test_chains_ownership_fields_present():
    chains = client.get("/api/chains").json()["chains"]
    for c in chains:
        assert isinstance(c["for_profit_pct"], (int, float))
        assert 0.0 <= c["for_profit_pct"] <= 100.0
        assert c["majority_ownership"] in {
            "for_profit", "non_profit", "government", "mixed"
        }


def test_chain_detail_has_ownership_fields():
    top = client.get("/api/chains").json()["chains"][0]
    d = client.get(f"/api/chains/{top['chain_id']}").json()
    assert "for_profit_pct" in d
    assert "majority_ownership" in d


def test_chains_ownership_filter():
    for val in ("for_profit", "non_profit", "government", "mixed"):
        d = client.get("/api/chains", params={"ownership": val}).json()
        assert all(c["majority_ownership"] == val for c in d["chains"])


def test_chains_bad_ownership_400():
    assert client.get("/api/chains", params={"ownership": "nope"}).status_code == 400


def test_chains_has_abuse_filter():
    yes = client.get("/api/chains", params={"has_abuse": "true"}).json()["chains"]
    assert yes and all(c["abuse_count"] > 0 for c in yes)
    no = client.get("/api/chains", params={"has_abuse": "false"}).json()["chains"]
    assert no and all(c["abuse_count"] == 0 for c in no)


def test_chains_combined_filters():
    d = client.get(
        "/api/chains",
        params={"ownership": "for_profit", "has_abuse": "true", "size_band": "large"},
    ).json()
    for c in d["chains"]:
        assert c["majority_ownership"] == "for_profit"
        assert c["abuse_count"] > 0
        assert c["size_band"] == "large"


def test_chains_query_and_state_filter():
    r = client.get("/api/chains", params={"q": "genesis"})
    assert r.status_code == 200
    d = r.json()
    assert d["total"] >= 1
    assert all("genesis" in c["chain_name"].lower() for c in d["chains"])


def test_chain_detail_and_404():
    top = client.get("/api/chains").json()["chains"][0]
    cid = top["chain_id"]
    r = client.get(f"/api/chains/{cid}")
    assert r.status_code == 200
    d = r.json()
    assert d["chain_id"] == cid
    assert len(d["facilities"]) == d["facilities_in_data"]
    assert "flags" in d["facilities"][0]
    assert client.get("/api/chains/__nope__").status_code == 404


def test_facility_detail_and_404():
    top = client.get("/api/chains").json()["chains"][0]
    ccn = client.get(f"/api/chains/{top['chain_id']}").json()["facilities"][0]["ccn"]
    r = client.get(f"/api/facilities/{ccn}")
    assert r.status_code == 200
    d = r.json()
    assert d["ccn"] == ccn
    for k in ("ownership_type", "reported_rn_staffing_hours", "flags", "chain_name"):
        assert k in d
    for f in d["flags"]:
        assert {"key", "label", "detail"} <= set(f)
    assert client.get("/api/facilities/000000").status_code == 404


def test_facility_search():
    r = client.get("/api/facilities", params={"q": "oak", "limit": 5})
    assert r.status_code == 200
    d = r.json()
    assert len(d["facilities"]) <= 5
    if d["facilities"]:
        f = d["facilities"][0]
        assert set(f) == {"ccn", "name", "city", "state", "chain_name", "overall_rating", "flags"}


def test_facility_search_limit_cap():
    assert client.get("/api/facilities", params={"limit": 100}).status_code == 422


def test_near_known_zip():
    r = client.get("/api/near", params={"zip": "60622"})
    assert r.status_code == 200
    d = r.json()
    assert d["zip"] == "60622"
    assert d["resolved_by"] == "zip"
    assert d["total"] > 0
    # Summary counts span the full radius, not just the returned page.
    assert 0 <= d["flagged_total"] <= d["total"]
    assert 0 <= d["abuse_total"] <= d["flagged_total"]
    assert -90 <= d["centroid"]["lat"] <= 90
    facs = d["facilities"]
    assert len(facs) <= 50
    dists = [f["distance_miles"] for f in facs]
    assert dists == sorted(dists)  # sorted by distance
    assert all(f["distance_miles"] <= 40.0 for f in facs)
    for f in facs:
        assert set(f) >= {
            "ccn", "name", "city", "state", "chain_name",
            "overall_rating", "fines_dollars", "flags", "distance_miles",
        }


def test_near_zip_without_facilities_resolves():
    # A residential ZIP with no facilities in it still resolves — via the
    # bundled GeoNames centroid table (or the 3-digit prefix fallback for
    # ZIPs the table lacks).
    r = client.get("/api/near", params={"zip": "19301"})
    assert r.status_code == 200
    body = r.json()
    assert body["resolved_by"] in ("zip", "prefix")
    # Paoli, PA — GeoNames places it near (40.04, -75.48).
    assert abs(body["centroid"]["lat"] - 40.04) < 0.1
    assert abs(body["centroid"]["lng"] + 75.48) < 0.1


def test_near_bogus_zip_404():
    assert client.get("/api/near", params={"zip": "00000"}).status_code == 404


def test_near_bad_length_422():
    assert client.get("/api/near", params={"zip": "123"}).status_code == 422


def _assert_timeline(tl):
    assert isinstance(tl, list)
    years = [e["year"] for e in tl]
    assert years == sorted(years)  # sorted ascending, no duplicates implied by grouping
    assert len(years) == len(set(years))
    for e in tl:
        assert set(e) == {"year", "fine_count", "fine_dollars"}
        assert isinstance(e["year"], int)
        assert isinstance(e["fine_count"], int) and e["fine_count"] >= 1
        assert isinstance(e["fine_dollars"], int) and e["fine_dollars"] >= 0


def test_chain_detail_fine_timeline():
    # Find a chain that actually has fines so we exercise a populated timeline.
    chains = client.get("/api/chains", params={"sort_by": "total_fines"}).json()["chains"]
    cid = chains[0]["chain_id"]
    d = client.get(f"/api/chains/{cid}").json()
    assert "fine_timeline" in d
    _assert_timeline(d["fine_timeline"])
    assert len(d["fine_timeline"]) >= 1  # top-fines chain must have timeline entries


def test_facility_fine_timeline_present_and_shape():
    chains = client.get("/api/chains", params={"sort_by": "total_fines"}).json()["chains"]
    cid = chains[0]["chain_id"]
    facs = client.get(f"/api/chains/{cid}").json()["facilities"]
    for f in facs:
        d = client.get(f"/api/facilities/{f['ccn']}").json()
        assert "fine_timeline" in d
        _assert_timeline(d["fine_timeline"])
