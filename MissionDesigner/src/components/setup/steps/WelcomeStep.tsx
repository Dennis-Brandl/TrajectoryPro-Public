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

import { Button } from '@mission/ui'

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Welcome — let's set up Trajectory Pro Designer</h2>
      <p className="text-sm text-muted-foreground">
        This one-time setup creates the first administrator account, your first team, and the starting roles. You can
        change all of it later in Administration.
      </p>
      <div className="flex justify-end">
        <Button onClick={onNext}>Get started</Button>
      </div>
    </div>
  )
}
