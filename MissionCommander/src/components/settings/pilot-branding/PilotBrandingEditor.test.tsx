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
import * as systemSettingsApi from '@/lib/api/system-settings';
import * as brandApi from '@/lib/api/brand-assets';
import { PilotBrandingEditor } from './PilotBrandingEditor';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const STORED = {
  actionMatching: 'loose' as const, actionServerTrust: 'strict' as const, actionServerAllowlist: [],
  pilotTheme: { rev: 3, site: { schema: 1 as const, appTitle: 'Acme Pilot' } },
};

function setAdmin() {
  usePrincipalStore.getState().setPrincipal({
    id: 'a', email: '', loginName: 'admin', displayName: 'A', accessLevel: 'administrator', isAdministrator: true,
    rights: [], missionSystemCommanderOf: [],
  });
}
function setSteward() {
  usePrincipalStore.getState().setPrincipal({
    id: 's', email: '', loginName: 'admin', displayName: 'S', accessLevel: 'steward', isAdministrator: false,
    rights: ['settings:read', 'settings:edit'], missionSystemCommanderOf: [],
  });
}

beforeEach(() => {
  setAdmin();
  vi.spyOn(systemSettingsApi.systemSettings, 'get').mockResolvedValue(STORED);
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

async function renderLoaded() {
  render(<PilotBrandingEditor />);
  await waitFor(() => expect(screen.getByLabelText('App title')).toHaveValue('Acme Pilot'));
}
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => screen.getByRole('button', { name: 'Save Pilot branding' });
const claim = (mode: 'Light' | 'Dark') => within(screen.getByRole('region', { name: `${mode} preview` })).getByText('Claim');

describe('PilotBrandingEditor (spec 2026-10-09 §9)', () => {
  it('loads the site theme; a set field says site, an unset one says default', async () => {
    await renderLoaded();
    expect(screen.getByRole('region', { name: 'Pilot branding' })).toBeInTheDocument();
    expect(screen.getByLabelText('App title')).toHaveAccessibleDescription('site');
    expect(screen.getByLabelText('Light Brand')).toHaveAccessibleDescription('default');
    expect(screen.getByLabelText('Font')).toHaveAccessibleDescription('default');
    expect(save()).toBeEnabled();
  });

  it('each font option is shown in its own face', async () => {
    await renderLoaded();
    const lato = within(screen.getByLabelText('Font')).getByRole('option', { name: 'Lato' }) as HTMLOptionElement;
    expect(lato.style.fontFamily).toContain('Lato');
  });

  it('a brand colour updates the light preview at once; its foreground turns automatic; dark is untouched', async () => {
    await renderLoaded();
    change('Light Brand', '#facc15');
    expect(claim('Light')).toHaveStyle({ backgroundColor: '#facc15', color: '#0b1220' });
    expect(screen.getByLabelText('Light Brand')).toHaveAccessibleDescription('site');
    expect(screen.getByLabelText('Light Text on accent')).toHaveAccessibleDescription('automatic for contrast');
    expect(claim('Dark')).toHaveStyle({ backgroundColor: '#60a5fa' });
  });

  it('an unreadable pair lists its failure and disables Save; clearing it re-enables Save', async () => {
    await renderLoaded();
    change('Light Text', '#9ca3af');
    expect(screen.getByRole('alert')).toHaveTextContent('Light mode: Text on Page background is ');
    expect(save()).toBeDisabled();
    change('Light Text', '');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(save()).toBeEnabled();
  });

  it('a dark-only failure blocks too, and names Dark mode', async () => {
    await renderLoaded();
    change('Dark Text', '#1f2937');
    expect(screen.getByRole('alert')).toHaveTextContent('Dark mode: Text on Page background is ');
    expect(save()).toBeDisabled();
  });

  it('a half-typed colour marks the field, keeps the preview and disables Save', async () => {
    await renderLoaded();
    change('Light Brand', '#7c3');
    expect(screen.getByLabelText('Light Brand')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Use #rrggbb')).toBeInTheDocument();
    expect(claim('Light')).toHaveStyle({ backgroundColor: '#1d4ed8' });
    expect(save()).toBeDisabled();
    change('Light Brand', '#7c3aed');
    expect(save()).toBeEnabled();
  });

  it('an over-long title is refused and disables Save', async () => {
    await renderLoaded();
    change('App title', 'x'.repeat(41));
    expect(screen.getByLabelText('App title')).toHaveAttribute('aria-invalid', 'true');
    expect(save()).toBeDisabled();
  });

  it('Reset puts one field back to default, and Save then stores no colour at all', async () => {
    const update = vi.spyOn(systemSettingsApi.systemSettings, 'update').mockResolvedValue(STORED);
    await renderLoaded();
    change('Light Brand', '#7c3aed');
    fireEvent.click(screen.getByRole('button', { name: 'Reset Light Brand' }));
    expect(screen.getByLabelText('Light Brand')).toHaveValue('');
    expect(screen.getByLabelText('Light Brand')).toHaveAccessibleDescription('default');
    fireEvent.click(save());
    await waitFor(() => expect(update).toHaveBeenCalledWith({ pilotTheme: { schema: 1, appTitle: 'Acme Pilot' } }));
  });

  it('Save sends the draft, shows the stored result and toasts', async () => {
    const update = vi.spyOn(systemSettingsApi.systemSettings, 'update').mockResolvedValue({
      ...STORED, pilotTheme: { rev: 4, site: { schema: 1, appTitle: 'Line 3 Pilot', font: 'lato' } },
    });
    await renderLoaded();
    change('App title', 'Line 3 Pilot');
    change('Font', 'lato');
    fireEvent.click(save());
    await waitFor(() => expect(update).toHaveBeenCalledWith({ pilotTheme: { schema: 1, appTitle: 'Line 3 Pilot', font: 'lato' } }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Pilot branding saved'));
    expect(screen.getByLabelText('Font')).toHaveValue('lato');
  });

  it('Reset all to defaults clears every field', async () => {
    const update = vi.spyOn(systemSettingsApi.systemSettings, 'update').mockResolvedValue(STORED);
    await renderLoaded();
    change('Light Brand', '#7c3aed');
    fireEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
    expect(screen.getByLabelText('App title')).toHaveValue('');
    expect(screen.getByLabelText('Light Brand')).toHaveValue('');
    fireEvent.click(save());
    await waitFor(() => expect(update).toHaveBeenCalledWith({ pilotTheme: { schema: 1 } }));
  });

  it('a brand that resembles a status colour warns but does not block', async () => {
    await renderLoaded();
    change('Light Brand', '#c81e1e');
    expect(screen.getByRole('list', { name: 'Warnings' })).toHaveTextContent('Light mode: Brand resembles a status colour (alarm)');
    expect(save()).toBeEnabled();
  });

  it('a refused save shows an error toast and keeps the draft', async () => {
    vi.spyOn(systemSettingsApi.systemSettings, 'update').mockRejectedValue(new Error('boom'));
    await renderLoaded();
    change('App title', 'Line 3 Pilot');
    fireEvent.click(save());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to save Pilot branding'));
    expect(screen.getByLabelText('App title')).toHaveValue('Line 3 Pilot');
  });

  it('a non-administrator sees it read-only', async () => {
    setSteward();
    await renderLoaded();
    expect(screen.getByText('Requires an administrator')).toBeInTheDocument();
    expect(screen.getByLabelText('App title')).toBeDisabled();
    expect(screen.getByLabelText('Light Brand')).toBeDisabled();
    expect(save()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset all to defaults' })).toBeDisabled();
  });

  // Live smoke 2026-10-11: with two equal columns the colour table (~540px) overflowed its
  // half and the Dark column's provenance ran under the previews at every width. The form
  // column now takes its natural width and the previews the rest, side by side from xl
  // (1280px) up and stacked below that — measured in a real browser, pinned here by class.
  it('the form column is sized to its content, so the colour table never runs under the previews', async () => {
    await renderLoaded();
    const section = screen.getByRole('region', { name: 'Pilot branding' });
    const grid = section.querySelector('.grid.gap-6')!;
    expect(grid.className).toContain('xl:grid-cols-[auto_minmax(18rem,1fr)]');
    expect(grid.className).not.toContain('lg:grid-cols-');
    expect(section.className).toContain('max-w-6xl');
  });

  it('after a save, lists the work centers whose own override the change broke', async () => {
    vi.spyOn(systemSettingsApi.systemSettings, 'update').mockResolvedValue({
      ...STORED,
      pilotThemeBrokenWorkCenters: [{ id: 'c', name: 'Plant / Line 3 / Cell A', failures: ['Light mode: Text on accent on Accent is 3.18:1 — needs 4.5:1'] }],
    });
    await renderLoaded();
    change('Light Brand', '#d97706');
    fireEvent.click(save());
    const report = await screen.findByRole('region', { name: 'Work centers needing attention' });
    expect(report).toHaveTextContent('Plant / Line 3 / Cell A: Light mode: Text on accent on Accent is 3.18:1 — needs 4.5:1');
  });

  it('does not fetch at all for a user without settings:read', async () => {
    usePrincipalStore.getState().setPrincipal({
      id: 'o', email: '', loginName: 'admin', displayName: 'O', accessLevel: 'operator', isAdministrator: false, rights: [], missionSystemCommanderOf: [],
    });
    const get = vi.spyOn(systemSettingsApi.systemSettings, 'get');
    render(<PilotBrandingEditor />);
    expect(screen.queryByRole('region', { name: 'Pilot branding' })).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('PilotBrandingEditor — logos (spec 2026-10-09 §9, §12; P2b entry condition)', () => {
  const A = `sha256:${'a'.repeat(64)}`;
  const B = `sha256:${'b'.repeat(64)}`;
  const LOGO = { id: A, mime: 'image/svg+xml' as const, alt: 'Acme' };
  const WITH_LOGO = { ...STORED, pilotTheme: { rev: 3, site: { schema: 1 as const, appTitle: 'Acme Pilot', logo: LOGO } } };

  it('shows the stored site logo — thumbnail, description, provenance — and Save re-sends it unchanged', async () => {
    vi.spyOn(systemSettingsApi.systemSettings, 'get').mockResolvedValue(WITH_LOGO);
    const update = vi.spyOn(systemSettingsApi.systemSettings, 'update').mockResolvedValue(WITH_LOGO);
    await renderLoaded();
    expect(screen.getByLabelText('Upload logo')).toHaveAccessibleDescription('site');
    expect(screen.getByLabelText('Logo description')).toHaveValue('Acme');
    expect(within(screen.getByRole('region', { name: 'Light preview' })).getByRole('img', { name: 'Acme' }))
      .toHaveAttribute('src', `/api/brand/${A}`);
    expect(screen.getByLabelText('Upload dark logo')).toHaveAccessibleDescription('default');
    expect(screen.queryByRole('button', { name: 'Use the Mission Pilot mark' })).toBeNull();
    fireEvent.click(save());
    await waitFor(() => expect(update).toHaveBeenCalledWith({ pilotTheme: { schema: 1, appTitle: 'Acme Pilot', logo: LOGO } }));
  });

  it('Reset Logo drops it from what Save sends', async () => {
    vi.spyOn(systemSettingsApi.systemSettings, 'get').mockResolvedValue(WITH_LOGO);
    const update = vi.spyOn(systemSettingsApi.systemSettings, 'update').mockResolvedValue(STORED);
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Reset Logo' }));
    expect(screen.getByLabelText('Upload logo')).toHaveAccessibleDescription('default');
    fireEvent.click(save());
    await waitFor(() => expect(update).toHaveBeenCalledWith({ pilotTheme: { schema: 1, appTitle: 'Acme Pilot' } }));
  });

  it('an uploaded dark logo reaches only the dark preview', async () => {
    vi.spyOn(systemSettingsApi.systemSettings, 'get').mockResolvedValue(WITH_LOGO);
    vi.spyOn(brandApi.brandAssets, 'upload').mockResolvedValue({ id: B, mime: 'image/png', width: 1, height: 1 });
    await renderLoaded();
    fireEvent.change(screen.getByLabelText('Upload dark logo'), {
      target: { files: [new File(['x'], 'dark.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(screen.getByRole('region', { name: 'Dark preview' }).querySelector('img'))
      .toHaveAttribute('src', `/api/brand/${B}`));
    expect(screen.getByRole('region', { name: 'Light preview' }).querySelector('img')).toHaveAttribute('src', `/api/brand/${A}`);
    expect(screen.getByLabelText('Upload dark logo')).toHaveAccessibleDescription('site');
  });
});
