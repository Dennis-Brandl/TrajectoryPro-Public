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

// Evaluates a colour token from src/theme/tokens.css the way the browser does on
// <html>: the dark block overrides the light block, and var()/color-mix() resolve
// against the same mode. Supports exactly the value forms tokens.css uses for
// colours: #rrggbb, white, black, var(--pilot-x), color-mix(in oklab, X p%, Y).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mixOklab } from './color-math'

export const TOKENS_CSS = readFileSync(join(process.cwd(), 'src/theme/tokens.css'), 'utf8')

function declarations(selector: string): Map<string, string> {
  const start = TOKENS_CSS.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`tokens.css has no "${selector} {" block`)
  const open = TOKENS_CSS.indexOf('{', start)
  const body = TOKENS_CSS.slice(open + 1, TOKENS_CSS.indexOf('}', open)).replace(/\/\*[\s\S]*?\*\//g, '')
  const out = new Map<string, string>()
  for (const decl of body.split(';')) {
    const colon = decl.indexOf(':')
    if (colon < 0) continue
    const name = decl.slice(0, colon).trim()
    if (name.startsWith('--pilot-')) out.set(name, decl.slice(colon + 1).trim())
  }
  return out
}

const LIGHT = declarations(':root')
const DARK = declarations(':root[data-pilot-mode="dark"]')

export type Mode = 'light' | 'dark'

export function resolveColor(token: string, mode: Mode, depth = 0): string {
  if (depth > 12) throw new Error(`token cycle at ${token}`)
  const raw = (mode === 'dark' ? DARK.get(token) : undefined) ?? LIGHT.get(token)
  if (raw === undefined) throw new Error(`unknown token ${token}`)
  return evaluate(raw, mode, depth)
}

function evaluate(value: string, mode: Mode, depth: number): string {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase()
  if (value === 'white') return '#ffffff'
  if (value === 'black') return '#000000'
  const ref = /^var\((--pilot-[\w-]+)\)$/.exec(value)
  if (ref) return resolveColor(ref[1]!, mode, depth + 1)
  const mix = /^color-mix\(in oklab, (.+?) (\d+(?:\.\d+)?)%, (.+)\)$/.exec(value)
  if (mix) return mixOklab(evaluate(mix[1]!, mode, depth + 1), evaluate(mix[3]!, mode, depth + 1), Number(mix[2]) / 100)
  throw new Error(`cannot evaluate colour value "${value}"`)
}
