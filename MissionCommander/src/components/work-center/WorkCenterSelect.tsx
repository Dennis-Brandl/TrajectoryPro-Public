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
import { useEffect, useState } from 'react';
import { workCenters } from '@/lib/api/work-centers';
import type { WcNode } from '@/lib/api/types';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * A flat work-center picker. Extracted from WorkCenterDialog's parent Select so the import
 * dialog can use the same control for BOTH of its pickers — the create-mode parent and the
 * merge-mode target (spec §9). Controlled on `string | null` rather than react-hook-form, so
 * plain useState callers work; ROOT_VALUE exists only because Radix forbids an empty value.
 * It is a purely internal sentinel — it never crosses this component's props boundary, so a
 * caller mapping its OWN sentinel (e.g. WorkCenterDialog's RHF field) at that same boundary
 * cannot collide or double-translate with this one.
 */
const ROOT_VALUE = '__root__';

export function WorkCenterSelect({ id, label, ariaLabel, value, onChange, allowRoot = false, rootLabel = '(root)', excludeId }: {
  id: string;
  // Visible <Label> text.
  label: string;
  // Accessible name for the Select trigger (what getByLabelText/aria queries find).
  // Deliberately separate from `label`: callers may need a short visible caption
  // ("Parent") that reads differently than the longer accessible name a test or
  // screen reader needs ("Parent work center") to disambiguate the control.
  // Defaults to `label` when the two coincide.
  ariaLabel?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  allowRoot?: boolean;
  // Product copy is never changed to suit code or tests: WorkCenterDialog's edit-mode Parent
  // field reparents an EXISTING work center, so its no-parent option must read "(root)" — the
  // default. ImportPackageDialog's create-mode parent picker instead describes what an import
  // WOULD do ("(as a new root)"), so it passes that wording explicitly. Never crosses this
  // component's props boundary in the other direction — each caller supplies its own text.
  rootLabel?: string;
  // Edit mode excludes the work center being edited from its own parent options — a
  // client-side guard against the trivial self-parent cycle (deeper cycles are the
  // server's job and surface as a 409/422 toast).
  excludeId?: string;
}) {
  const [options, setOptions] = useState<WcNode[]>([]);
  useEffect(() => {
    workCenters.list()
      .then(({ nodes }) => setOptions(excludeId ? nodes.filter((n) => n.id !== excludeId) : nodes))
      .catch(() => setOptions([]));
  }, [excludeId]);

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value ?? ROOT_VALUE}
        onValueChange={(v) => onChange(v === ROOT_VALUE ? null : v)}
      >
        <SelectTrigger id={id} className="w-full" aria-label={ariaLabel ?? label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowRoot && <SelectItem value={ROOT_VALUE}>{rootLabel}</SelectItem>}
          {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
