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
import { workflows } from '@/lib/api/workflows';
import { useResourceView } from '@/lib/hooks/useResourceView';
import type { WorkflowDiagram } from '@/lib/api/types';

// Its own fetch, separate from useWorkflowView: the diagram payload is a projection of
// spec_jsonb that the Overview and Environments tabs have no use for.
export function useWorkflowDiagram(id: string | null) {
  return useResourceView<WorkflowDiagram>(id, workflows.diagram, 'Failed to load diagram');
}
