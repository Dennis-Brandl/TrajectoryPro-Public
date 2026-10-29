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
import { eq } from 'drizzle-orm';
import { systemSettings } from '../db/schema/index.js';
import { makeTestDb } from '../../test/helpers/db.js';
import { readSiteTheme, writeSiteTheme, bumpThemeRev, PILOT_THEME_KEY, PILOT_THEME_REV_KEY } from './pilot-theme-store';

describe('site theme store (spec §8.1)', () => {
  it('nothing stored reads as rev 0 and the empty theme', async () => {
    const { db, close } = await makeTestDb();
    expect(await readSiteTheme(db)).toEqual({ rev: 0, site: { schema: 1 } });
    await close();
  });

  it('each write stores the theme and bumps the rev by one', async () => {
    const { db, close } = await makeTestDb();
    expect(await writeSiteTheme(db, { schema: 1, font: 'lato' })).toBe(1);
    expect(await writeSiteTheme(db, { schema: 1, appTitle: 'Acme' })).toBe(2);
    expect(await readSiteTheme(db)).toEqual({ rev: 2, site: { schema: 1, appTitle: 'Acme' } });
    const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, PILOT_THEME_KEY));
    expect(JSON.parse(row!.value)).toEqual({ schema: 1, appTitle: 'Acme' });
    await close();
  });

  it('an unreadable stored theme reads as the empty theme; a non-numeric rev reads as 0 and restarts at 1', async () => {
    const { db, close } = await makeTestDb();
    await db.insert(systemSettings).values([
      { key: PILOT_THEME_KEY, value: '{not json' },
      { key: PILOT_THEME_REV_KEY, value: 'abc' },
    ]);
    expect(await readSiteTheme(db)).toEqual({ rev: 0, site: { schema: 1 } });
    expect(await bumpThemeRev(db)).toBe(1);
    await close();
  });

  it('a stored theme with bad fields keeps its good ones', async () => {
    const { db, close } = await makeTestDb();
    await db.insert(systemSettings).values({
      key: PILOT_THEME_KEY,
      value: JSON.stringify({ schema: 1, font: 'comic-sans', density: 'touch', colors: { light: { brand: 'red' } } }),
    });
    expect((await readSiteTheme(db)).site).toEqual({ schema: 1, density: 'touch', colors: { light: {} } });
    await close();
  });
});
