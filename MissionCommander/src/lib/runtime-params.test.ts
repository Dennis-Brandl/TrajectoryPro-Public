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
import { describe, expect, it } from 'vitest';
import { initialParamValues, paramsForCreate } from './runtime-params';
import type { RuntimeParameterSpec } from '@/lib/api/types';

const spec = (id: string, defaultValue: string, valueType: 'literal' | 'property'): RuntimeParameterSpec =>
  ({ id, description: null, defaultValue, valueType });

describe('runtime-params', () => {
  it('prefills literal defaults only', () => {
    expect(initialParamValues([spec('a', '1', 'literal'), spec('b', 'x', 'property')])).toEqual({ a: '1' });
  });
  it('drops empty strings on create', () => {
    expect(paramsForCreate({ a: '1', b: '' })).toEqual({ a: '1' });
  });
});
