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

import { useNavigate } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';

// Returns to the picker without clearing the remembered work center.
export function SwitcherButton({ name }: { name: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => { void navigate({ to: '/', search: { pick: true } }); }}
      className="flex min-h-11 items-center xl:min-h-9 gap-1 rounded-md px-2 text-sm font-semibold hover:bg-muted"
    >
      <span className="truncate">{name}</span>
      <ChevronDown className="size-4 shrink-0" aria-hidden />
    </button>
  );
}

/** Phones: the top bar has no room for the switcher, so the work center gets its own row. */
export function PhoneWorkCenterBar({ name }: { name: string }) {
  return (
    <div data-testid="xo-phone-wc-bar" className="flex shrink-0 items-center gap-1 border-b border-border px-2">
      <span className="shrink-0 pl-2 text-xs text-muted-foreground">Work center</span>
      <div className="min-w-0 flex-1"><SwitcherButton name={name} /></div>
    </div>
  );
}
