// Copyright 2026 Dennis L. Brandl
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Container release version, stamped into export manifests as
 * `container_version` (.WFenvirSnapshot and .WFenvirBundleX).
 *
 * Kept as a source constant rather than a package.json read because the
 * Docker image runs the server as a single esbuild bundle (server.mjs) with
 * no package.json alongside. Bump together with the suite version in the
 * root package.json.
 */
export const CONTAINER_VERSION = '3.0.0'
