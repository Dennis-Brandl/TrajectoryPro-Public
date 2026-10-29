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
import type { StepSignatureView } from '@/lib/api/types';

/** Spec 2026-09-06 §7: every e-signature attempt on the run, oldest first, behind the same
 *  ghost-button toggle the trace uses. Hidden entirely at zero. Failed rows are muted. */
export function SignaturesSection({ signatures }: { signatures: StepSignatureView[] }) {
  const [open, setOpen] = useState(false);
  if (signatures.length === 0) return null;
  return (
    <div>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide signatures' : `Show signatures (${signatures.length})`}
      </Button>
      {open && (
        <ol className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {signatures.map((s) => (
            <li key={s.id} className={s.outcome === 'failed' ? 'opacity-60' : undefined}>
              {s.stepName} · {s.signerDisplayName ?? s.signerLoginName} ({s.signerLoginName}) · {s.roleName ?? 'any member'}
              {s.decision ? ` · ${s.decision}` : ''} · {new Date(s.signedAt).toLocaleString()}
              {s.outcome === 'failed' ? ` · failed: ${s.failureCode ?? 'unknown'}` : ''}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
