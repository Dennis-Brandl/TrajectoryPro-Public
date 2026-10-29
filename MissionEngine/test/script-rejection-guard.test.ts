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
//
// The engine's process-level guard, in real child processes: Node exits on an unhandled
// rejection, so without the guard a script's `Promise.reject` takes the engine down; with it the
// engine survives, and an engine-side rejection still exits.
import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHILD = fileURLToPath(new URL('./helpers/rejection-guard-child.ts', import.meta.url));
const run = (mode: string) => spawnSync(process.execPath, ['--import', 'tsx', CHILD, mode], { encoding: 'utf8', timeout: 30_000 });

test('without the guard, a script\'s rejected promise kills the process (the bug the guard fixes)', () => {
  const r = run('none');
  expect(r.status).not.toBe(0);
  expect(r.stdout).not.toContain('still alive');
}, 40_000);

test('with the guard, the process survives and logs a constant line', () => {
  const r = run('guard');
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('{"success":true}');
  expect(r.stdout).toContain('still alive');
  expect(r.stderr).toContain('[script] a script left a rejected promise unhandled; ignored');
}, 40_000);

test('with the guard, an engine-side rejection still exits the process', () => {
  const r = run('host');
  expect(r.status).not.toBe(0);
  expect(r.stdout).not.toContain('still alive');
  expect(r.stderr).toContain('engine bug');
}, 40_000);
