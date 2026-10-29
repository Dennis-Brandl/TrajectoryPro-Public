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

// Spec 2026-10-09 §9: pure helpers behind Commander's Pilot branding editor. The draft is one
// stored layer (PilotTheme); "inherit" is an ABSENT key, so a field reset to default keeps
// following the shipped default (plan P2b Review Focus 4).
import type {
  PilotTheme, ResolvedTheme, ColorKey, ColorSet, ThemeMode, Density, Radius, DefaultMode,
} from 'mission-control-db/src/dao/pilot-theme';
import { HEX_RE } from 'mission-control-db/src/lib/color';

export type ScalarField = 'appTitle' | 'font' | 'density' | 'radius' | 'defaultMode' | 'wcAccent';
/** Spec §7: replaced whole; `false` (logo only) = explicitly no uploaded logo. */
export type LogoSlot = 'logo' | 'logoDark';

export const DENSITY_LABELS: Record<Density, string> = { compact: 'Compact', comfortable: 'Comfortable', touch: 'Touch' };
export const RADIUS_LABELS: Record<Radius, string> = { none: 'None', sm: 'Small', md: 'Medium', lg: 'Large' };
export const DEFAULT_MODE_LABELS: Record<DefaultMode, string> = { light: 'Light', dark: 'Dark', system: 'Follow the device' };

export function withField<K extends ScalarField | LogoSlot>(draft: PilotTheme, field: K, value: NonNullable<PilotTheme[K]> | null): PilotTheme {
  const next: PilotTheme = { ...draft };
  if (value === null) delete next[field];
  else next[field] = value;
  return next;
}

export function withColor(draft: PilotTheme, mode: ThemeMode, key: ColorKey, value: string | null): PilotTheme {
  const set: ColorSet = { ...(draft.colors?.[mode] ?? {}) };
  if (value === null) delete set[key];
  else set[key] = value.toLowerCase();
  const colors: NonNullable<PilotTheme['colors']> = { ...(draft.colors ?? {}) };
  if (Object.keys(set).length > 0) colors[mode] = set;
  else delete colors[mode];
  const next: PilotTheme = { ...draft };
  if (Object.keys(colors).length > 0) next.colors = colors;
  else delete next.colors;
  return next;
}

/** `default`, `site`, `inherited from <WC>`, `this work center` or `automatic for contrast`. */
export type Provenance = string;

/** A lower-precedence layer and how the editor names it (spec §9 provenance labels). */
export interface BaseLayer { label: string; theme: PilotTheme }

export function colorProvenance(
  draft: PilotTheme, resolved: ResolvedTheme, mode: ThemeMode, key: ColorKey,
  base: readonly BaseLayer[] = [], own = 'site',
): Provenance {
  if (draft.colors?.[mode]?.[key] != null) return own;
  if (resolved.auto[mode].includes(key)) return 'automatic for contrast';
  for (let i = base.length - 1; i >= 0; i--) {
    if (base[i]!.theme.colors?.[mode]?.[key] != null) return base[i]!.label;
  }
  return 'default';
}

export function fieldProvenance(draft: PilotTheme, field: ScalarField | LogoSlot, base: readonly BaseLayer[] = [], own = 'site'): Provenance {
  if (draft[field] != null) return own;
  for (let i = base.length - 1; i >= 0; i--) {
    if (base[i]!.theme[field] != null) return base[i]!.label;
  }
  return 'default';
}

/** A typed colour: '' = inherit; the '#' is optional; anything but #rrggbb is refused. */
export function parseHexInput(text: string): { ok: true; value: string | null } | { ok: false } {
  const t = text.trim();
  if (t === '') return { ok: true, value: null };
  const hex = t.startsWith('#') ? t : `#${t}`;
  return HEX_RE.test(hex) ? { ok: true, value: hex.toLowerCase() } : { ok: false };
}
