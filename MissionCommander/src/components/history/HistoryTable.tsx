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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RuntimeStatusBadge } from '@/components/runtime/RuntimeStatusBadge';
import { formatDuration } from './format-duration';
import type { RuntimeHistorySummary } from '@/lib/api/types';

/** Finished-run log table (phase 7). Each row is itself the open control — a keyboard- and
 *  click-activatable `<tr role="button">` named "History {runtimeLabel}" — rather than a
 *  nested button-in-cell, so the whole row is one hit target and the accessible name reads
 *  like a sentence ("History RW-7", or "History MIX-20261007-001" under a configured
 *  template), matching the detail dialog's own runtimeLabel heading (Task 7, Task 10).
 *  `finalState` (RuntimeHistoryFinalState) is a subset of RuntimeStatusBadge's
 *  RuntimeWorkflowStatus vocabulary, so it renders through the SAME badge/tone the Runtime
 *  tab uses — no separate history-only badge needed. */
export function HistoryTable({ rows, onOpen, showWorkCenter }: {
  rows: RuntimeHistorySummary[];
  onOpen: (id: string) => void;
  showWorkCenter?: boolean;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No history</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>RW</TableHead>
          <TableHead>Workflow</TableHead>
          {showWorkCenter && <TableHead>Work Center</TableHead>}
          <TableHead>Status</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Finished</TableHead>
          <TableHead>Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            role="button"
            tabIndex={0}
            aria-label={`History ${row.runtimeLabel}`}
            className="cursor-pointer"
            onClick={() => onOpen(row.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen(row.id);
              }
            }}
          >
            <TableCell className="tabular-nums">{row.runtimeLabel}</TableCell>
            <TableCell>
              {row.masterName} <span className="text-muted-foreground">v{row.masterVersion}</span>
            </TableCell>
            {showWorkCenter && <TableCell>{row.workCenterName}</TableCell>}
            <TableCell><RuntimeStatusBadge status={row.finalState} /></TableCell>
            <TableCell>{row.startedAt ? new Date(row.startedAt).toLocaleString() : '—'}</TableCell>
            <TableCell>{new Date(row.finishedAt).toLocaleString()}</TableCell>
            <TableCell>{formatDuration(row.startedAt, row.finishedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
