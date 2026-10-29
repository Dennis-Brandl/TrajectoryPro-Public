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

// Render a Markdown document to a styled, paginated PDF next to it (or to a given path).
// Uses the marked and Playwright Chromium that Mission Commander already installs:
//
//   cd MissionCommander && npm install && npx playwright install chromium   (once)
//   node scripts/md-to-pdf.mjs docs/DISTRIBUTED_WORKFLOW_LIBRARY.md [out.pdf]

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'MissionCommander', 'package.json'));
const { Marked } = require('marked');
const { chromium } = require('playwright');

const [src, outArg] = process.argv.slice(2);
if (!src) {
  console.error('Usage: node scripts/md-to-pdf.mjs <file.md> [out.pdf]');
  process.exit(1);
}
const out = outArg ?? src.replace(/\.md$/i, '') + '.pdf';
const md = readFileSync(src, 'utf8');
// GitHub-style heading slugs so the document's #anchor links work in the PDF.
const slug = (t) => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\- ]/g, '').replace(/ /g, '-');
const marked = new Marked({ gfm: true });
marked.use({ renderer: { heading({ tokens, depth, text }) {
  return `<h${depth} id="${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
} } });
const body = marked.parse(md);
const title = (md.match(/^# (.+)$/m) || [, 'Document'])[1];

const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
  @page { size: Letter; margin: 0.8in 0.75in 0.85in; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #1f2328; }
  h1 { font-size: 22pt; margin: 0 0 6pt; padding-bottom: 6pt; border-bottom: 2px solid #1f4e79; color: #1f4e79; }
  h2 { font-size: 15pt; margin: 20pt 0 6pt; padding-bottom: 3pt; border-bottom: 1px solid #d0d7de; color: #1f4e79; break-after: avoid; }
  h3 { font-size: 12pt; margin: 14pt 0 4pt; break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  p:has(> strong:only-child) { break-after: avoid; }
  a { color: #0b5cad; text-decoration: none; }
  code { font-family: Consolas, "Courier New", monospace; font-size: 9pt; background: #f2f4f7; padding: 0 3px; border-radius: 3px; }
  pre { background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 4px; padding: 8pt 10pt; white-space: pre-wrap; break-inside: avoid; }
  pre code { background: none; padding: 0; font-size: 8.6pt; line-height: 1.35; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9.2pt; break-inside: auto; }
  tr { break-inside: avoid; }
  th, td { border: 1px solid #c9d1d9; padding: 3pt 6pt; text-align: left; vertical-align: top; }
  th { background: #e8eef5; }
  blockquote { margin: 8pt 0; padding: 4pt 10pt; border-left: 4px solid #1f4e79; background: #f3f7fb; color: #333; }
  hr { border: 0; border-top: 1px solid #d0d7de; margin: 14pt 0; }
</style></head><body>${body}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.pdf({ path: out, format: 'Letter', printBackground: true, displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: `<div style="font-size:8pt;color:#666;width:100%;padding:0 0.75in;display:flex;justify-content:space-between;font-family:Segoe UI,Arial"><span>${title}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  margin: { top: '0.8in', bottom: '0.85in', left: '0.75in', right: '0.75in' } });
await browser.close();
console.log('wrote', out);
