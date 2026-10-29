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

import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSetupStatus } from '@/lib/setupClient'
import { SetupWizard } from '@/components/setup/SetupWizard'

export const Route = createFileRoute('/setup')({
  beforeLoad: async () => {
    // A transient getSetupStatus() failure falls through to render the wizard
    // (it re-checks status itself). The redirect is thrown OUTSIDE the try so it
    // always propagates — a `redirect()` is a Response, not catchable by shape.
    let status
    try {
      status = await getSetupStatus()
    } catch {
      return
    }
    if (status.setupComplete) throw redirect({ to: '/' })
  },
  component: SetupWizard,
})
