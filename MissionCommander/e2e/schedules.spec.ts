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
//
// Workflow scheduling, end to end in a real browser with the real engine (playwright.config.ts
// runs it with SCHEDULE_TICK_MS=1000): a Master Schedule is built in the editor, enabled, fires on
// real one-minute slots, chains a second workflow from the first run's batch value, then is paused,
// resumed with the missed starts, has the chained item disabled, and is cancelled.
//
// Both workflows are START -> END machine workflows, so every run settles without an operator.
// Waits are bounded by the one-minute slot length: a slot is at most ~60 s away.
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN } from './helpers/db';
import { machineWorkflowPackage, type FilePayload } from './helpers/packages';
import { openRail } from './helpers/rail';

const WC_NAME = 'E2E Schedule WC';
const MASTER_NAME = 'Batch cycle';
const SLOT_WAIT = 90_000; // one slot (60 s) plus tick and polling slack

async function createWorkCenter(page: Page, name: string) {
  await openRail(page, 'Work Centers');
  await page.getByRole('button', { name: 'New work center' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function load(page: Page, file: FilePayload) {
  await page.getByRole('button', { name: /Load packages/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Packages').setInputFiles([file]);
  await dialog.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByText('Load results')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

async function chooseWorkflow(page: Page, index: number, name: string) {
  const group = page.getByRole('group', { name: 'Workflow', exact: true }).nth(index);
  await group.getByRole('combobox').click();
  await page.getByRole('option', { name, exact: true }).click();
}

// The occurrence list's run rows for one item name, in page order (newest occurrence first).
const runRows = (page: Page, item: string) =>
  page.locator('ul.divide-y li div.pl-4').filter({ has: page.locator(`span:text-is("${item}")`) });

const occurrenceCount = (page: Page) => page.getByText(/^Occurrence \d+$/).count();

test.setTimeout(420_000);

test('a Master Schedule fires, chains, pauses, resumes, skips a disabled item and cancels', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME);
  await load(page, machineWorkflowPackage({
    localId: 'Blend', oid: 'e2e-sched-blend',
    startingParameterSpecifications: [{ id: 'BatchId', default_value: '' }],
    outputParameterSpecifications: [{ id: 'Yield', target: 'BatchId' }],
  }));
  await load(page, machineWorkflowPackage({
    localId: 'Move', oid: 'e2e-sched-move',
    startingParameterSpecifications: [{ id: 'BatchId', default_value: '' }],
  }));

  // 1. Build the Master: Blend every minute, then Move with Blend's batch value.
  await page.getByRole('tab', { name: 'Schedules' }).click();
  await page.getByRole('button', { name: 'New Master Schedule' }).click();
  await page.getByLabel('Name', { exact: true }).fill(MASTER_NAME);
  await page.getByRole('radio', { name: 'Fixed delay' }).check();
  await page.getByLabel('Every', { exact: true }).fill('1');
  await page.getByLabel('Unit').selectOption('minutes');
  // A start in the past: slots fall on every whole minute from it, so the first is under a minute away.
  await page.getByLabel('Start at').fill('2026-01-01T00:00');

  await page.getByRole('button', { name: 'Add workflow' }).click();
  await chooseWorkflow(page, 0, 'Blend');
  const blend = page.getByRole('listitem', { name: 'Workflow Blend' });
  await blend.getByLabel('Source for BatchId').first().selectOption({ label: 'Template' });
  await blend.getByLabel('Template for BatchId').fill('B-{occurrence.number}');

  await page.getByRole('button', { name: 'Add chained workflow to Blend' }).click();
  await chooseWorkflow(page, 1, 'Move');
  const move = page.getByRole('listitem', { name: 'Workflow Move' });
  await move.getByLabel('Source for BatchId').selectOption({ label: 'From triggering run' });
  await move.getByLabel('Triggering run value for BatchId').selectOption('trigger.input:BatchId');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(`Saved "${MASTER_NAME}"`)).toBeVisible();

  // 2. Enable it.
  await page.getByRole('button', { name: `Enable Recurrence ${MASTER_NAME}` }).click();
  const enable = page.getByRole('dialog');
  await expect(enable.getByRole('list', { name: 'First fire times' })).toBeVisible();
  await enable.getByRole('button', { name: 'Enable Recurrence', exact: true }).click();
  await expect(page.getByText('Recurrence enabled as RS-1')).toBeVisible();
  await page.getByRole('button', { name: 'RS-1', exact: true }).click();
  await expect(page.getByRole('heading', { name: `RS-1 "${MASTER_NAME}"` })).toBeVisible();

  // 3. The first slot fires Blend, and Move follows it. Both runs finish on their own.
  await expect(runRows(page, 'Blend').first()).toBeVisible({ timeout: SLOT_WAIT });
  await expect(runRows(page, 'Move').first()).toBeVisible({ timeout: 30_000 });
  // Slots are numbered from the schedule's start, so the number is read, not assumed.
  const occurrence = page.getByText(/^Occurrence \d+$/).last();
  await expect(occurrence).toBeVisible();
  const firstNumber = ((await occurrence.textContent()) ?? '').match(/\d+/)![0];
  await expect.poll(async () => (await runRows(page, 'Move').first().textContent()) ?? '', { timeout: 30_000 }).toMatch(/RW-\d+/);
  const moveLabel = ((await runRows(page, 'Move').first().textContent()) ?? '').match(/RW-\d+/)![0];
  // The run's label opens its Runtime dialog; the run is also listed in the Runtime tab.
  await page.getByRole('button', { name: `Open ${moveLabel}` }).click();
  const runDialog = page.getByRole('dialog');
  await expect(runDialog.getByRole('heading', { name: new RegExp(`^${moveLabel} · Move`) })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(runDialog).toBeHidden();
  await page.getByRole('tab', { name: 'Runtime' }).click();
  await page.getByRole('button', { name: 'All' }).click();
  await expect(page.getByRole('button', { name: `${moveLabel} details` })).toBeVisible();
  // Move's History record carries the batch value it took from the triggering run.
  await page.getByRole('tab', { name: 'History' }).click();
  await page.getByRole('button', { name: `History ${moveLabel}` }).click();
  const record = page.getByRole('dialog');
  await record.getByRole('button', { name: 'Show starting params' }).click();
  await expect(record.getByText('BatchId')).toBeVisible();
  await expect(record.getByText(`B-${firstNumber}`, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(record).toBeHidden();
  await page.getByRole('tab', { name: 'Schedules' }).click();
  await page.getByRole('button', { name: 'RS-1', exact: true }).click();

  // 4. Pause, let at least two slots pass, then Resume and Start all.
  await page.getByRole('button', { name: 'Pause RS-1' }).click();
  await expect(page.getByRole('button', { name: 'Resume RS-1' })).toBeVisible();
  const before = await occurrenceCount(page);
  await page.waitForTimeout(125_000);
  await page.getByRole('button', { name: 'Resume RS-1' }).click();
  const resume = page.getByRole('dialog');
  await expect(resume.getByText(/Missed scheduled starts: \d+/)).toBeVisible();
  await resume.getByRole('radio', { name: /^Start all \d+/ }).check();
  await resume.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(resume).toBeHidden();
  await expect(page.getByText('Catch-up').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => occurrenceCount(page), { timeout: 30_000 }).toBeGreaterThan(before);
  await expect(page.getByText(/Resumed by .*started \d+ of \d+ missed/)).toBeVisible();

  // 5. Disable Move: the next occurrence starts Blend and records Move as skipped.
  await page.getByRole('button', { name: 'Disable Move' }).click();
  await expect(page.getByRole('button', { name: 'Re-enable Move' })).toBeVisible();
  await expect(page.getByText('Skipped (disabled)').first()).toBeVisible({ timeout: SLOT_WAIT });

  // 6. Cancel with a reason; no further runs start.
  await page.getByRole('button', { name: 'Cancel RS-1' }).click();
  const cancel = page.getByRole('dialog');
  await cancel.getByLabel('Reason').fill('end of the test');
  await cancel.getByRole('button', { name: 'Cancel Runtime Schedule' }).click();
  await expect(cancel).toBeHidden();
  await expect(page.getByText(/Cancelled by .*end of the test/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause RS-1' })).toHaveCount(0);
  const settled = await occurrenceCount(page);
  await page.waitForTimeout(70_000);
  expect(await occurrenceCount(page)).toBe(settled);

  // 6b. A Manual schedule has no recurrence to enable, and Run Once starts it through the real engine.
  await page.getByRole('button', { name: 'Back to Runtime Schedules' }).click();
  await page.getByRole('button', { name: 'New Master Schedule' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Fire alarm');
  await page.getByRole('radio', { name: 'Manual' }).check();
  await page.getByRole('button', { name: 'Add workflow' }).click();
  await chooseWorkflow(page, 0, 'Blend');
  const alarmBlend = page.getByRole('listitem', { name: 'Workflow Blend' });
  await alarmBlend.getByLabel('Source for BatchId').first().selectOption({ label: 'Template' });
  await alarmBlend.getByLabel('Template for BatchId').fill('ALARM');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved "Fire alarm"')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable Recurrence Fire alarm' })).toBeDisabled();
  await page.getByRole('button', { name: 'Run Once Fire alarm' }).click();
  const runOnce = page.getByRole('dialog');
  await expect(runOnce.getByRole('list', { name: 'Workflows that start' })).toContainText('Blend');
  await runOnce.getByRole('button', { name: 'Start now' }).click();
  await expect(page.getByText('Starting as RS-2')).toBeVisible();
  await page.getByRole('button', { name: 'RS-2', exact: true }).click();
  await expect(runRows(page, 'Blend').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Run Once requested by/)).toBeVisible();
  await expect(page.getByText('Finished', { exact: true }).first()).toBeVisible({ timeout: 60_000 });

  // 7. History shows each run's schedule label.
  await page.getByRole('button', { name: 'Back to Runtime Schedules' }).click();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByRole('button', { name: /^History RW-\d+$/ }).first()).toBeVisible();
  // The row of the run the schedule started carries the schedule's label.
  await expect(page.getByRole('button', { name: `History ${moveLabel}` })).toContainText('RS-1');
});
