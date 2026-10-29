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
// Spec 2026-10-09 §9/§12: one logo slot of the Pilot theme — the logo or the dark-mode logo.
// Upload (the server checks and cleans the file and answers with its content-hash id), a
// description for screen readers, a reset to inherit, and the field's provenance. A
// work-center layer can also choose the shipped Mission Pilot mark (`logo: false`).
import { useState } from 'react';
import { toast } from 'sonner';
import type { ThemeLogo } from 'mission-control-db/src/dao/pilot-theme';
import { brandAssets, brandAssetUrl } from '@/lib/api/brand-assets';
import { apiErrorMessage } from '@/lib/api/client';
import type { Provenance } from './theme-draft';

export interface LogoFieldProps {
  id: string;
  /** 'Logo' or 'Dark logo'. */
  label: string;
  /** The draft's value; null = inherit. */
  value: ThemeLogo | false | null;
  /** What applies when this layer sets nothing. */
  inherited: ThemeLogo | null;
  /** Shown when nothing applies: 'Mission Pilot mark' or 'Same as the logo'. */
  noneText: string;
  provenance: Provenance;
  disabled: boolean;
  /** Offer "Use the Mission Pilot mark" — a work-center layer's light logo only. */
  allowMark: boolean;
  onChange(value: ThemeLogo | false | null): void;
}

const BUTTON = 'cursor-pointer rounded border px-2 py-1 text-sm focus-within:ring-2 focus-within:ring-ring';

export function LogoField(p: LogoFieldProps) {
  const [uploading, setUploading] = useState(false);
  const shown = p.value === false ? null : (p.value ?? p.inherited);
  const name = p.label.toLowerCase();

  const upload = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const a = await brandAssets.upload(file);
      p.onChange({ id: a.id, mime: a.mime, alt: p.value ? p.value.alt : '' });
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Logo upload failed'));
    } finally {
      setUploading(false);
      input.value = '';
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {shown
        ? <img src={brandAssetUrl(shown.id)} alt="" className="h-8 w-auto max-w-40 rounded border bg-muted object-contain" />
        : <span className="text-sm text-muted-foreground">{p.value === false ? 'Mission Pilot mark' : p.noneText}</span>}
      <label className={`${BUTTON} ${p.disabled || uploading ? 'pointer-events-none opacity-60' : ''}`}>
        {uploading ? 'Uploading…' : 'Upload…'}
        <input
          id={p.id}
          type="file"
          accept="image/png,image/svg+xml"
          aria-label={`Upload ${name}`}
          aria-describedby={`${p.id}-provenance`}
          disabled={p.disabled || uploading}
          className="sr-only"
          onChange={(e) => void upload(e.currentTarget)}
        />
      </label>
      {p.value && (
        <input
          aria-label={`${p.label} description`}
          value={p.value.alt}
          maxLength={200}
          placeholder="Describe the logo"
          disabled={p.disabled}
          onChange={(e) => p.value && p.onChange({ ...p.value, alt: e.target.value.replace(/\p{Cc}/gu, '') })}
          className="w-48 rounded border bg-background px-2 py-1 text-sm disabled:opacity-60"
        />
      )}
      {p.allowMark && p.value !== false && !p.disabled && (
        <button type="button" className="text-xs underline" onClick={() => p.onChange(false)}>
          Use the Mission Pilot mark
        </button>
      )}
      {p.value !== null && !p.disabled && (
        <button
          type="button"
          aria-label={`Reset ${p.label}`}
          title="Reset to inherit"
          className="rounded px-1 text-muted-foreground hover:text-foreground"
          onClick={() => p.onChange(null)}
        >
          ↺
        </button>
      )}
      <span id={`${p.id}-provenance`} className="text-xs text-muted-foreground">{p.provenance}</span>
    </div>
  );
}
