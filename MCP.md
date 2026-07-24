# Chain Watch MCP Server

Chain Watch's dataset is also exposed as an [MCP](https://modelcontextprotocol.io)
server, so any MCP client (Claude Code, Claude Desktop, or your own agent) can
query nursing-home operator conduct directly: rank chains, pull a chain's
dossier, inspect a facility's red flags, or find facilities near a ZIP.

## Design

The server (`backend/app/mcp_server.py`) is a thin adapter over the existing
FastAPI backend. Every tool calls the same functions that serve the web API,
so the MCP surface and the web UI cannot disagree about a number — there is
one computation path, verified against CMS's own published figures (see the
main README's Verification section). A dedicated test
(`test_rank_chains_matches_api_directly`) asserts the two surfaces stay equal.

Outputs are trimmed for context economy: `rank_chains` returns a bounded page
(default 25) rather than all 635 chains, because an LLM context window is not
a browser table.

## Tools

| Tool | Purpose |
| --- | --- |
| `overview()` | National context, thresholds, processing date |
| `rank_chains(...)` | Rank operators by fines, red-flag rate, turnover, etc., with size/state/ownership filters |
| `chain_detail(chain_id)` | One chain's dossier: rank, fines vs national average, fine timeline, footprint |
| `search_facilities(q, state)` | Find facilities, returns CCNs |
| `facility_detail(ccn)` | One facility's ratings, fines, and red flags with the values behind them |
| `facilities_near(zip_code)` | Facilities within 40 miles of a ZIP, nearest first |

## Run it

From `backend/` (dependencies include `mcp`):

```bash
uv run python -m app.mcp_server
```

### Claude Code

```bash
claude mcp add chainwatch -- uv --directory /path/to/chain-watch/backend run python -m app.mcp_server
```

Then ask things like: *"Using chainwatch, which large for-profit chains in
Texas have the worst fines per facility, and what are the red flags on their
worst home?"*

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "chainwatch": {
      "command": "uv",
      "args": ["--directory", "/path/to/chain-watch/backend", "run", "python", "-m", "app.mcp_server"]
    }
  }
}
```

## Tests

```bash
uv run pytest tests/test_mcp_server.py
```

Covers every tool, error surfacing (bad sort keys, bad ZIPs), MCP-vs-API
equality, and a full stdio protocol round-trip (initialize → list_tools →
call_tool).
