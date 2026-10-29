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
import { expect, test } from 'vitest';
import { normalizeActionServerOrigin } from './action-server-origin';

test('normalizeActionServerOrigin accepts http(s) origins and rejects the rest', () => {
  expect(normalizeActionServerOrigin('http://mission-autopilot-server:3002/')).toEqual({ ok: true, origin: 'http://mission-autopilot-server:3002' });
  expect(normalizeActionServerOrigin('  HTTPS://Host.Example:8443 ')).toEqual({ ok: true, origin: 'https://host.example:8443' });
  expect(normalizeActionServerOrigin('ftp://x')).toMatchObject({ ok: false });
  expect(normalizeActionServerOrigin('not a url')).toMatchObject({ ok: false });
  expect(normalizeActionServerOrigin('http://host:3002/trajectory/v1/')).toMatchObject({ ok: false, reason: expect.stringContaining('path') });
  expect(normalizeActionServerOrigin('http://host:3002?x=1')).toMatchObject({ ok: false });
});
