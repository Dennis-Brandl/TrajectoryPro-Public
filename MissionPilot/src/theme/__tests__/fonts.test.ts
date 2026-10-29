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

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PILOT_FONTS } from 'mission-control-db/src/dao/pilot-theme'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const CSS = read('src/theme/fonts.css')
const SCRIPT = read('scripts/copy-fonts.mjs')

// face count per family: variable fonts 2 (latin + latin-ext), static fonts 2 per weight
const FACES: Record<string, number> = {
  Inter: 2, 'JetBrains Mono': 4, 'IBM Plex Sans': 2, 'Source Sans 3': 2, 'Noto Sans': 2, Roboto: 2,
  'Open Sans': 2, 'Atkinson Hyperlegible': 4, Barlow: 6, 'Fira Sans': 6, Lato: 4,
}

describe('self-hosted fonts (spec §10)', () => {
  it('every @font-face url points at a file the copy script copies', () => {
    const urls = [...CSS.matchAll(/url\('\/fonts\/([\w-]+)\/([\w.-]+)'\)/g)].map((m) => [m[1]!, m[2]!])
    expect(urls.length).toBe(36)
    for (const [id, file] of urls) {
      expect(SCRIPT).toContain(`'${id}'`)
      expect(SCRIPT).toContain(`'${file}'`)
    }
  })

  it('the copy script sources exist in node_modules (dev dependencies installed)', () => {
    const entries = [...SCRIPT.matchAll(/\['([\w-]+)', '(@fontsource[\w/-]+)', \[([^\]]+)\]\]/g)]
    expect(entries.map((e) => e[1])).toEqual([
      'inter', 'jetbrains-mono', 'ibm-plex-sans', 'source-sans-3', 'noto-sans', 'roboto', 'open-sans',
      'atkinson-hyperlegible', 'barlow', 'fira-sans', 'lato',
    ])
    for (const [, , pkg, list] of entries) {
      for (const file of list!.match(/'[^']+'/g)!.map((s) => s.slice(1, -1))) {
        expect(existsSync(join(ROOT, 'node_modules', pkg!, 'files', file)), file).toBe(true)
      }
    }
  })

  it('declares every family with font-display: swap', () => {
    for (const [family, count] of Object.entries(FACES)) {
      expect(CSS.split(`font-family: '${family}';`).length - 1, family).toBe(count)
    }
    expect(CSS.match(/font-display: swap;/g)!.length).toBe(36)
  })

  it('every curated theme font has its @font-face family (the theme names them by family)', () => {
    for (const [id, font] of Object.entries(PILOT_FONTS)) {
      if (font.family === null) continue
      expect(CSS, id).toContain(`font-family: '${font.family}';`)
    }
  })

  it('the service worker precaches only the default faces; the rest cache on first use', () => {
    const config = read('vite.config.ts')
    expect(config).toContain("globPatterns: ['**/*.{js,css,html,svg}', 'fonts/inter/*.woff2', 'fonts/jetbrains-mono/*.woff2']")
    expect(config).toMatch(/url\.pathname\.startsWith\('\/fonts\/'\)[\s\S]*?handler: 'CacheFirst'/)
    expect(config).toMatch(/url\.pathname\.startsWith\('\/api\/brand\/'\)[\s\S]*?handler: 'CacheFirst'/)
  })
})
