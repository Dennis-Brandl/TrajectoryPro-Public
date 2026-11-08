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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isRedirect } from '@tanstack/react-router';

vi.mock('@/lib/api/work-centers', () => ({ workCenters: { list: vi.fn() } }));

import { workCenters } from '@/lib/api/work-centers';

const node = (id: string, name: string) => ({ id, name }) as never;
type Loader = (ctx: { params: { wcId: string } }) => Promise<{ name: string }>;

// The cache lives in the route module: a fresh module per test starts with no cached list.
async function freshLoader(): Promise<Loader> {
  vi.resetModules();
  const { Route } = await import('./wc.$wcId');
  return Route.options.loader as unknown as Loader;
}

beforeEach(() => { vi.mocked(workCenters.list).mockReset(); });

describe('work-center loader', () => {
  it('loads the work center name', async () => {
    const loader = await freshLoader();
    vi.mocked(workCenters.list).mockResolvedValue({ nodes: [node('a', 'Alpha')] });
    await expect(loader({ params: { wcId: 'a' } })).resolves.toEqual({ name: 'Alpha' });
  });

  it('keeps the last list when the connection is lost (no error screen)', async () => {
    const loader = await freshLoader();
    vi.mocked(workCenters.list).mockResolvedValue({ nodes: [node('a', 'Alpha')] });
    await loader({ params: { wcId: 'a' } });
    vi.mocked(workCenters.list).mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(loader({ params: { wcId: 'a' } })).resolves.toEqual({ name: 'Alpha' });
  });

  it('does not wait on the network once the work center is cached', async () => {
    const loader = await freshLoader();
    vi.mocked(workCenters.list).mockResolvedValue({ nodes: [node('a', 'Alpha')] });
    await loader({ params: { wcId: 'a' } });
    vi.mocked(workCenters.list).mockReturnValue(new Promise(() => {}));
    await expect(loader({ params: { wcId: 'a' } })).resolves.toEqual({ name: 'Alpha' });
  });

  it('fails when there is no cached list at all', async () => {
    const loader = await freshLoader();
    vi.mocked(workCenters.list).mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(loader({ params: { wcId: 'a' } })).rejects.toBeInstanceOf(TypeError);
  });

  it('returns to the picker for an unknown work center', async () => {
    const loader = await freshLoader();
    vi.mocked(workCenters.list).mockResolvedValue({ nodes: [node('a', 'Alpha')] });
    let thrown: unknown;
    try { await loader({ params: { wcId: 'zz' } }); } catch (e) { thrown = e; }
    expect(isRedirect(thrown)).toBe(true);
  });
});
