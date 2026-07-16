#!/usr/bin/env bash
# Run backend and frontend together for local development.
set -e
cd "$(dirname "$0")"
(cd backend && uv run uvicorn app.main:app --reload --port 8000) &
BACKEND_PID=$!
trap "kill $BACKEND_PID" EXIT
cd frontend && npm run dev
