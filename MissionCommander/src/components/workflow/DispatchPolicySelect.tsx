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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Radix Select items cannot carry a null value, so "inherit the work center's default" is
// encoded with this sentinel and mapped back to null on change — mirrors WorkCenterDialog's
// ROOT_VALUE pattern for its own parent-picker sentinel.
const INHERIT_VALUE = 'inherit';

const POLICY_OPTIONS = [
  { value: INHERIT_VALUE, label: 'Inherit work-center default' },
  { value: 'manual', label: 'Manual (pull only)' },
  { value: 'least_queued_steps', label: 'Least queued steps' },
  { value: 'highest_priority', label: 'Highest priority' },
  { value: 'round_robin', label: 'Round robin' },
  { value: 'fewest_active_instances', label: 'Fewest active instances' },
];

type DispatchPolicySelectProps = {
  value: string | null;
  onChange: (policy: string | null) => Promise<void> | void;
  disabled?: boolean;
};

// Phase 4a (spec 2026-08-03 §6): a workflow-level override of the engine's
// effectiveDispatchPolicy resolution (workflow override -> work_center.dispatch_policy
// default -> 'least_queued_steps'). Suggest-only — the engine records a preferred user on
// offers, but any eligible operator may still claim, hence the helper text below.
export function DispatchPolicySelect({ value, onChange, disabled }: DispatchPolicySelectProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor="dispatch-policy" className="text-base">Dispatch policy</Label>
      <Select
        value={value ?? INHERIT_VALUE}
        onValueChange={(v) => onChange(v === INHERIT_VALUE ? null : v)}
        disabled={disabled}
      >
        <SelectTrigger id="dispatch-policy" className="w-full" aria-label="Dispatch policy">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {POLICY_OPTIONS.map((policy) => (
            <SelectItem key={policy.value} value={policy.value}>{policy.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Suggests tasks to operators; any eligible operator may claim</p>
    </div>
  );
}
