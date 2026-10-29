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

/**
 * Convert HELP.md (single source of truth) into a standalone public/help.html.
 *
 * The output is a self-contained HTML file with inline CSS and a generated
 * sticky table of contents (built from H2/H3 headings in the markdown). All
 * heading anchors are slugified so in-page #links work. Mirrors the approach
 * used by Mission Designer.
 *
 * Run via `npm run build:help` (also runs as part of `dev` and `build`).
 *
 * NOTE: the Action Tester ships as a single-file index.html; help.html is a
 * companion self-contained file. Serve the dist/ folder (or keep both files
 * together) so the in-app "Help" link resolves.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { marked } from 'marked'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'HELP.md')
const OUT_DIR = path.join(ROOT, 'public')
const OUT = path.join(OUT_DIR, 'help.html')

const APP_VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

// Track headings as marked walks the AST so we can build the TOC and add ids.
const tocItems = []
const renderer = new marked.Renderer()
renderer.heading = function ({ tokens, depth }) {
  const text = this.parser.parseInline(tokens)
  const plain = tokens
    .map((t) => ('text' in t ? t.text : ''))
    .join('')
    .trim()
  const id = slugify(plain)
  if (depth === 2 || depth === 3) {
    tocItems.push({ depth, id, text: plain })
  }
  return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${text}</h${depth}>\n`
}

// Open external links in a new tab so the help window stays put.
const baseLink = renderer.link.bind(renderer)
renderer.link = function (token) {
  const html = baseLink(token)
  if (token.href?.startsWith('http')) {
    return html.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ')
  }
  return html
}

marked.setOptions({ renderer, gfm: true, breaks: false })

const md = readFileSync(SRC, 'utf-8')
const bodyHtml = marked.parse(md)

const toc = tocItems
  .map(({ depth, id, text }) => `<li class="toc-${depth}"><a href="#${id}">${text}</a></li>`)
  .join('\n')

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Help — Mission Autopilot Tester</title>
<style>
  :root {
    --bg: #fdfdfb;
    --panel: #ffffff;
    --text: #1f2330;
    --muted: #5a6378;
    --border: #e3e6ee;
    --accent: #6a4f00;
    --accent-bg: rgba(212, 175, 55, 0.08);
    --code-bg: #f4f4f0;
    --link: #1a55c4;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  a { color: var(--link); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .layout { display: grid; grid-template-columns: 280px 1fr; min-height: 100vh; }
  aside.toc { position: sticky; top: 0; align-self: start; max-height: 100vh; overflow-y: auto; background: var(--panel); border-right: 1px solid var(--border); padding: 24px 18px 32px; }
  aside.toc h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 12px; }
  aside.toc ol { list-style: none; padding: 0; margin: 0; }
  aside.toc li.toc-2 { margin: 6px 0 2px; font-weight: 600; }
  aside.toc li.toc-3 { margin: 2px 0 2px 14px; font-size: 13.5px; color: var(--muted); }
  aside.toc li.toc-3 a { color: var(--muted); }
  aside.toc li a { display: block; padding: 2px 6px; border-radius: 4px; }
  aside.toc li a:hover { background: var(--accent-bg); color: var(--accent); text-decoration: none; }
  main { padding: 32px 48px 80px; max-width: 920px; }
  header.doc-header { display: flex; align-items: center; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
  header.doc-header .product { font-size: 14px; font-weight: 600; }
  header.doc-header .version { font-size: 12px; color: var(--muted); }
  h1, h2, h3, h4 { color: var(--text); line-height: 1.25; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  h2 { font-size: 22px; margin: 36px 0 12px; padding-top: 12px; border-top: 1px solid var(--border); }
  h3 { font-size: 17px; margin: 24px 0 8px; }
  h2:first-of-type { border-top: 0; padding-top: 0; }
  .anchor { color: var(--border); margin-right: 8px; font-weight: 400; text-decoration: none; }
  h2:hover .anchor, h3:hover .anchor { color: var(--accent); }
  p { margin: 0 0 14px; }
  ul, ol { margin: 0 0 14px; padding-left: 24px; }
  li { margin: 4px 0; }
  code { background: var(--code-bg); padding: 1px 5px; border-radius: 3px; font-family: ui-monospace, SFMono-Regular, Consolas, Menlo, monospace; font-size: 0.92em; }
  pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 14px 16px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  main img { max-width: 100%; height: auto; display: block; margin: 10px 0 18px; border: 1px solid var(--border); border-radius: 6px; }
  table { border-collapse: collapse; margin: 0 0 16px; width: 100%; }
  th, td { text-align: left; padding: 6px 12px; border: 1px solid var(--border); vertical-align: top; }
  th { background: var(--accent-bg); font-weight: 600; }
  blockquote { margin: 0 0 14px; padding: 8px 14px; border-left: 3px solid var(--accent); background: var(--accent-bg); color: var(--muted); }
  hr { border: 0; border-top: 1px solid var(--border); margin: 32px 0; }
  @media (max-width: 800px) {
    .layout { grid-template-columns: 1fr; }
    aside.toc { position: static; max-height: none; border-right: 0; border-bottom: 1px solid var(--border); }
    main { padding: 24px 20px 60px; }
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14171f;
      --panel: #1b1f2a;
      --text: #e8e9ee;
      --muted: #98a0b4;
      --border: #2a2f3c;
      --accent: #f5d27a;
      --accent-bg: rgba(212, 175, 55, 0.12);
      --code-bg: #11141c;
      --link: #8db4ff;
    }
  }
</style>
</head>
<body>
<div class="layout">
  <aside class="toc">
    <header class="doc-header">
      <div>
        <div class="product">Mission Autopilot Tester</div>
        <div class="version">Help · v${APP_VERSION}</div>
      </div>
    </header>
    <h2>Contents</h2>
    <ol>${toc}</ol>
  </aside>
  <main>${bodyHtml}</main>
</div>
</body>
</html>
`

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, html, 'utf-8')
console.log(`Wrote ${path.relative(ROOT, OUT)} (${(html.length / 1024).toFixed(1)} kB, ${tocItems.length} TOC entries)`)
