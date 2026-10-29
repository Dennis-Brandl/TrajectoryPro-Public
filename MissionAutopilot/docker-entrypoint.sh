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

# All persistent application state lives in Postgres (DATABASE_URL, supplied
# by compose/the environment — no default is baked into the image). Uploaded
# package archives (management API import/export routes) are handled
# entirely in memory via multer.memoryStorage() and never touch disk —
# `grep -rn "uploads" packages/server/src` returns no matches, so there is no
# local directory for the server to expect. /data stays mounted (see the
# Dockerfile VOLUME) but nothing currently reads or writes it.

exec node /app/server.mjs
