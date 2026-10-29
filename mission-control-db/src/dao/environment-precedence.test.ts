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
import { compareDefinitionPrecedence, compareVersions } from './environment-precedence.js';

const D = (s: string) => new Date(s);

test('compareVersions orders dotted-numeric segments numerically, not lexically', () => {
  expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0);
  expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
});

test('compareVersions treats a missing trailing segment as equal to zero', () => {
  expect(compareVersions('1.0', '1.0.0')).toBe(0);
  expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
});

test('compareVersions falls back to string compare on a non-numeric segment', () => {
  expect(compareVersions('1.0.0-rc2', '1.0.0-rc1')).toBeGreaterThan(0);
  expect(compareVersions('1.0.beta', '1.0.alpha')).toBeGreaterThan(0);
});

test('Effective outranks any non-Effective state regardless of version', () => {
  const effectiveOld = { state: 'Effective', version: '1.0.0', downloadedAt: D('2026-01-01') };
  const draftNew = { state: 'Draft', version: '9.9.9', downloadedAt: D('2026-08-01') };
  expect(compareDefinitionPrecedence(effectiveOld, draftNew)).toBeGreaterThan(0);
  expect(compareDefinitionPrecedence(draftNew, effectiveOld)).toBeLessThan(0);
});

test('within the same state tier, the higher version wins', () => {
  const a = { state: 'Effective', version: '1.2.0', downloadedAt: D('2026-01-01') };
  const b = { state: 'Effective', version: '1.1.0', downloadedAt: D('2026-08-01') };
  expect(compareDefinitionPrecedence(a, b)).toBeGreaterThan(0);
});

test('at the same state and version, the later download wins', () => {
  const a = { state: 'Draft', version: '1.0.0', downloadedAt: D('2026-08-02') };
  const b = { state: 'Draft', version: '1.0.0', downloadedAt: D('2026-08-01') };
  expect(compareDefinitionPrecedence(a, b)).toBeGreaterThan(0);
});

test('identical origins tie, so an incumbent definition is never displaced by an equal', () => {
  const a = { state: 'Effective', version: '1.0.0', downloadedAt: D('2026-08-01') };
  expect(compareDefinitionPrecedence(a, { ...a })).toBe(0);
});

test('a missing download timestamp on an orphaned incumbent loses to a dated challenger', () => {
  const challenger = { state: 'Draft', version: '1.0.0', downloadedAt: D('2026-08-01') };
  const orphan = { state: 'Draft', version: '1.0.0', downloadedAt: null };
  expect(compareDefinitionPrecedence(challenger, orphan)).toBeGreaterThan(0);
});

test('null state and null version are treated as the weakest tier', () => {
  const known = { state: 'Draft', version: '0.0.1', downloadedAt: null };
  const unknown = { state: null, version: null, downloadedAt: null };
  expect(compareDefinitionPrecedence(known, unknown)).toBeGreaterThan(0);
});
