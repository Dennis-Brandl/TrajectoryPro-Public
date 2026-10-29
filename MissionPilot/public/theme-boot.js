/*
 * Copyright 2026 Dennis L. Brandl
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* Runs before the CSS bundle and React (index.html <head>), so the operator's
   light/dark and text-size choice AND the cached site theme are on <html> at first
   paint — no light flash on a dark-mode kiosk, no default-blue flash on a branded one.
   Mirrors src/theme/prefs.ts and src/theme/site-theme.ts (theme-boot.test.ts checks
   parity). Every storage access is guarded: a blocked store must leave the shipped
   light defaults, never an error. */
(function () {
  var root = document.documentElement
  var MODES = ['light', 'dark', 'system']
  var LAYER_ORDER = '@layer pilot.defaults, pilot.theme, pilot.prefs, pilot.components;'
  var HEX = /^#[0-9a-fA-F]{6}$/

  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null')
    } catch (e) {
      return null
    }
  }

  function validTheme(t) {
    return (
      typeof t === 'object' && t !== null &&
      typeof t.rev === 'number' && t.rev >= 0 && t.rev % 1 === 0 &&
      typeof t.css === 'string' && t.css.indexOf(LAYER_ORDER) === 0 &&
      typeof t.theme === 'object' && t.theme !== null && typeof t.theme.appTitle === 'string' &&
      typeof t.theme.defaultMode === 'string' && MODES.indexOf(t.theme.defaultMode) !== -1 &&
      typeof t.themeColor === 'object' && t.themeColor !== null &&
      typeof t.themeColor.light === 'string' && HEX.test(t.themeColor.light) &&
      typeof t.themeColor.dark === 'string' && HEX.test(t.themeColor.dark) &&
      (t.fontFamily === null || typeof t.fontFamily === 'string') &&
      (t.etag === undefined || typeof t.etag === 'string')
    )
  }

  var prefs = read('pilot:prefs')
  if (typeof prefs !== 'object' || prefs === null) prefs = {}
  var theme = read('pilot:theme:last')
  if (!validTheme(theme)) theme = null

  var mode = MODES.indexOf(prefs.mode) !== -1 ? prefs.mode : theme ? theme.theme.defaultMode : 'light'
  if (mode === 'system') {
    try {
      mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    } catch (e) {
      mode = 'light'
    }
  }
  root.setAttribute('data-pilot-mode', mode)
  var scales = [0.9, 1, 1.15, 1.3]
  if (scales.indexOf(prefs.textScale) !== -1) root.style.setProperty('--pilot-text-scale', String(prefs.textScale))

  if (theme) {
    var style = document.createElement('style')
    style.id = 'pilot-theme'
    style.textContent = theme.css
    document.head.appendChild(style)
    root.setAttribute('data-pilot-theme', 'site')
    var meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', theme.themeColor[mode])
  }
})()
