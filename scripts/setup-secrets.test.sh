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

# Test for scripts/setup-secrets.sh. Run: sh scripts/setup-secrets.test.sh
# Every case runs in a fresh temp tree with a fake `docker` first on PATH.

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$HERE/setup-secrets.sh"
FAILS=0
ROOT_TMP=$(mktemp -d)
trap 'rm -rf "$ROOT_TMP"' EXIT

pass() { echo "PASS $1"; }
fail() { echo "FAIL $1 -- $2"; FAILS=$((FAILS + 1)); }

# new_tree <name>: makes the tree, a fake docker shim; echoes the tree path.
new_tree() {
  t="$ROOT_TMP/$1"
  mkdir -p "$t/tree/MissionDesigner" "$t/tree/MissionAutopilot" "$t/tree/mission-control-db" "$t/bin"
  cat > "$t/bin/docker" <<'SHIM'
#!/bin/sh
case "$1" in
  info) [ "$SHIM_DOCKER_DOWN" = 1 ] && exit 1; exit 0 ;;
  volume)
    for v in $SHIM_VOLUMES; do [ "$v" = "$3" ] && exit 0; done
    exit 1 ;;
esac
exit 0
SHIM
  chmod +x "$t/bin/docker"
  echo "$t"
}

# run_script <tree-dir> [env assignments...]: stdout to $t/out, status to $t/rc
run_script() {
  t="$1"; shift
  env "$@" PATH="$t/bin:$PATH" SETUP_SECRETS_ROOT="$t/tree" sh "$SCRIPT" > "$t/out" 2>&1
  echo $? > "$t/rc"
}

val() { grep "^$2=" "$1" | head -1 | cut -d= -f2- | tr -d '\r'; }
sum_all() { cat "$1/.env" "$1/MissionDesigner/.env" "$1/MissionAutopilot/.env" "$1/mission-control-db/.env" | cksum; }

