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

import { expect, type Page } from '@playwright/test'

export type RailName = 'Workflows' | 'Step Libraries' | 'Environments' | 'Actions'

// Clicking the ACTIVE rail item hides the library pane, and Workflows is already active after
// sign-in. So click a rail button only when it is not the current one, then wait for it to
// become current.
export async function openRail(page: Page, name: RailName) {
  const button = page.getByRole('button', { name, exact: true })
  if ((await button.getAttribute('aria-current')) !== 'page') await button.click()
  await expect(button).toHaveAttribute('aria-current', 'page')
}
