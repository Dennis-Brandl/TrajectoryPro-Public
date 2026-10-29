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

# Generates the secrets the suite's compose files require, into each .env.
#
# Keeps every existing line; appends only variables that are missing, each a
# random 48-character [A-Za-z0-9] value. Prints variable names, never values.
# Safe to run again. Needs only POSIX sh (works in Git Bash). Honours
# SETUP_SECRETS_ROOT (default: the repository root) so tests can use a temp tree.

ROOT=${SETUP_SECRETS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}

# Docker installed but stopped: stop before writing anything, so an existing
# database is never given a password it was not created with.
HAVE_DOCKER=0
if command -v docker >/dev/null 2>&1; then
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running, or this user cannot reach it (add yourself to the docker group)."
    exit 1
  fi
  HAVE_DOCKER=1
fi

gen() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48; }

has_var() { [ -f "$1" ] && grep -q "^$2=" "$1"; }

db_exists() {
  [ "$HAVE_DOCKER" = 1 ] || return 1
  for v in $1; do
    docker volume inspect "$v" >/dev/null 2>&1 && return 0
  done
  return 1
}

# manage <relative file> <variables> <volumes that mean "existing database">
manage() {
  rel=$1; vars=$2; volumes=$3
  dir=$(dirname "$ROOT/$rel")
  [ -d "$dir" ] || { echo "$rel: folder not found, skipped"; return 0; }
  file="$ROOT/$rel"
  added=""
  for name in $vars; do
    if has_var "$file" "$name"; then
      cur=$(grep "^$name=" "$file" | head -1 | cut -d= -f2- | tr -d '\r')
      if [ -z "$cur" ]; then
        echo "$rel: $name is empty; set it or delete the line, then run this script again."
      elif [ "$name" != POSTGRES_PASSWORD ] && [ "${#cur}" -lt 32 ]; then
        echo "$rel: $name is shorter than 32 characters; replace it or delete the line, then run this script again."
      fi
      continue
    fi
    case $name in
      POSTGRES_PASSWORD)
        if db_exists "$volumes"; then
          value=mission
          echo "$rel: a database volume already exists; using the pre-2026-10 default password 'mission'. If you created that database with this script, restore your old .env instead; see DOCKER-README \"Changing the database password\"."
        else
          value=$(gen)
        fi ;;
      ACTIONS_API_KEY)
        value=""
        if [ "$rel" != ".env" ] && [ -f "$ROOT/.env" ]; then
          value=$(grep '^ACTIONS_API_KEY=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '\r')
        fi
        [ -n "$value" ] || value=$(gen) ;;
      *) value=$(gen) ;;
    esac
    # A file with no final newline gets one first, so the new line stands alone.
    if [ -s "$file" ] && [ -n "$(tail -c1 "$file")" ]; then
      printf '\n' >> "$file"
    fi
    printf '%s=%s\n' "$name" "$value" >> "$file"
    added="$added $name"
  done
  if [ -n "$added" ]; then
    echo "$rel: added$added"
  else
    echo "$rel: nothing to add"
  fi
}

manage ".env" "POSTGRES_PASSWORD ENGINE_INTERNAL_TOKEN MISSION_BROKER_TOKEN ACTIONS_API_KEY MISSION_ENGINE_AUTH_SECRET" \
  "trajectorypro_missioncommander-pgdata trajectorypro_missionautopilot-pgdata"
manage "MissionDesigner/.env" "POSTGRES_PASSWORD" "missiondesigner_missiondesigner-pgdata"
manage "MissionAutopilot/.env" "POSTGRES_PASSWORD ACTIONS_API_KEY" "missionautopilot_missionautopilot-pgdata"
manage "mission-control-db/.env" "POSTGRES_PASSWORD" "mission-control-db_mission_control_pg"
exit 0
