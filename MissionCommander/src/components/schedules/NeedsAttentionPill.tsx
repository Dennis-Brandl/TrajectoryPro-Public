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
import type { RuntimeScheduleView } from '@/lib/api/types';
import { needsAttention, needsAttentionText } from './schedule-format';

/** Warning-colored pill with words, never an icon alone. Renders nothing when all is well. */
export function NeedsAttentionPill({ schedule }: { schedule: Pick<RuntimeScheduleView, 'needsAttention'> }) {
  if (!needsAttention(schedule)) return null;
  return (
    <span className="shrink-0 rounded bg-status-warn-bg px-1.5 py-0.5 text-[11px] font-medium text-status-warn-fg"
      title={needsAttentionText(schedule)}>
      Needs attention
    </span>
  );
}
