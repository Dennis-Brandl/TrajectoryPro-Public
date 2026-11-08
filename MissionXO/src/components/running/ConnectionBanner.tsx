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
import { WifiOff } from 'lucide-react';

const pad = (n: number) => String(n).padStart(2, '0');

export function ConnectionBanner({ stale, lastUpdatedAt }: { stale: boolean; lastUpdatedAt: Date | null }) {
  if (!stale) return null;
  const at = lastUpdatedAt ? ` — last updated ${pad(lastUpdatedAt.getHours())}:${pad(lastUpdatedAt.getMinutes())}` : '';
  return (
    <div role="status" className="flex items-center gap-2 border-b border-status-warn bg-status-warn-bg px-4 py-2 text-sm text-status-warn-fg">
      <WifiOff className="size-4 shrink-0" />
      <span>{`Not connected${at}`}</span>
    </div>
  );
}
