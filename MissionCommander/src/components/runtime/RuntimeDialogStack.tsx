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
import { RuntimeDetailDialog } from './RuntimeDetailDialog';
import { HistoryDetailDialog } from '@/components/history/HistoryDetailDialog';
import type { CreatedRuntimeTarget } from '@/lib/api/types';

type Entry = { target: CreatedRuntimeTarget; backLabel: string | null };

/** Spec 2026-10-19 §A: a runtime dialog that can switch to a created runtime and come back.
 *  Only the top entry renders; "Back to <label>" pops. */
export function RuntimeDialogStack({ initial, onClose, onHistoryDeleted }: {
  initial: CreatedRuntimeTarget; onClose: () => void; onHistoryDeleted?: () => void;
}) {
  const [stack, setStack] = useState<Entry[]>([{ target: initial, backLabel: null }]);
  const depth = stack.length - 1;
  const top = stack[depth];
  const onOpenChild = (t: CreatedRuntimeTarget, fromLabel: string) =>
    setStack((s) => [...s, { target: t, backLabel: fromLabel }]);
  const back = top.backLabel !== null
    ? { label: top.backLabel, onBack: () => setStack((s) => s.slice(0, -1)) }
    : undefined;
  const key = `${top.target.kind}:${top.target.id}:${depth}`;
  return top.target.kind === 'live'
    ? <RuntimeDetailDialog key={key} id={top.target.id} onClose={onClose} onOpenChild={onOpenChild} back={back} />
    : <HistoryDetailDialog key={key} id={top.target.id} onClose={onClose}
        onDeleted={() => onHistoryDeleted?.()} onOpenChild={onOpenChild} back={back} />;
}
