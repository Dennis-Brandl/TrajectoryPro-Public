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
import { workCenters } from '@/lib/api/work-centers';
import { useResourceView } from '@/lib/hooks/useResourceView';
import type { WorkCenterView } from '@/lib/api/types';

// Thin wrapper over the shared useResourceView (spec §7.1). Kept as a named hook so
// WorkCenterDetail's import is unchanged; the state-machine logic now lives in one place.
export function useWorkCenterView(id: string | null) {
  return useResourceView<WorkCenterView>(id, workCenters.get, 'Failed to load work center');
}
