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
import { ActivityRail } from './ActivityRail';
import { HierarchyPane } from './HierarchyPane';
import { DetailPanel } from './DetailPanel';
export function AppShell() {
  return (
    <div className="grid h-full grid-cols-[auto_20rem_1fr]">
      <ActivityRail />
      <aside className="min-h-0 overflow-auto border-r"><HierarchyPane /></aside>
      <main className="min-h-0 overflow-auto"><DetailPanel /></main>
    </div>
  );
}
