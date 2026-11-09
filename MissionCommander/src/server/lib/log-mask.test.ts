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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { maskApiTokens, maskedLogPrint } from './log-mask';

const TOKEN = 'mcx_' + 'Ab-_9'.repeat(8) + 'xyz';

afterEach(() => vi.restoreAllMocks());

describe('maskApiTokens', () => {
  it('hides a token in a logged URL, whole', () => {
    const out = maskApiTokens(`<-- GET /api/external/v1/work-centers?token=${TOKEN}&x=1`);
    expect(out).toBe('<-- GET /api/external/v1/work-centers?token=mcx_***&x=1');
    expect(out).not.toContain('Ab-_9');
  });
  it('hides every token on a line and leaves other text alone', () => {
    expect(maskApiTokens(`${TOKEN} and ${TOKEN}`)).toBe('mcx_*** and mcx_***');
    expect(maskApiTokens('--> GET /api/health 200 2ms')).toBe('--> GET /api/health 200 2ms');
  });
});

describe('maskedLogPrint', () => {
  it('writes the masked line to the console', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    maskedLogPrint(`<-- GET /x?access_token=${TOKEN}`, `rest ${TOKEN}`);
    expect(log).toHaveBeenCalledWith('<-- GET /x?access_token=mcx_***', 'rest mcx_***');
  });
});
