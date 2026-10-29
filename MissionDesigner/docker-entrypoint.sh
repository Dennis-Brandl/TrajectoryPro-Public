#!/bin/sh
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

set -e

# ── Data directory setup ─────────────────────────────────────────────────
# Ensure /data exists for the auth secret. The database is a separate
# Postgres service (provided via DATABASE_URL); nothing to set up locally.
mkdir -p /data

# ── Auth secret setup ───────────────────────────────────────────────────
if [ -z "$BETTER_AUTH_SECRET" ]; then
  # Check for a previously generated secret
  if [ -f /data/.auth-secret ]; then
    export BETTER_AUTH_SECRET=$(cat /data/.auth-secret)
  else
    # Generate a random 32-byte hex secret and persist it
    export BETTER_AUTH_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
    echo "$BETTER_AUTH_SECRET" > /data/.auth-secret
    chmod 600 /data/.auth-secret
  fi
  echo "WARNING: Using auto-generated auth secret. For production, set BETTER_AUTH_SECRET environment variable."
fi

exec node server.mjs