# (a) fresh tree, docker absent from PATH
t=$(new_tree a)
rm "$t/bin/docker"
env PATH="$t/bin:/usr/bin:/bin" SETUP_SECRETS_ROOT="$t/tree" sh "$SCRIPT" > "$t/out" 2>&1; rc=$?
ok=1
[ "$rc" = 0 ] || ok=0
for spec in ".env:POSTGRES_PASSWORD ENGINE_INTERNAL_TOKEN MISSION_BROKER_TOKEN ACTIONS_API_KEY MISSION_ENGINE_AUTH_SECRET" \
            "MissionDesigner/.env:POSTGRES_PASSWORD" \
            "MissionAutopilot/.env:POSTGRES_PASSWORD ACTIONS_API_KEY" \
            "mission-control-db/.env:POSTGRES_PASSWORD"; do
  f="$t/tree/${spec%%:*}"
  for k in ${spec#*:}; do
    v=$(val "$f" "$k")
    [ "${#v}" = 48 ] || { ok=0; echo "  $f $k length ${#v}"; }
    [ "$v" != mission ] || ok=0
  done
done
[ $ok = 1 ] && pass "a fresh tree, no docker" || fail "a fresh tree, no docker" "rc=$rc"

# (b) CRLF, no final newline, existing value kept byte-identical
t=$(new_tree b)
printf 'ENGINE_INTERNAL_TOKEN=keep-me\r\nMISSION_BROKER_TOKEN=keep-too' > "$t/tree/.env"
run_script "$t"
ok=1
printf 'ENGINE_INTERNAL_TOKEN=keep-me\r\n' > "$t/expect"
head -c 31 "$t/tree/.env" > "$t/got"
cmp -s "$t/expect" "$t/got" || ok=0
grep -q '^MISSION_BROKER_TOKEN=keep-too$' "$t/tree/.env" || ok=0
[ "$(cut -d= -f1 "$t/tree/.env" | sort | uniq -d | wc -l | tr -d ' ')" = 0 ] || ok=0
[ "$(grep -c '^POSTGRES_PASSWORD=' "$t/tree/.env")" = 1 ] || ok=0
[ "$(grep -c '^ACTIONS_API_KEY=' "$t/tree/.env")" = 1 ] || ok=0
[ "$(grep -c '^MISSION_ENGINE_AUTH_SECRET=' "$t/tree/.env")" = 1 ] || ok=0
[ $ok = 1 ] && pass "b CRLF and no final newline" || fail "b CRLF and no final newline" "see $t/tree/.env"

# (c) existing Commander volume keeps the old password
t=$(new_tree c)
run_script "$t" SHIM_VOLUMES="trajectorypro_missioncommander-pgdata"
ok=1
[ "$(val "$t/tree/.env" POSTGRES_PASSWORD)" = mission ] || ok=0
grep -qF "a database volume already exists; using the pre-2026-10 default password 'mission'" "$t/out" || ok=0
[ "$(val "$t/tree/MissionDesigner/.env" POSTGRES_PASSWORD)" != mission ] || ok=0
[ $ok = 1 ] && pass "c existing volume keeps password" || fail "c existing volume keeps password" "$(cat "$t/out")"

# (d) docker installed but not running
t=$(new_tree d)
run_script "$t" SHIM_DOCKER_DOWN=1
ok=1
[ "$(cat "$t/rc")" = 1 ] || ok=0
grep -qF 'Docker is not running, or this user cannot reach it (add yourself to the docker group).' "$t/out" || ok=0
[ -z "$(find "$t/tree" -name .env)" ] || ok=0
[ $ok = 1 ] && pass "d docker not running" || fail "d docker not running" "rc=$(cat "$t/rc")"

# (e) second run changes nothing; (f) stdout has no generated value; (g) Autopilot key equals root
t=$(new_tree e)
run_script "$t"
before=$(sum_all "$t/tree")
cp "$t/out" "$t/out1"
run_script "$t"
after=$(sum_all "$t/tree")
[ "$before" = "$after" ] && [ "$(cat "$t/rc")" = 0 ] && pass "e second run is a no-op" || fail "e second run is a no-op" "checksums differ"

ok=1
for f in .env MissionDesigner/.env MissionAutopilot/.env mission-control-db/.env; do
  while IFS= read -r line; do
    v=$(printf '%s' "$line" | cut -d= -f2- | tr -d '\r')
    [ -n "$v" ] && { grep -qF "$v" "$t/out1" "$t/out" && ok=0; }
  done < "$t/tree/$f"
done
[ $ok = 1 ] && pass "f stdout never shows a value" || fail "f stdout never shows a value" "value leaked"

[ -n "$(val "$t/tree/.env" ACTIONS_API_KEY)" ] && [ "$(val "$t/tree/.env" ACTIONS_API_KEY)" = "$(val "$t/tree/MissionAutopilot/.env" ACTIONS_API_KEY)" ] \
  && pass "g Autopilot key equals root" || fail "g Autopilot key equals root" "differ"


# (h) present-but-empty / too-short values: warn, never change, never print
t=$(new_tree h)
printf 'ACTIONS_API_KEY=\r\nMISSION_BROKER_TOKEN=short12345\r\nPOSTGRES_PASSWORD=mission\r\n' > "$t/tree/.env"
cp "$t/tree/.env" "$t/orig"
run_script "$t"
ok=1
grep -q '^\.env: ACTIONS_API_KEY is empty; set it or delete the line, then run this script again\.$' "$t/out" || ok=0
grep -q '^\.env: MISSION_BROKER_TOKEN is shorter than 32 characters; replace it or delete the line, then run this script again\.$' "$t/out" || ok=0
grep -q 'POSTGRES_PASSWORD' "$t/out" && grep 'POSTGRES_PASSWORD' "$t/out" | grep -vq 'added' && ok=0
grep -q 'short12345' "$t/out" && ok=0
head -c "$(wc -c < "$t/orig")" "$t/tree/.env" | cmp -s - "$t/orig" || ok=0
[ "$(cat "$t/rc")" = 0 ] || ok=0
[ $ok = 1 ] && pass "h empty and short values warn only" || fail "h empty and short values warn only" "$(cat "$t/out")"

[ "$FAILS" = 0 ] || { echo "$FAILS failed"; exit 1; }
echo "all passed"
