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

# ── Data directory ───────────────────────────────────────────────────────
# Holds only the auto-generated auth secret. The database is a separate
# Postgres service, reached via DATABASE_URL.
mkdir -p /data

# ── Auth secret ──────────────────────────────────────────────────────────
# src/server/index.ts refuses to start in production without a real secret, so
# generate and persist one when the operator hasn't supplied it. Persisting it in
# /data matters: a secret that changed on every restart would invalidate every
# existing session cookie.
if [ -z "$BETTER_AUTH_SECRET" ]; then
  if [ -f /data/.auth-secret ]; then
    BETTER_AUTH_SECRET=$(cat /data/.auth-secret)
    export BETTER_AUTH_SECRET
  else
    BETTER_AUTH_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
    export BETTER_AUTH_SECRET
    echo "$BETTER_AUTH_SECRET" > /data/.auth-secret
    chmod 600 /data/.auth-secret
  fi
  echo "WARNING: using an auto-generated auth secret. Set BETTER_AUTH_SECRET for production."
fi

# ── Schema ───────────────────────────────────────────────────────────────
# Idempotent: drizzle skips migrations already recorded in its journal table.
echo "Applying migrations..."
node migrate.mjs

# ── Demo logins ──────────────────────────────────────────────────────────
# Opt-in via SEED_DEMO=true (the compose service sets it) so a real deployment
# never silently creates known-password accounts. Idempotent — seedDemo() checks
# for each user before creating it. Seeding also CLOSES the first-run public
# sign-up gate, since an administrator then exists.
if [ "$SEED_DEMO" = "true" ]; then
  echo "Seeding demo logins..."
  node seed.mjs
fi

exec node server.mjs
