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

export interface BottomNavProps {
  selected: 'inbox' | 'workflows'
  inboxCount: number
  workflowsCount: number
  onInbox(): void
  onWorkflows(): void
}

// Phone (spec §5.1): Inbox and Workflows move from the tab strip to the bottom of the screen.
// Shown on those two screens only; a task in front has its own app bar instead. The ids and
// labels are the tab strip's, so the panels' aria-labelledby still names them.
export function BottomNav({ selected, inboxCount, workflowsCount, onInbox, onWorkflows }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="Pilot">
      <div role="tablist">
        <button
          type="button"
          role="tab"
          id="tab-inbox"
          aria-selected={selected === 'inbox'}
          aria-controls="panel-inbox"
          onClick={onInbox}
        >
          Inbox{inboxCount > 0 ? ` (${inboxCount})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          id="tab-workflows"
          aria-selected={selected === 'workflows'}
          aria-controls="panel-workflows"
          onClick={onWorkflows}
        >
          Workflows{workflowsCount > 0 ? ` (${workflowsCount})` : ''}
        </button>
      </div>
    </nav>
  )
}
