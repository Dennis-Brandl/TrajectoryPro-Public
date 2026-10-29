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

// First-run bootstrap state (design D3/§3). `setupComplete` is an app_setting
// flag that gates the startup wizard.

import { rawQuery } from './db'

const SETUP_COMPLETE_KEY = 'setupComplete'

export async function isSetupComplete(): Promise<boolean> {
  const rows = await rawQuery<{ value: string }>('SELECT value FROM "app_setting" WHERE key = $1', [SETUP_COMPLETE_KEY])
  return rows[0]?.value === 'true'
}

export async function markSetupComplete(): Promise<void> {
  await rawQuery(
    `INSERT INTO "app_setting" (key, value) VALUES ($1, 'true')
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [SETUP_COMPLETE_KEY],
  )
}

export async function hasAdmin(): Promise<boolean> {
  const rows = await rawQuery('SELECT 1 FROM "user" WHERE "isAdministrator" = true LIMIT 1')
  return rows.length > 0
}

export async function getSetupStatus(): Promise<{ setupComplete: boolean; hasAdmin: boolean }> {
  return {
    setupComplete: await isSetupComplete(),
    hasAdmin: await hasAdmin(),
  }
}

/**
 * Upgrade backfill (design D10/§3.5): an install that already has an admin was
 * bootstrapped under the old implicit flow (auto-promote + seeded team-default),
 * so mark it complete to keep it out of the wizard. No-op once the flag is set
 * or when no admin exists (a genuinely fresh DB).
 */
export async function backfillSetupComplete(): Promise<void> {
  if (await isSetupComplete()) return
  if (await hasAdmin()) await markSetupComplete()
}
