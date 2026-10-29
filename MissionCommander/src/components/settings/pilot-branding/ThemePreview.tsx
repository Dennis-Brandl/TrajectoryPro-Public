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

// Spec 2026-10-09 §9: a mini Pilot for one mode, drawn from effectiveColors — the same values
// the theme CSS writes into the Pilot's tokens. Static spans, not controls.
// The logo (dark mode: the dark logo when there is one) sits on the header background, as in the Pilot.
import type { CSSProperties } from 'react';
import {
  effectiveColors, fontStack, DENSITIES, RADII, MODE_LABELS, type ResolvedTheme, type ThemeMode,
} from 'mission-control-db/src/dao/pilot-theme';
import { brandAssetUrl } from '@/lib/api/brand-assets';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

export function ThemePreview({ theme, mode }: { theme: ResolvedTheme; mode: ThemeMode }) {
  const c = effectiveColors(theme, mode);
  const logo = mode === 'dark' ? (theme.logoDark ?? theme.logo) : theme.logo;
  const k = DENSITIES[theme.density];
  const radius = RADII[theme.radius];
  const pad = (rem: number) => `${rem * k}rem`;
  const button = (bg: string, fg: string, border: string): CSSProperties => ({
    display: 'inline-block', background: bg, color: fg, border: `1px solid ${border}`, borderRadius: radius,
    padding: `${pad(0.375)} ${pad(0.75)}`, fontWeight: 600,
  });
  return (
    <section
      aria-label={`${MODE_LABELS[mode]} preview`}
      style={{ fontFamily: fontStack(theme.font), background: c.surface, color: c.text, border: `1px solid ${c.border}`, borderRadius: radius, overflow: 'hidden' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: c.headerBg, color: c.headerFg, padding: `${pad(0.5)} ${pad(0.75)}` }}>
        {logo && <img src={brandAssetUrl(logo.id)} alt={logo.alt} style={{ height: '2rem', width: 'auto' }} />}
        <strong>{theme.appTitle}</strong>
        <span style={{ display: 'flex', flexDirection: 'column', borderLeft: `4px solid ${c.wcAccent}`, paddingLeft: '0.5rem' }}>
          <span style={{ color: c.headerFgMuted, fontSize: '0.7rem', letterSpacing: '0.05em' }}>WORK CENTER</span>
          <span>Line 3</span>
        </span>
        <span style={{ fontFamily: MONO, marginLeft: 'auto' }}>ABC-20261009-0001</span>
      </div>
      <div style={{ display: 'flex', borderBottom: `1px solid ${c.border}`, padding: `0 ${pad(0.75)}` }}>
        <span style={{ borderBottom: `3px solid ${c.accent}`, padding: pad(0.5), fontWeight: 600 }}>Inbox (2)</span>
        <span style={{ color: c.textMuted, padding: pad(0.5) }}>Workflows</span>
      </div>
      <div style={{ display: 'grid', gap: pad(0.5), padding: pad(0.75) }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', background: c.surfaceRaised, border: `1px solid ${c.border}`, borderRadius: radius, padding: pad(0.5) }}>
          <span>
            <strong>Fill Details</strong>
            <br />
            <span style={{ color: c.textMuted }}>Batch Workflow v1.0.0</span>
          </span>
          <span style={button(c.accent, c.accentFg, c.accent)}>Claim</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <span style={button(c.accent, c.accentFg, c.accent)}>Submit</span>
          <span style={button(c.surfaceRaised, c.text, c.borderStrong)}>Release</span>
          <span style={{ ...button(c.surfaceRaised, c.text, c.borderStrong), outline: `2px solid ${c.focus}`, outlineOffset: '2px' }}>Focused</span>
        </div>
        <span style={{ width: 'fit-content', background: c.surfaceRaised, border: `2px solid ${c.borderStrong}`, borderRadius: radius, padding: `${pad(0.375)} ${pad(0.75)}` }}>
          Fill Details
        </span>
      </div>
    </section>
  );
}
