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
// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { RUNTIME_CAN } from '@/lib/runtime-status';
import { useNow } from '@/lib/hooks/useNow';
import pkg from '../package.json';

it('resolves Commander code through @', () => { expect(RUNTIME_CAN.pause.has('running')).toBe(true); });
// A Commander hook running under XO's React: fails with "Invalid hook call" if React loads twice.
it('shares one React with Commander code', () => { expect(typeof renderHook(() => useNow(1000)).result.current).toBe('number'); });
// XO's own package.json version, not Commander's (which the shared code would otherwise suggest).
it('has its own version', () => { expect(__APP_VERSION__).toBe(pkg.version); });
