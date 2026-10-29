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
import { workCenterDir, assignFilenames } from './wfcenter-format.js';

test('workCenterDir escapes each segment so a name containing a slash cannot forge nesting', () => {
  // "Fill/Cap" as ONE work center must not produce the same directory as
  // "Cap" nested under "Fill" — the exact collision escapeSegment exists to prevent.
  expect(workCenterDir(['Line', 'Fill/Cap'])).toBe('Line/Fill%2FCap');
  expect(workCenterDir(['Line', 'Fill', 'Cap'])).toBe('Line/Fill/Cap');
  expect(workCenterDir(['Line', 'Fill/Cap'])).not.toBe(workCenterDir(['Line', 'Fill', 'Cap']));
});

test('workCenterDir escapes percent before slash so an authored %2F cannot collide', () => {
  expect(workCenterDir(['a%2Fb'])).toBe('a%252Fb');
  expect(workCenterDir(['a/b'])).toBe('a%2Fb');
  expect(workCenterDir(['a%2Fb'])).not.toBe(workCenterDir(['a/b']));
});

test('assignFilenames builds a readable name per entry', () => {
  const names = assignFilenames(
    [{ oid: 'o1', name: 'Mix', version: '1.0.0', state: 'Effective' }], '.WFmaster',
  );
  expect(names).toEqual(['Mix-1.0.0-Effective.WFmaster']);
});

// (name, version, state) is NOT unique — two different Designer specs can share a local_id,
// and the business key includes oid. Without suffixing, one would silently overwrite the other.
test('assignFilenames suffixes collisions instead of overwriting', () => {
  const names = assignFilenames([
    { oid: 'b', name: 'Mix', version: '1.0.0', state: 'Effective' },
    { oid: 'a', name: 'Mix', version: '1.0.0', state: 'Effective' },
  ], '.WFmaster');
  expect(new Set(names).size).toBe(2);
  // Suffixes are assigned walking entries in oid order, so 'a' takes the unsuffixed name regardless of
  // the order the rows arrived in. Output must be reproducible across runs.
  expect(names[1]).toBe('Mix-1.0.0-Effective.WFmaster');
  expect(names[0]).toBe('Mix-1.0.0-Effective-2.WFmaster');
});

test('assignFilenames returns names positionally aligned with its input', () => {
  const names = assignFilenames([
    { oid: 'o1', name: 'A', version: '1', state: 'Draft' },
    { oid: 'o2', name: 'B', version: '1', state: 'Draft' },
  ], '.WFenvir');
  expect(names).toEqual(['A-1-Draft.WFenvir', 'B-1-Draft.WFenvir']);
});

test('assignFilenames escapes a name containing a slash', () => {
  const names = assignFilenames(
    [{ oid: 'o1', name: 'Fill/Cap', version: '1.0.0', state: 'Draft' }], '.WFmaster',
  );
  expect(names).toEqual(['Fill%2FCap-1.0.0-Draft.WFmaster']);
});

// Important 1 — a child work center literally named '..' must not produce a '..' path
// segment: a permissive extractor resolves 'workflows/Line/../Mix...WFmaster' OUTSIDE the
// extraction directory. escapeSegment alone does not neutralise this — '.' and '..' contain
// neither '%' nor '/' — so workCenterDir needs its own traversal guard.
test('workCenterDir neutralises a ".." segment so it cannot escape the extraction directory', () => {
  const dir = workCenterDir(['Line', '..']);
  expect(dir.split('/')).not.toContain('..');
  expect(dir).toBe('Line/%2E%2E');
});

test('workCenterDir neutralises a "." segment', () => {
  const dir = workCenterDir(['Line', '.']);
  expect(dir.split('/')).not.toContain('.');
  expect(dir).toBe('Line/%2E');
});

// Minor 5 — lenient Windows zip tools treat '\' as a path separator, so an unescaped
// backslash in a work-center name can extract as nested directories.
test('workCenterDir neutralises a backslash so no lenient extractor treats it as a separator', () => {
  const dir = workCenterDir(['Line', 'a\\b']);
  expect(dir).not.toContain('\\');
  expect(dir).toBe('Line/a%5Cb');
});

test('assignFilenames neutralises "..", ".", and backslash the same way workCenterDir does', () => {
  const names = assignFilenames(
    [{ oid: 'o1', name: '..', version: '.', state: 'a\\b' }], '.WFmaster',
  );
  expect(names[0]).not.toMatch(/(^|[-/])\.\.($|[-.])/);
  expect(names[0]).not.toContain('\\');
  expect(names).toEqual(['%2E%2E-%2E-a%5Cb.WFmaster']);
});

// The injectivity property workCenterDir already relied on must still hold once the
// traversal/backslash guard is folded in.
test('workCenterDir injectivity still holds after the traversal/backslash guard', () => {
  expect(workCenterDir(['Line', 'Fill/Cap'])).not.toBe(workCenterDir(['Line', 'Fill', 'Cap']));
});
