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
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ThemeLogo } from 'mission-control-db'
import { BrandLogo, BrandLogoContext, brandUrl, type BrandLogos } from '../brand-logo'

afterEach(cleanup)

const A: ThemeLogo = { id: `sha256:${'a'.repeat(64)}`, mime: 'image/svg+xml', alt: 'Acme' }
const B: ThemeLogo = { id: `sha256:${'b'.repeat(64)}`, mime: 'image/png', alt: 'Acme dark' }

function show(logos: BrandLogos, decorative = false) {
  render(
    <BrandLogoContext.Provider value={logos}>
      <BrandLogo className="login-logo" fallbackClassName="login-splash" fallbackSrc="/splash.png" fallbackAlt="Mission Pilot" logoAlt="Acme Pilot" decorative={decorative} />
    </BrandLogoContext.Provider>,
  )
  return [...document.querySelectorAll('img')]
}

describe('BrandLogo (spec 2026-10-09 §12)', () => {
  it('no logo: the shipped image', () => {
    const [img, more] = show({ logo: null, logoDark: null })
    expect(more).toBeUndefined()
    expect(img?.getAttribute('src')).toBe('/splash.png')
    expect(img?.getAttribute('alt')).toBe('Mission Pilot')
    expect(img?.className.split(' ')).toEqual(expect.arrayContaining(['login-splash']))
  })

  it('a logo: served by the engine, its description as alt (the app title when it has none)', () => {
    const [img] = show({ logo: A, logoDark: null })
    expect(img?.getAttribute('src')).toBe(`/api/brand/${A.id}`)
    expect(img?.getAttribute('alt')).toBe('Acme')
    expect(img?.className.split(' ')).toEqual(expect.arrayContaining(['login-logo']))
    cleanup()
    expect(show({ logo: { ...A, alt: '' }, logoDark: null })[0]?.getAttribute('alt')).toBe('Acme Pilot')
  })

  it('a dark logo: both are rendered and the mode CSS picks one', () => {
    const [light, dark] = show({ logo: A, logoDark: B })
    expect(light?.className.split(' ')).toEqual(expect.arrayContaining(['login-logo', 'brand-when-light']))
    expect(dark?.className.split(' ')).toEqual(expect.arrayContaining(['login-logo', 'brand-when-dark']))
    expect(dark?.getAttribute('src')).toBe(`/api/brand/${B.id}`)
  })

  it('only a dark logo: the shipped image in light mode, the dark logo in dark mode', () => {
    const [light, dark] = show({ logo: null, logoDark: B })
    expect(light?.getAttribute('src')).toBe('/splash.png')
    expect(light?.className.split(' ')).toEqual(expect.arrayContaining(['login-splash', 'brand-when-light']))
    expect(dark?.getAttribute('src')).toBe(`/api/brand/${B.id}`)
  })

  it('a logo that fails to load falls back to the shipped image', () => {
    const [img] = show({ logo: A, logoDark: null })
    fireEvent.error(img!)
    const [after] = [...document.querySelectorAll('img')]
    expect(after?.getAttribute('src')).toBe('/splash.png')
    expect(after?.className.split(' ')).toEqual(expect.arrayContaining(['login-splash']))
  })

  it('decorative slots (the top bar, beside the title) never announce the logo', () => {
    expect(show({ logo: A, logoDark: null }, true)[0]?.getAttribute('alt')).toBe('')
  })

  it('brandUrl refuses anything but a content-hash id', () => {
    expect(brandUrl(A)).toBe(`/api/brand/${A.id}`)
    expect(brandUrl({ ...A, id: '../../api/me' })).toBeNull()
    expect(brandUrl(null)).toBeNull()
  })

  it('a wide logo is capped so it cannot push the top-bar controls off-screen (final review)', () => {
    const css = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
    const frame = css('src/frame/frame.css')
    const topLogo = /\.top-logo\s*\{([^}]*)\}/g
    const rules = [...frame.matchAll(topLogo)].map((m) => m[1]!)
    expect(rules[0]).toMatch(/max-width:\s*12rem;/)
    expect(rules[0]).toMatch(/object-fit:\s*contain;/)
    const tablet = frame.slice(frame.indexOf('@media (max-width: 1023.98px)'))
    expect(tablet).toMatch(/\.top-logo\s*\{[^}]*max-width:\s*6rem;/)
    expect(css('src/pilot.css')).toMatch(/\.login-logo\s*\{[^}]*object-fit:\s*contain;/)
  })

  it('the swap rules and the login size exist in the stylesheets', () => {
    const css = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
    const frame = css('src/frame/frame.css')
    expect(frame).toMatch(/\.brand-when-dark\s*\{\s*display:\s*none;/)
    expect(frame).toMatch(/\[data-pilot-mode='dark'\]\s*\.brand-when-light\s*\{\s*display:\s*none;/)
    expect(frame).toMatch(/\[data-pilot-mode='dark'\]\s*\.brand-when-dark\s*\{\s*display:\s*block;/)
    expect(css('src/pilot.css')).toMatch(/\.login-logo\s*\{[^}]*height:\s*4rem;/)
  })
})
