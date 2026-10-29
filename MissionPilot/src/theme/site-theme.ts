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

import { useEffect, useState } from 'react'
import type { ThemePayload, ThemeMode } from 'mission-control-db'

// Spec 2026-10-09 §13: the resolved site (P3: work-center) theme, delivered by the engine
// as ready-made CSS (GET /api/theme). public/theme-boot.js applies the cached copy before
// first paint — keep parseThemePayload in step with its validTheme() (theme-boot.test.ts
// checks parity). Sign-out keeps pilot:theme:* so the login screen stays branded (§13.3).
export const THEME_LAST_KEY = 'pilot:theme:last'
export const themeWcKey = (wcId: string): string => `pilot:theme:wc:${wcId}`
export const THEME_STYLE_ID = 'pilot-theme'
/** Fired by the inbox stream's SSE `theme` event (inbox-data.ts): a theme was saved somewhere. */
export const THEME_CHANGED_EVENT = 'pilot:theme-changed'
// The same statement tokens.css opens with. The theme <style> can land in <head> BEFORE the
// bundle's CSS, and a layer's rank is fixed where its name first appears — the engine's CSS
// starts with this line, and a payload that does not is not ours.
export const LAYER_ORDER = '@layer pilot.defaults, pilot.theme, pilot.prefs, pilot.components;'
const MODES: readonly string[] = ['light', 'dark', 'system']
const HEX = /^#[0-9a-fA-F]{6}$/

export function parseThemePayload(raw: string | null): ThemePayload | null {
  let value: unknown
  try {
    value = JSON.parse(raw ?? 'null')
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const p = value as Record<string, unknown>
  const theme = p.theme as Record<string, unknown> | null | undefined
  const color = p.themeColor as Record<string, unknown> | null | undefined
  const ok =
    typeof p.rev === 'number' &&
    Number.isInteger(p.rev) &&
    p.rev >= 0 &&
    typeof p.css === 'string' &&
    p.css.startsWith(LAYER_ORDER) &&
    typeof theme === 'object' &&
    theme !== null &&
    typeof theme.appTitle === 'string' &&
    typeof theme.defaultMode === 'string' &&
    MODES.includes(theme.defaultMode) &&
    typeof color === 'object' &&
    color !== null &&
    typeof color.light === 'string' &&
    HEX.test(color.light) &&
    typeof color.dark === 'string' &&
    HEX.test(color.dark) &&
    (p.fontFamily === null || typeof p.fontFamily === 'string') &&
    (p.etag === undefined || typeof p.etag === 'string')
  return ok ? (value as ThemePayload) : null
}

export function readCachedTheme(key: string): ThemePayload | null {
  try {
    return parseThemePayload(localStorage.getItem(key))
  } catch {
    return null
  }
}

export function writeCachedTheme(key: string, payload: ThemePayload): void {
  try {
    localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // Storage blocked: the theme still applies for this page's lifetime.
  }
}

/** Writes the theme layer (or removes it: shipped defaults) and starts loading its face so the
 *  service worker caches it for offline use (spec §13 item 4). */
export function applyTheme(payload: ThemePayload | null, doc: Document = document): void {
  const root = doc.documentElement
  let style = doc.getElementById(THEME_STYLE_ID)
  if (!payload) {
    style?.remove()
    root.setAttribute('data-pilot-theme', 'default')
    return
  }
  if (!style) {
    style = doc.createElement('style')
    style.id = THEME_STYLE_ID
    doc.head.appendChild(style)
  }
  if (style.textContent !== payload.css) style.textContent = payload.css
  root.setAttribute('data-pilot-theme', 'site')
  if (payload.fontFamily) {
    try {
      void doc.fonts?.load(`1em "${payload.fontFamily}"`).catch(() => {})
    } catch {
      // No FontFace API (jsdom, old engines): the @font-face rule still loads it on use.
    }
  }
}

/** <meta name="theme-color"> follows the resolved header colour for the mode on <html> (§13.5). */
export function applyThemeColor(payload: ThemePayload, doc: Document = document): void {
  const mode: ThemeMode = doc.documentElement.getAttribute('data-pilot-mode') === 'dark' ? 'dark' : 'light'
  let meta = doc.head.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = doc.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    doc.head.appendChild(meta)
  }
  meta.setAttribute('content', payload.themeColor[mode])
}

export type ThemeFetchResult = { status: 'fresh'; payload: ThemePayload } | { status: 'unchanged' } | { status: 'failed' }

/** GET /api/theme with If-None-Match = the cached payload's ETag (rev + response hash, so an
 *  engine deploy that changes the payload is never answered 304). No ETag cached = an
 *  unconditional fetch. Never throws: an outage keeps the cached theme (§13). */
export async function fetchTheme(wcId: string | null, etag: string | null): Promise<ThemeFetchResult> {
  const url = wcId ? `/api/theme?workCenterId=${encodeURIComponent(wcId)}` : '/api/theme'
  try {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: etag === null ? {} : { 'if-none-match': etag },
    })
    if (res.status === 304) return { status: 'unchanged' }
    if (!res.ok) return { status: 'failed' }
    const payload = parseThemePayload(await res.text())
    return payload ? { status: 'fresh', payload } : { status: 'failed' }
  } catch {
    return { status: 'failed' }
  }
}

/** Spec §13 items 2–3: the cached theme at once, then the engine's, refetched on every work-center
 *  change and every SSE `theme` event. A fresh payload is cached under both its own key and
 *  pilot:theme:last (what theme-boot.js and the login screen use). */
export function useSiteTheme(wcId: string | null): ThemePayload | null {
  const key = wcId ? themeWcKey(wcId) : THEME_LAST_KEY
  const [payload, setPayload] = useState<ThemePayload | null>(() => readCachedTheme(key) ?? readCachedTheme(THEME_LAST_KEY))
  const [changes, setChanges] = useState(0)

  useEffect(() => {
    const onChange = () => setChanges((n) => n + 1)
    window.addEventListener(THEME_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(THEME_CHANGED_EVENT, onChange)
  }, [])

  useEffect(() => {
    let live = true
    const cached = readCachedTheme(key)
    if (cached) setPayload(cached)
    void fetchTheme(wcId, cached?.etag ?? null).then((result) => {
      if (!live || result.status !== 'fresh') return
      writeCachedTheme(key, result.payload)
      writeCachedTheme(THEME_LAST_KEY, result.payload)
      setPayload(result.payload)
    })
    return () => {
      live = false
    }
  }, [key, wcId, changes])

  useEffect(() => {
    if (payload) applyTheme(payload)
  }, [payload])

  return payload
}
