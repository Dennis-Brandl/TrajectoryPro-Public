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
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { WorkCenterPicker } from '~/components/WorkCenterPicker';

export const Route = createFileRoute('/_xo/')({
  validateSearch: (search: Record<string, unknown>): { pick?: boolean } =>
    search.pick === true || search.pick === 'true' || search.pick === 1 ? { pick: true } : {},
  component: Picker,
});

function Picker() {
  const navigate = useNavigate();
  const { pick } = Route.useSearch();
  return (
    <div className="h-full overflow-auto">
      <WorkCenterPicker pick={pick} onChoose={(wcId) => { void navigate({ to: '/wc/$wcId/running', params: { wcId }, replace: true }); }} />
    </div>
  );
}
