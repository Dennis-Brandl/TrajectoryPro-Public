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
import { useCallback, type ReactNode } from 'react';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { usePolledView } from '@/lib/hooks/usePolledView';

const POLL_MS = 5000;
const TH = 'px-2 py-1 text-left text-xs font-medium text-muted-foreground';
const TD = 'px-2 py-1 align-top';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr>{head.map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-border">{r.map((c, j) => <td key={j} className={TD}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** Resources and value properties of one runtime, read only: no verbs, no edits. */
export function ReadOnlySharedState({ instanceId }: { instanceId: string }) {
  const resFetch = useCallback(() => runtimeWorkflows.resources(instanceId), [instanceId]);
  const valFetch = useCallback(() => runtimeWorkflows.valueProperties(instanceId), [instanceId]);
  const { view: res } = usePolledView(`xo-resources:${instanceId}`, resFetch, 'Could not load resources', POLL_MS);
  const { view: val } = usePolledView(`xo-values:${instanceId}`, valFetch, 'Could not load value properties', POLL_MS);

  const resRows: ReactNode[][] = res
    ? [
      ...res.workflow.map((r) => [r.name, r.resourceType, 'Workflow', r.summary.state]),
      ...res.environment.map((r) => [r.name, r.resourceType, 'Environment', r.summary.state]),
    ]
    : [];
  const valRows: ReactNode[][] = val
    ? [
      ...Object.entries(val.root).map(([k, v]) => [k, v, 'Workflow']),
      ...val.children.flatMap((c) => Object.entries(c.values).map(([k, v]) => [k, v, `Child · ${c.childName ?? c.childOid}`])),
      ...val.shared.map((s) => [`${s.propertyName}.${s.entryName}`, s.value, 'Shared (environment)']),
    ]
    : [];

  return (
    <div className="space-y-4">
      <Section title="Resources">
        {res ? <Table head={['Name', 'Type', 'Scope', 'State']} rows={resRows} empty="This runtime uses no resources" />
          : <p className="text-sm text-muted-foreground">Loading…</p>}
      </Section>
      <Section title="Value properties">
        {val ? <Table head={['Property', 'Value', 'Scope']} rows={valRows} empty="No value properties" />
          : <p className="text-sm text-muted-foreground">Loading…</p>}
      </Section>
    </div>
  );
}
