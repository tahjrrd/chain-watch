#!/usr/bin/env python3
"""Refresh Chain Watch's CMS source data — no API key required.

CMS republishes the nursing-home "Provider Information" and "Penalties" files
periodically (free, public, no auth). This script:

  1. Resolves the current download URL for each dataset from the CMS Provider
     Data Catalog metastore API (the URL hash changes every release, so it must
     be looked up, not hardcoded).
  2. Downloads the files only if CMS is offering a newer month than what is in
     data/ (or when run with --force), sanity-checking each file first.
  3. Recomputes a small snapshot (headline aggregates + the worst operators)
     through the SAME pipeline the API and MCP server use — one source of truth.
  4. Writes data/snapshot.json and a Markdown diff (refresh_pr_body.md) so the
     GitHub Action can open a legible pull request.

Run locally from the repo root:
    uv run --project backend python scripts/refresh_data.py          # detect + refresh
    uv run --project backend python scripts/refresh_data.py --force  # re-download current release
    uv run --project backend python scripts/refresh_data.py --check  # detect only, never download

No secrets, no LLM, no paid services. GitHub Actions supplies its own token.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT / "data"
SNAPSHOT_PATH = DATA_DIR / "snapshot.json"
PR_BODY_PATH = REPO_ROOT / "refresh_pr_body.md"

# CMS Provider Data Catalog dataset identifiers (stable across releases).
METASTORE = "https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items"
DATASETS = {
    "NH_ProviderInfo": "4pq5-n9py",  # "Provider Information"
    "NH_Penalties": "g6vv-u9sr",     # "Penalties"
}
# A cheap header-based sanity check so we never commit an error page as data.
EXPECTED_HEADER_SUBSTR = {
    "NH_ProviderInfo": "CMS Certification Number",
    "NH_Penalties": "Penalty",
}
WORST_N = 15
USER_AGENT = "chain-watch-refresh/1.0 (+https://github.com/tahjrrd/chain-watch)"


# --------------------------------------------------------------------------- #
# CMS metastore + download
# --------------------------------------------------------------------------- #
def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310 (trusted host)
        return resp.read()


def resolve_release(prefix: str) -> dict:
    """Return {url, filename, modified} for the current CMS distribution."""
    meta = json.loads(_get(f"{METASTORE}/{DATASETS[prefix]}?show-reference-ids"))
    dist = (meta.get("distribution") or [{}])[0]
    data = dist.get("data", dist)
    url = data.get("downloadURL")
    if not url:
        raise RuntimeError(f"No downloadURL for {prefix} ({DATASETS[prefix]})")
    return {
        "url": url,
        "filename": url.rsplit("/", 1)[-1],  # e.g. NH_ProviderInfo_Jun2026.csv
        "modified": meta.get("modified", "unknown"),
    }


def local_files(prefix: str) -> list[Path]:
    return sorted(DATA_DIR.glob(f"{prefix}_*.csv"))


def download(prefix: str, release: dict) -> Path:
    """Download to data/, sanity-check, then retire older files of this dataset."""
    dest = DATA_DIR / release["filename"]
    print(f"  downloading {release['filename']} …", flush=True)
    payload = _get(release["url"])
    head = payload[:4096].decode("utf-8", "replace")
    needle = EXPECTED_HEADER_SUBSTR[prefix]
    if needle not in head:
        raise RuntimeError(
            f"{prefix}: downloaded file does not look like the expected CSV "
            f"(header missing {needle!r}); refusing to write."
        )
    if len(payload) < 50_000:
        raise RuntimeError(f"{prefix}: file suspiciously small ({len(payload)} bytes)")
    dest.write_bytes(payload)
    # Retire superseded months so data/ holds exactly one file per dataset and
    # the app's newest-release glob is unambiguous.
    for old in local_files(prefix):
        if old.name != dest.name:
            print(f"  retiring {old.name}")
            old.unlink()
    return dest


# --------------------------------------------------------------------------- #
# Snapshot (built through the real pipeline)
# --------------------------------------------------------------------------- #
def build_snapshot(release_labels: dict) -> dict:
    """Import the API fresh (loads whatever is now in data/) and summarize it."""
    sys.path.insert(0, str(REPO_ROOT / "backend"))
    from app import main as api  # noqa: E402  (must import AFTER any download)

    o = api.overview()
    # Pass min_facilities explicitly: called outside FastAPI, the parameter
    # default is a Query object, not an int (same reason the MCP tools do this).
    ranked = api.chains(
        min_facilities=0, sort_by="fines_per_facility", descending=True
    )["chains"]
    worst = [
        {
            "chain_id": c["chain_id"],
            "chain_name": c["chain_name"],
            "fines_per_facility": c["fines_per_facility"],
        }
        for c in ranked
        if c["fines_per_facility"] is not None
    ][:WORST_N]
    return {
        "release": {
            "provider_file": api.CSV_PATH.name,
            "penalties_file": api.PENALTIES_CSV_PATH.name,
            "provider_cms_modified": release_labels.get("NH_ProviderInfo", "?"),
            "penalties_cms_modified": release_labels.get("NH_Penalties", "?"),
            "processing_date": o["processing_date"],
        },
        "aggregates": {
            "facilities": o["facilities"],
            "chains": o["chains"],
            "independents": o["independents"],
            "pct_facilities_in_chains": o["pct_facilities_in_chains"],
            "total_fines_dollars": o["total_fines_dollars"],
            "abuse_flag_count": o["abuse_flag_count"],
        },
        "worst_chains_by_fines_per_facility": worst,
    }


# --------------------------------------------------------------------------- #
# Diff rendering
# --------------------------------------------------------------------------- #
def _delta(old, new) -> str:
    if old is None:
        return f"{new:,} (new)"
    d = new - old
    if d == 0:
        return f"{new:,} (no change)"
    return f"{old:,} → {new:,} ({d:+,})"


def render_body(old: dict | None, new: dict, changed: bool) -> str:
    rel = new["release"]
    lines = [
        "## Automated CMS data refresh",
        "",
        f"- **Provider file:** `{rel['provider_file']}` "
        f"(CMS modified {rel['provider_cms_modified']})",
        f"- **Penalties file:** `{rel['penalties_file']}` "
        f"(CMS modified {rel['penalties_cms_modified']})",
        f"- **Processing date:** {rel['processing_date']}",
        "",
    ]
    if not changed:
        lines += ["_No data change detected — already on the latest CMS release._", ""]
        return "\n".join(lines)

    oa = (old or {}).get("aggregates", {})
    na = new["aggregates"]
    lines += [
        "### Headline aggregates",
        "",
        "| Metric | Change |",
        "| --- | --- |",
        f"| Facilities | {_delta(oa.get('facilities'), na['facilities'])} |",
        f"| Chains (operators) | {_delta(oa.get('chains'), na['chains'])} |",
        f"| Independents | {_delta(oa.get('independents'), na['independents'])} |",
        f"| Total fines ($) | {_delta(oa.get('total_fines_dollars'), na['total_fines_dollars'])} |",
        f"| Abuse flags | {_delta(oa.get('abuse_flag_count'), na['abuse_flag_count'])} |",
        "",
    ]

    old_worst = {c["chain_id"]: c for c in (old or {}).get(
        "worst_chains_by_fines_per_facility", [])}
    lines += [
        f"### Worst {WORST_N} operators by fines per facility",
        "",
        "| # | Operator | Fines / facility | Movement |",
        "| --: | --- | --: | --- |",
    ]
    for i, c in enumerate(new["worst_chains_by_fines_per_facility"], 1):
        prev = old_worst.get(c["chain_id"])
        if prev is None:
            move = "🆕 new to list"
        else:
            d = c["fines_per_facility"] - prev["fines_per_facility"]
            move = "no change" if d == 0 else f"{d:+,.0f}"
        lines.append(
            f"| {i} | {c['chain_name']} | "
            f"${c['fines_per_facility']:,.0f} | {move} |"
        )
    lines += ["", "_Numbers computed through the same pipeline as the web API "
              "and MCP server. Review before merging._"]
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def emit_output(**kv) -> None:
    """Expose results to the GitHub Action via $GITHUB_OUTPUT (if present)."""
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a") as fh:
        for k, v in kv.items():
            fh.write(f"{k}={v}\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true",
                    help="download the current release even if data/ already has it")
    ap.add_argument("--check", action="store_true",
                    help="detect only; never download or write files")
    args = ap.parse_args()

    print("Resolving current CMS releases …")
    releases = {p: resolve_release(p) for p in DATASETS}
    labels = {p: r["modified"] for p, r in releases.items()}
    for p, r in releases.items():
        have = {f.name for f in local_files(p)}
        status = "have" if r["filename"] in have else "NEW"
        print(f"  {p}: CMS offers {r['filename']} [{status}]")

    needs = any(
        releases[p]["filename"] not in {f.name for f in local_files(p)}
        for p in DATASETS
    )

    if args.check:
        print(f"\nUpdate available: {needs}")
        emit_output(changed=str(needs).lower(),
                    release=releases["NH_ProviderInfo"]["filename"])
        return 0

    downloaded = False
    if needs or args.force:
        DATA_DIR.mkdir(exist_ok=True)
        for p in DATASETS:
            download(p, releases[p])
        downloaded = True
    else:
        print("\nAlready on the latest CMS release; recomputing snapshot only.")

    old = json.loads(SNAPSHOT_PATH.read_text()) if SNAPSHOT_PATH.exists() else None
    new = build_snapshot(labels)
    changed = downloaded or (old is None) or (
        old.get("aggregates") != new.get("aggregates")
    )

    SNAPSHOT_PATH.write_text(json.dumps(new, indent=2) + "\n")
    body = render_body(old, new, changed and downloaded)
    PR_BODY_PATH.write_text(body + "\n")

    print(f"\nSnapshot written to {SNAPSHOT_PATH.relative_to(REPO_ROOT)}")
    print(f"PR body written to {PR_BODY_PATH.relative_to(REPO_ROOT)}")
    print(f"Data downloaded this run: {downloaded}")

    # Only signal 'changed' to the workflow when actual data moved — a snapshot-
    # only recompute with identical numbers should not open a PR.
    emit_output(changed=str(bool(downloaded)).lower(),
                release=releases["NH_ProviderInfo"]["filename"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
