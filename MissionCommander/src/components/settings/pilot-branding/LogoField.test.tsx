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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { toast } from 'sonner';
import type { ThemeLogo } from 'mission-control-db/src/dao/pilot-theme';
import * as brandApi from '@/lib/api/brand-assets';
import { ApiError } from '@/lib/api/client';
import { LogoField, type LogoFieldProps } from './LogoField';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

const A: ThemeLogo = { id: `sha256:${'a'.repeat(64)}`, mime: 'image/svg+xml', alt: 'Acme' };
const B = `sha256:${'b'.repeat(64)}`;

function renderField(over: Partial<LogoFieldProps> = {}) {
  const onChange = vi.fn();
  render(
    <LogoField
      id="t-logo" label="Logo" value={null} inherited={null} noneText="Mission Pilot mark"
      provenance="default" disabled={false} allowMark={false} onChange={onChange} {...over}
    />,
  );
  return onChange;
}
const pick = (file: File) => fireEvent.change(screen.getByLabelText('Upload logo'), { target: { files: [file] } });
const svgFile = () => new File(['<svg/>'], 'acme.svg', { type: 'image/svg+xml' });

describe('LogoField (spec 2026-10-09 §9, §12)', () => {
  it('nothing set and nothing inherited: names the shipped mark; no description, no reset', () => {
    renderField();
    expect(screen.getByText('Mission Pilot mark')).toBeInTheDocument();
    expect(screen.getByLabelText('Upload logo')).toHaveAccessibleDescription('default');
    expect(screen.queryByLabelText('Logo description')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset Logo' })).toBeNull();
  });

  it('an inherited logo shows as a thumbnail with the inherited provenance', () => {
    renderField({ inherited: A, provenance: 'site' });
    expect(document.querySelector('img')).toHaveAttribute('src', `/api/brand/${A.id}`);
    expect(screen.getByLabelText('Upload logo')).toHaveAccessibleDescription('site');
    expect(screen.queryByLabelText('Logo description')).toBeNull();
  });

  it('uploading sends the file and sets the logo, keeping the description', async () => {
    const upload = vi.spyOn(brandApi.brandAssets, 'upload').mockResolvedValue({ id: B, mime: 'image/png', width: 1, height: 1 });
    const onChange = renderField({ value: A, provenance: 'site' });
    const file = svgFile();
    pick(file);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ id: B, mime: 'image/png', alt: 'Acme' }));
    expect(upload).toHaveBeenCalledWith(file);
  });

  it('a refused upload shows the server\'s reason and changes nothing', async () => {
    vi.spyOn(brandApi.brandAssets, 'upload')
      .mockRejectedValue(new ApiError(422, 'validation', 'This SVG contains scripts or external references.'));
    const onChange = renderField();
    pick(svgFile());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This SVG contains scripts or external references.'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the description edits the alt text only; control characters are dropped', () => {
    const onChange = renderField({ value: A, provenance: 'site' });
    fireEvent.change(screen.getByLabelText('Logo description'), { target: { value: 'Acme\tCorp' } });
    expect(onChange).toHaveBeenCalledWith({ ...A, alt: 'AcmeCorp' });
  });

  it('reset inherits; "Use the Mission Pilot mark" sets false and then names the mark', () => {
    const onChange = renderField({ value: A, provenance: 'this work center', allowMark: true });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Logo' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'Use the Mission Pilot mark' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    cleanup();
    renderField({ value: false, inherited: A, provenance: 'this work center', allowMark: true });
    expect(screen.getByText('Mission Pilot mark')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use the Mission Pilot mark' })).toBeNull();
  });

  it('read-only: the upload is disabled and there is no reset or mark button', () => {
    renderField({ value: A, disabled: true, allowMark: true });
    expect(screen.getByLabelText('Upload logo')).toBeDisabled();
    expect(screen.getByLabelText('Logo description')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Reset Logo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use the Mission Pilot mark' })).toBeNull();
  });
});
