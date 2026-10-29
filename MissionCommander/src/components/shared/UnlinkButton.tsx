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
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RequiresTooltip } from '@/components/shared/RequiresTooltip';

// Shared '✕' unlink button for WorkCenterDetail + WorkflowDetail + EnvironmentDetail.
// Reconciles the three former copies to one signature; the busy guard prevents a double-
// fire while the mutation is in flight.
export function UnlinkButton({ label, onClick, disabled = false }: { label: string; onClick: () => Promise<void> | void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <RequiresTooltip reason={disabled ? 'Requires work_center:link' : undefined}>
      <Button type="button" variant="ghost" size="sm" aria-label={label} disabled={disabled || busy}
        title={disabled ? 'Requires work_center:link' : undefined}
        onClick={async () => { setBusy(true); try { await onClick(); } finally { setBusy(false); } }}>✕</Button>
    </RequiresTooltip>
  );
}
