#!/usr/bin/env sh
# Copyright 2026 Dennis L. Brandl
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Deploy gate + deploy for the mission-engine container.
#
# Every other engine test runs on PGlite, which is single-connection — only
# MissionEngine/test/real-pg.engine.test.ts proves the SKIP LOCKED
# claim path against a genuinely concurrent multi-connection Postgres. This
# script makes that proof part of every deploy: it spins up a throwaway
# Postgres, runs the suite against it, and only rebuilds the mission-engine
# container when the proof is green.
#
# Usage (from anywhere, Git Bash on Windows is fine):
#   scripts/deploy-mission-engine.sh
#
# Standing rule (unchanged by this script): when a mission-control-db
# MIGRATION changed, deploy mission-commander (the migrator) BEFORE the engine:
#   docker compose up -d --build --no-deps mission-commander
set -eu
cd "$(dirname "$0")/.."

CONTAINER=trajectorypro-realpg-gate
PORT="${REALPG_GATE_PORT:-5439}"
URL="postgres://postgres:gate@127.0.0.1:${PORT}/engine_gate"

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

echo "[gate] starting throwaway Postgres on 127.0.0.1:${PORT}..."
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=gate -e POSTGRES_DB=engine_gate \
  -p "127.0.0.1:${PORT}:5432" postgres:17-alpine >/dev/null

i=0
until docker exec "$CONTAINER" pg_isready -U postgres -d engine_gate >/dev/null 2>&1; do
  i=$((i+1))
  if [ "$i" -gt 60 ]; then echo "[gate] postgres never became ready" >&2; exit 1; fi
  sleep 1
done

echo "[gate] running the real-PG concurrency proof..."
(cd MissionEngine && REAL_PG_TEST_URL="$URL" npm run test:real-pg)

echo "[gate] concurrency proof green — rebuilding mission-engine"
docker compose up -d --build --no-deps mission-engine
echo "[gate] mission-engine deployed"
