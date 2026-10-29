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

// Radix Select items cannot carry a null value — same INHERIT sentinel pattern as
// DispatchPolicySelect.
const INHERIT_VALUE = 'inherit';
const ON = 'on';
const OFF = 'off';

type AutoClaimSelectProps = {
  value: boolean | null;
  onChange: (value: boolean | null) => Promise<void> | void;
  disabled?: boolean;
};

// Auto-claim chains (spec 2026-08-14 D4): workflow-level override of the work center's
// autoClaim default. On = follow-on steps in the same parent/child workflow scope are
// pre-claimed for the operator who claimed the previous one.
export function AutoClaimSelect({ value, onChange, disabled }: AutoClaimSelectProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor="auto-claim" className="text-base">Auto-claim follow-on steps</Label>
      <Select
        value={value === null ? INHERIT_VALUE : value ? ON : OFF}
        onValueChange={(v) => onChange(v === INHERIT_VALUE ? null : v === ON)}
        disabled={disabled}
      >
        <SelectTrigger id="auto-claim" className="w-full" aria-label="Auto-claim follow-on steps">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={INHERIT_VALUE}>Inherit work-center default</SelectItem>
          <SelectItem value={ON}>On</SelectItem>
          <SelectItem value={OFF}>Off</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Later steps in the same workflow are claimed for the operator who claimed the previous one</p>
    </div>
  );
}
