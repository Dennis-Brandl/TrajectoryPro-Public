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
import { bodyLimit } from 'hono/body-limit';
import { httpError } from '../lib/errors';

// Spec §7's size guard. Without it, both import routes call
// `Buffer.from(await file.arrayBuffer())` unconditionally, so a single oversized upload
// buffers straight into server memory. Designer's .WFmasterX/.WFenvirX packages are zipped
// JSON — even a very large spec is a few MB — so 25 MB is ample headroom for a legitimate
// package while bounding what one request can allocate.
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

// Hono's bodyLimit short-circuits on `content-length` when the client sends one, and
// otherwise counts the stream as it reads — so memory stays bounded on both paths.
export const importBodyLimit = bodyLimit({
  maxSize: MAX_IMPORT_BYTES,
  onError: (c) => httpError(c, 413, 'too_large', `Package exceeds the ${MAX_IMPORT_BYTES / 1024 / 1024} MB import limit`),
});
