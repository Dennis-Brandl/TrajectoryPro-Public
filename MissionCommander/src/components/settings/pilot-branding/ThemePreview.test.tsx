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
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { resolveTheme } from 'mission-control-db/src/dao/pilot-theme';
import { ThemePreview } from './ThemePreview';
import { ContrastReport } from './ContrastReport';

afterEach(cleanup);

describe('ThemePreview (spec §9 live previews)', () => {
  it('the shipped light defaults: navy header, blue Claim with white text, Inter', () => {
    render(<ThemePreview theme={resolveTheme([])} mode="light" />);
    const preview = screen.getByRole('region', { name: 'Light preview' });
    expect(within(preview).getByText('Mission Pilot').parentElement).toHaveStyle({ backgroundColor: '#0f1b2d' });
    expect(within(preview).getByText('Claim')).toHaveStyle({ backgroundColor: '#1d4ed8', color: '#ffffff' });
    expect(preview.style.fontFamily).toContain('Inter');
  });

  it('dark mode uses the dark tokens', () => {
    render(<ThemePreview theme={resolveTheme([])} mode="dark" />);
    const preview = screen.getByRole('region', { name: 'Dark preview' });
    expect(within(preview).getByText('Mission Pilot').parentElement).toHaveStyle({ backgroundColor: '#070c16' });
    expect(within(preview).getByText('Claim')).toHaveStyle({ backgroundColor: '#60a5fa' });
  });

  it('follows the theme: title, brand, automatic foreground, font, radius, work-center accent', () => {
    const t = resolveTheme([{
      schema: 1, appTitle: 'Acme Pilot', font: 'lato', radius: 'lg', wcAccent: '#f59e0b',
      colors: { light: { brand: '#facc15' } },
    }]);
    render(<ThemePreview theme={t} mode="light" />);
    const preview = screen.getByRole('region', { name: 'Light preview' });
    expect(within(preview).getByText('Claim')).toHaveStyle({ backgroundColor: '#facc15', color: '#0b1220', borderRadius: '.75rem' });
    expect(within(preview).getByText('Acme Pilot')).toBeInTheDocument();
    expect(preview.style.fontFamily).toContain('Lato');
    expect(within(preview).getByText('Line 3').parentElement!.style.borderLeft).toContain('rgb(245, 158, 11)');
  });

  it('shows the logo on the header background; dark mode uses the dark logo when there is one', () => {
    const A = `sha256:${'a'.repeat(64)}`;
    const B = `sha256:${'b'.repeat(64)}`;
    const t = resolveTheme([{ schema: 1, logo: { id: A, mime: 'image/svg+xml', alt: 'Acme' }, logoDark: { id: B, mime: 'image/png', alt: 'Acme dark' } }]);
    render(<><ThemePreview theme={t} mode="light" /><ThemePreview theme={t} mode="dark" /></>);
    const light = within(screen.getByRole('region', { name: 'Light preview' })).getByRole('img', { name: 'Acme' });
    expect(light).toHaveAttribute('src', `/api/brand/${A}`);
    expect(light.parentElement).toHaveStyle({ backgroundColor: '#0f1b2d' });
    expect(within(screen.getByRole('region', { name: 'Dark preview' })).getByRole('img', { name: 'Acme dark' }))
      .toHaveAttribute('src', `/api/brand/${B}`);
  });

  it('no logo: no image in the preview', () => {
    render(<ThemePreview theme={resolveTheme([])} mode="light" />);
    expect(screen.getByRole('region', { name: 'Light preview' }).querySelector('img')).toBeNull();
  });
});

describe('ContrastReport (spec §9 contrast badges)', () => {
  it('one row per §11 pair per mode; the defaults all pass', () => {
    render(<ContrastReport theme={resolveTheme([])} />);
    for (const name of ['Light contrast', 'Dark contrast']) {
      const table = screen.getByRole('table', { name });
      expect(within(table).getAllByRole('row')).toHaveLength(12); // header + 11 pairs
      expect(within(table).queryByText('Fail')).toBeNull();
    }
  });

  it('a failing pair shows its ratio, the minimum and Fail', () => {
    render(<ContrastReport theme={resolveTheme([{ schema: 1, colors: { light: { text: '#9ca3af' } } }])} />);
    const row = within(screen.getByRole('table', { name: 'Light contrast' })).getByRole('row', { name: /^Text on Page background/ });
    expect(row).toHaveTextContent(/\d\.\d\d:1/);
    expect(row).toHaveTextContent('needs 4.5:1');
    expect(row).toHaveTextContent('Fail');
    expect(within(screen.getByRole('table', { name: 'Dark contrast' })).queryByText('Fail')).toBeNull();
  });
});
