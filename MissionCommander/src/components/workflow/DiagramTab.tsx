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
import { WorkflowDiagram } from './diagram/WorkflowDiagram';
import { useWorkflowDiagram } from './useWorkflowDiagram';

/**
 * Owns the diagram fetch so it happens only while the Diagram tab is actually open.
 *
 * WorkflowDetail used to call useWorkflowDiagram in its own body, so the request fired for
 * every workflow selection whether or not the tab was ever opened — a failure then toasted
 * for a view the user never saw, and a single network blip produced two toasts.
 *
 * Radix unmounts an inactive TabsContent (ui/tabs.tsx passes no forceMount), so putting the
 * hook in a child of that content is all the gating needed. Deliberately NOT done by making
 * Tabs controlled and passing null when inactive: useResourceView's own header comment
 * records that keep-stale-while-revalidating exists so uncontrolled Tabs survive a refetch,
 * and passing id === null clears the view anyway — more machinery, identical behaviour.
 */
export function DiagramTab({ workflowId }: { workflowId: string }) {
  const { view, loading, error } = useWorkflowDiagram(workflowId);
  if (loading && !view) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error && !view) return <p className="text-sm text-destructive">Failed to load diagram</p>;
  if (!view) return null;
  return <WorkflowDiagram root={view.root} />;
}
