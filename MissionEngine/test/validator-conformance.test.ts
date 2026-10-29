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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from '../src/spec/validator.js';

// Known reference failures (parity baseline — see src/conformance/PROVENANCE.md).
// These fixtures fail in the reference repo's own conformance runner.
// val-struct-002 (textInput without outputParameter) left this set 2026-08-10: the engine
// deliberately diverges from the reference by downgrading UNBOUND_FORM_INPUT to a warning,
// so the fixture's valid=true expectation now genuinely passes here (PROVENANCE.md).
const KNOWN_FAILURES = new Set<string>([]);

const dir = join(import.meta.dirname, '../src/conformance/fixtures/validation');
for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const testFn = KNOWN_FAILURES.has(file) ? test.skip : test;
  testFn(`validation fixture ${file}`, () => {
    const fixture = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const result = validate(fixture.workflow);
    expect(result.valid).toBe(fixture.expected.valid);
    if (fixture.expected.error_code) expect(result.error_code).toBe(fixture.expected.error_code);
  });
}
