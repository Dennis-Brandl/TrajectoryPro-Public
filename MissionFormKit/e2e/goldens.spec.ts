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
import { test, expect } from '@playwright/test'

const WIDTHS = [380, 768, 1440] as const
const MODES = ['run', 'edit'] as const

for (const mode of MODES) {
  for (const w of WIDTHS) {
    test(`kitchen-sink ${mode} @ ${w}`, async ({ page }) => {
      // Freeze the clock BEFORE navigation so the run-mode countdown timer never ticks.
      // pauseAt MUST run before goto (not after, as Playwright's docs example shows):
      // the timer is a setInterval registered on mount, so the clock must already be
      // paused when it starts, or it fires at least once and the golden flaps.
      await page.clock.install({ time: new Date('2026-07-14T00:00:00Z') })
      await page.clock.pauseAt(new Date('2026-07-14T00:00:00Z'))
      await page.goto(`/?w=${w}&mode=${mode}`)
      // Settle web fonts (no-op for the system stack, safety for any web font).
      await page.evaluate(() => document.fonts.ready.then(() => true))
      const frame = page.locator('.golden-frame')
      await expect(frame).toHaveScreenshot(`ks-${mode}-${w}.png`)
    })
  }
}
