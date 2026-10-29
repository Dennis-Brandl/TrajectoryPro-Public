// @vitest-environment jsdom
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
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider,
} from '@tanstack/react-router';
import { ErrorPane } from './ErrorPane';

afterEach(cleanup);

function routerThatThrows() {
  const rootRoute = createRootRoute();
  const boom = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => { throw new Error('kaboom: internal detail'); },
  });
  return createRouter({
    routeTree: rootRoute.addChildren([boom]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    defaultErrorComponent: ErrorPane,
  });
}

describe('ErrorPane', () => {
  it('renders instead of blanking when a route component throws', async () => {
    // React logs caught render errors; silence it so the suite output stays readable.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<RouterProvider router={routerThatThrows() as never} />);
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    spy.mockRestore();
  });

  it('does not leak the thrown error message to the operator', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<RouterProvider router={routerThatThrows() as never} />);
    await screen.findByText('Something went wrong');
    expect(screen.queryByText(/kaboom/)).toBeNull();
    expect(screen.queryByText(/internal detail/)).toBeNull();
    spy.mockRestore();
  });

  it('calls reset when Try again is pressed', async () => {
    const reset = vi.fn();
    render(<ErrorPane error={new Error('x')} reset={reset} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
