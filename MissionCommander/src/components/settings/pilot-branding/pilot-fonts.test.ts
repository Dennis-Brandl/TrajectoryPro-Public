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

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PILOT_FONTS } from 'mission-control-db/src/dao/pilot-theme';

// Spec 2026-10-09 §10: Commander's theme preview needs the Pilot's faces. Commander's image is
// built without MissionPilot/, so it keeps byte copies; these tests keep them in step.
const ROOT = process.cwd();
const PILOT = join(ROOT, '..', 'MissionPilot');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const fontDeps = (pkgPath: string) =>
  Object.entries((JSON.parse(read(pkgPath)) as { devDependencies: Record<string, string> }).devDependencies)
    .filter(([name]) => name.startsWith('@fontsource'))
    .sort(([a], [b]) => a.localeCompare(b));

describe("Commander's copy of the Pilot fonts (spec §10)", () => {
  it('the copy script is byte-identical to the Pilot\'s', () => {
    expect(read(join(ROOT, 'scripts/copy-fonts.mjs'))).toBe(read(join(PILOT, 'scripts/copy-fonts.mjs')));
  });

  it('the @font-face sheet is byte-identical to the Pilot\'s and declares every curated family', () => {
    const css = read(join(ROOT, 'src/components/settings/pilot-branding/pilot-fonts.css'));
    expect(css).toBe(read(join(PILOT, 'src/theme/fonts.css')));
    for (const [id, font] of Object.entries(PILOT_FONTS)) {
      if (font.family !== null) expect(css, id).toContain(`font-family: '${font.family}';`);
    }
  });

  it('the @fontsource packages and versions match the Pilot\'s exactly', () => {
    const mine = fontDeps(join(ROOT, 'package.json'));
    expect(mine).toHaveLength(11);
    expect(mine).toEqual(fontDeps(join(PILOT, 'package.json')));
    for (const [name] of mine) expect(existsSync(join(ROOT, 'node_modules', name)), name).toBe(true);
  });

  it('dev, build and the image copy the fonts before Vite runs', () => {
    const scripts = (JSON.parse(read(join(ROOT, 'package.json'))) as { scripts: Record<string, string> }).scripts;
    expect(scripts.dev).toBe('npm run build:help && node scripts/copy-fonts.mjs && vite');
    expect(scripts.build).toBe('npm run build:help && node scripts/copy-fonts.mjs && vite build');
    expect(read(join(ROOT, 'Dockerfile'))).toContain('RUN node scripts/build-help.mjs && node scripts/copy-fonts.mjs && npx vite build');
    expect(read(join(ROOT, '.gitignore'))).toMatch(/^public\/fonts\/$/m);
  });
});
