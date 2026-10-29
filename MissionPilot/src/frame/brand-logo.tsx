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
// Spec 2026-10-09 §12: the theme's logo, always an <img> (never inlined), from the engine's
// public, immutable /api/brand/:id (the service worker caches it, vite.config.ts). A dark-mode
// logo swaps in by CSS on [data-pilot-mode='dark'] (frame.css), so the mode theme-boot.js
// sets before first paint applies at once. No logo — or one that fails to load (removed, or
// offline and never cached) — shows the shipped image instead of a broken one.
import { createContext, useContext, useState } from 'react'
import type { ThemeLogo } from 'mission-control-db'

export interface BrandLogos {
  logo: ThemeLogo | null
  logoDark: ThemeLogo | null
}
export const NO_LOGOS: BrandLogos = { logo: null, logoDark: null }
/** The resolved theme's logos, provided by App from the theme payload. */
export const BrandLogoContext = createContext<BrandLogos>(NO_LOGOS)

const LOGO_ID = /^sha256:[0-9a-f]{64}$/

export function brandUrl(logo: ThemeLogo | null): string | null {
  return logo && LOGO_ID.test(logo.id) ? `/api/brand/${logo.id}` : null
}

export interface BrandLogoProps {
  /** Class of an uploaded logo. */
  className: string
  /** Class of the shipped image. */
  fallbackClassName: string
  fallbackSrc: string
  fallbackAlt: string
  /** Alt text for a logo uploaded without a description. */
  logoAlt: string
  /** Beside the app title (the top bar): never announced. */
  decorative?: boolean
}

export function BrandLogo(p: BrandLogoProps) {
  const { logo, logoDark } = useContext(BrandLogoContext)
  const [failed, setFailed] = useState<readonly string[]>([])
  const pick = (l: ThemeLogo | null) => {
    const url = brandUrl(l)
    return l && url && !failed.includes(url) ? { url, alt: l.alt } : null
  }
  const image = (choice: { url: string; alt: string } | null, modeClass?: string) => {
    const className = [choice ? p.className : p.fallbackClassName, modeClass].filter(Boolean).join(' ')
    if (!choice) return <img key="shipped" className={className} src={p.fallbackSrc} alt={p.decorative ? '' : p.fallbackAlt} />
    return (
      <img
        key={choice.url}
        className={className}
        src={choice.url}
        alt={p.decorative ? '' : choice.alt || p.logoAlt}
        onError={() => setFailed((f) => [...f, choice.url])}
      />
    )
  }
  const light = pick(logo)
  const dark = pick(logoDark)
  if (!dark || dark.url === light?.url) return image(light)
  return (
    <>
      {image(light, 'brand-when-light')}
      {image(dark, 'brand-when-dark')}
    </>
  )
}
