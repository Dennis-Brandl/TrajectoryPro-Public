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

// The theme module in mission-control-db mirrors tokens.css by hand. These tests pin the two
// together so an untouched theme renders exactly today's Pilot (plan P2a Review Focus 5).
import { describe, it, expect } from 'vitest'
import {
  resolveTheme, effectiveColors, themeCss, LAYER_ORDER as DB_LAYER_ORDER, STATUS_COLORS, fontStack, DENSITIES, RADII,
  type EffectiveColors,
} from 'mission-control-db/src/dao/pilot-theme'
import { LAYER_ORDER } from '../site-theme'
import { TOKENS_CSS, resolveColor, type Mode } from './token-resolver'

const TOKEN_OF: Record<keyof EffectiveColors, string> = {
  brand: '--pilot-brand', accent: '--pilot-accent', accentFg: '--pilot-accent-fg', surface: '--pilot-surface',
  surfaceRaised: '--pilot-surface-raised', text: '--pilot-text', textMuted: '--pilot-text-muted', border: '--pilot-border',
  headerBg: '--pilot-header-bg', headerFg: '--pilot-header-fg', focus: '--pilot-focus',
  headerFgMuted: '--pilot-header-fg-muted', borderStrong: '--pilot-border-strong', headerAccent: '--pilot-header-accent',
  wcAccent: '--pilot-wc-accent',
}

const declared = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(TOKENS_CSS.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1]?.trim()

describe('theme module ↔ tokens.css parity', () => {
  it('one layer-order statement everywhere', () => {
    const body = TOKENS_CSS.replace(/\/\*[\s\S]*?\*\//g, '').trim()
    expect(body.startsWith(LAYER_ORDER)).toBe(true)
    expect(DB_LAYER_ORDER).toBe(LAYER_ORDER)
    expect(themeCss(resolveTheme([])).startsWith(LAYER_ORDER)).toBe(true)
  })

  for (const mode of ['light', 'dark'] as Mode[]) {
    it(`${mode}: the empty theme's effective colours equal the shipped tokens`, () => {
      const eff = effectiveColors(resolveTheme([]), mode)
      for (const [key, token] of Object.entries(TOKEN_OF) as Array<[keyof EffectiveColors, string]>) {
        expect(eff[key], `${key} ↔ ${token}`).toBe(resolveColor(token, mode))
      }
    })

    it(`${mode}: the status colours a brand is compared with are the shipped ones`, () => {
      for (const [name, hex] of Object.entries(STATUS_COLORS[mode])) {
        expect(hex, name).toBe(resolveColor(`--pilot-${name}`, mode))
      }
    })
  }

  it('font, density and radius defaults are today\'s token values', () => {
    expect(declared('--pilot-font-family')).toBe(fontStack('inter'))
    expect(declared('--pilot-density-k')).toBe(String(DENSITIES.comfortable))
    expect(declared('--pilot-radius')).toBe(RADII.md)
  })
})
