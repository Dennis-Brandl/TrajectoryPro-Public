#!/bin/bash
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

# Restart Mission Designer dev servers (backend + Vite)
# Usage: bash restart-dev.sh

cd "$(dirname "$0")"

# This script starts the backend on its default port (3000) and Vite on its
# default port (5173). dev:all uses 3001/5174 instead, so the two are independent.
BACKEND_PORT=3000
VITE_PORT=5173

# Targeted cleanup: kill ONLY the processes listening on our two ports. Never a
# blanket `taskkill //IM node.exe //F` — that also kills unrelated Node processes
# (your editor's language server, other projects, the dev:all servers on 3001/5174).
kill_port() {
  local port="$1"
  local pids
  pids=$(netstat -ano | awk -v port="$port" '$4 == "LISTENING" && $2 ~ (":" port "$") {print $5}' | sort -u)
  for pid in $pids; do
    echo "  Killing PID $pid on port $port"
    taskkill //PID "$pid" //F >/dev/null 2>&1 || true
  done
}

echo "Cleaning up processes on ports $BACKEND_PORT and $VITE_PORT..."
kill_port "$BACKEND_PORT"
kill_port "$VITE_PORT"
sleep 2

echo "Starting backend server (port $BACKEND_PORT)..."
# Node's native --watch + tsx loader, NOT `tsx watch`: on Windows `tsx watch`
# does a recursive node_modules scan at startup that takes 60-120s before the
# server listens. `node --watch --import tsx` boots in ~3s. See scripts/dev-start.mjs.
node --watch --import tsx src/server/index.ts &
sleep 3

echo "Starting Vite dev server (port $VITE_PORT)..."
npx vite &
sleep 3

echo ""
echo "Servers started. Press Ctrl+C to stop both."
wait
