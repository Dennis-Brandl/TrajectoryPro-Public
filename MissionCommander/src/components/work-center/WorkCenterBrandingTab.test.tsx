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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { toast } from 'sonner';
import { usePrincipalStore } from '@/stores/principalStore';
import * as wcApi from '@/lib/api/work-centers';
import type { WorkCenterThemeView } from '@/lib/api/types';
import { WorkCenterBrandingTab } from './WorkCenterBrandingTab';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const VIEW: WorkCenterThemeView = {
  rev: 5,
  site: { schema: 1, font: 'lato' },
  chain: [
    { id: 'plant', name: 'Plant', theme: { schema: 1 } },
    { id: 'line', name: 'Line 3', theme: { schema: 1, colors: { light: { brand: '#15803d' } } } },
    { id: 'cell', name: 'Cell A', theme: { schema: 1, appTitle: 'Cell A Pilot' } },
  ],
};

function principal(admin: boolean) {
  usePrincipalStore.getState().setPrincipal({
    id: 'u', email: '', loginName: 'admin', displayName: 'U', accessLevel: admin ? 'administrator' : 'steward', isAdministrator: admin,
    rights: admin ? [] : ['work_center:read', 'work_center:edit'], missionSystemCommanderOf: [],
  });
}

beforeEach(() => {
  principal(true);
  vi.spyOn(wcApi.workCenters, 'pilotTheme').mockResolvedValue(VIEW);
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

async function renderLoaded() {
  render(<WorkCenterBrandingTab workCenterId="cell" />);
  await waitFor(() => expect(screen.getByLabelText('App title')).toHaveValue('Cell A Pilot'));
}
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => screen.getByRole('button', { name: 'Save work-center branding' });

describe('WorkCenterBrandingTab (spec 2026-10-09 §9, R4)', () => {
  it('labels every field with where its value comes from, and shows inherited values', async () => {
    await renderLoaded();
    expect(screen.getByRole('region', { name: 'Work-center branding' })).toBeInTheDocument();
    expect(screen.getByLabelText('App title')).toHaveAccessibleDescription('this work center');
    expect(screen.getByLabelText('Light Brand')).toHaveAccessibleDescription('inherited from Line 3');
    expect(screen.getByLabelText('Light Brand')).toHaveAttribute('placeholder', '#15803d');
    expect(screen.getByLabelText('Light Brand')).toHaveValue('');
    expect(screen.getByLabelText('Font')).toHaveAccessibleDescription('site');
    expect(screen.getByLabelText('Density')).toHaveAccessibleDescription('default');
    expect(within(screen.getByLabelText('Font')).getAllByRole('option')[0]).toHaveTextContent('Inherited (Lato)');
    expect(within(screen.getByRole('region', { name: 'Light preview' })).getByText('Claim'))
      .toHaveStyle({ backgroundColor: '#15803d' });
  });

  it('Save sends only this work center\'s own layer', async () => {
    const set = vi.spyOn(wcApi.workCenters, 'setPilotTheme').mockResolvedValue({ ...VIEW, broken: [] });
    await renderLoaded();
    change('App title', 'Cell A');
    fireEvent.click(save());
    await waitFor(() => expect(set).toHaveBeenCalledWith('cell', { schema: 1, appTitle: 'Cell A' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Work-center branding saved'));
  });

  it('Clear all overrides then Save sends null, so everything is inherited again', async () => {
    const set = vi.spyOn(wcApi.workCenters, 'setPilotTheme').mockResolvedValue({ ...VIEW, broken: [] });
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all overrides' }));
    expect(screen.getByLabelText('App title')).toHaveValue('');
    expect(screen.getByLabelText('App title')).toHaveAttribute('placeholder', 'Mission Pilot');
    fireEvent.click(save());
    await waitFor(() => expect(set).toHaveBeenCalledWith('cell', null));
  });

  it('an override that fails merged with the layers beneath it blocks Save', async () => {
    await renderLoaded();
    change('Light Text', '#9ca3af');
    expect(screen.getByRole('alert')).toHaveTextContent('Light mode: Text on Page background is ');
    expect(save()).toBeDisabled();
  });

  it('lists descendants the save broke', async () => {
    vi.spyOn(wcApi.workCenters, 'setPilotTheme').mockResolvedValue({
      ...VIEW,
      broken: [{ id: 'st', name: 'Plant / Line 3 / Cell A / Station 1', failures: ['Light mode: Text on accent on Accent is 3.18:1 — needs 4.5:1'] }],
    });
    await renderLoaded();
    change('Light Brand', '#d97706');
    fireEvent.click(save());
    expect(await screen.findByRole('region', { name: 'Work centers needing attention' }))
      .toHaveTextContent('Plant / Line 3 / Cell A / Station 1: Light mode: Text on accent on Accent is 3.18:1 — needs 4.5:1');
  });

  it('a non-administrator sees it read-only', async () => {
    principal(false);
    await renderLoaded();
    expect(screen.getByText('Requires an administrator')).toBeInTheDocument();
    expect(screen.getByLabelText('App title')).toBeDisabled();
    expect(save()).toBeDisabled();
  });

  it('a load failure is shown', async () => {
    vi.spyOn(wcApi.workCenters, 'pilotTheme').mockRejectedValue(new Error('boom'));
    render(<WorkCenterBrandingTab workCenterId="cell" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load work-center branding');
  });

  it('a failure inherited from the layers beneath does not block Save; it is named, not blamed on this layer (final review)', async () => {
    vi.spyOn(wcApi.workCenters, 'pilotTheme').mockResolvedValue({
      ...VIEW,
      site: { schema: 1, colors: { light: { brand: '#d97706' } } },
      chain: [VIEW.chain[0]!, { id: 'line', name: 'Line 3', theme: { schema: 1, colors: { light: { accentFg: '#ffffff' } } } }, VIEW.chain[2]!],
    });
    const set = vi.spyOn(wcApi.workCenters, 'setPilotTheme').mockResolvedValue({ ...VIEW, broken: [] });
    await renderLoaded();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('region', { name: 'Inherited contrast problems' }))
      .toHaveTextContent('Light mode: Text on accent on Accent is 3.18:1 — needs 4.5:1');
    change('App title', 'Cell A');
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    await waitFor(() => expect(set).toHaveBeenCalledWith('cell', { schema: 1, appTitle: 'Cell A' }));
  });

  it('an inherited site logo shows as site; "Use the Mission Pilot mark" saves logo: false', async () => {
    const A = `sha256:${'a'.repeat(64)}`;
    vi.spyOn(wcApi.workCenters, 'pilotTheme')
      .mockResolvedValue({ ...VIEW, site: { ...VIEW.site, logo: { id: A, mime: 'image/png', alt: 'Acme' } } });
    const set = vi.spyOn(wcApi.workCenters, 'setPilotTheme').mockResolvedValue({ ...VIEW, broken: [] });
    await renderLoaded();
    expect(screen.getByLabelText('Upload logo')).toHaveAccessibleDescription('site');
    expect(screen.queryByLabelText('Logo description')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use the Mission Pilot mark' }));
    expect(screen.getByLabelText('Upload logo')).toHaveAccessibleDescription('this work center');
    expect(screen.getByRole('region', { name: 'Light preview' }).querySelector('img')).toBeNull();
    fireEvent.click(save());
    await waitFor(() => expect(set).toHaveBeenCalledWith('cell', { schema: 1, appTitle: 'Cell A Pilot', logo: false }));
  });

  it("the site's dark logo stops applying once this work center sets its own logo (final review ruling)", async () => {
    const A = `sha256:${'a'.repeat(64)}`;
    const B = `sha256:${'b'.repeat(64)}`;
    vi.spyOn(wcApi.workCenters, 'pilotTheme').mockResolvedValue({
      ...VIEW,
      site: { ...VIEW.site, logo: { id: A, mime: 'image/png', alt: 'Acme' }, logoDark: { id: B, mime: 'image/png', alt: 'Acme dark' } },
    });
    await renderLoaded();
    expect(screen.getByLabelText('Upload dark logo')).toHaveAccessibleDescription('site');
    fireEvent.click(screen.getByRole('button', { name: 'Use the Mission Pilot mark' }));
    expect(screen.getByLabelText('Upload dark logo')).toHaveAccessibleDescription('this work center');
    expect(screen.getByText('Same as the logo')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Dark preview' }).querySelector('img')).toBeNull();
  });
});
