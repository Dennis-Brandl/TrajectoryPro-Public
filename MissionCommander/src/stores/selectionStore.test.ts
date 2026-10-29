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
import { describe, it, expect, beforeEach } from 'vitest';
import { useSelectionStore } from './selectionStore';

beforeEach(() => {
  useSelectionStore.setState({
    activeHierarchy: 'work_center', selectedWorkCenterId: null,
    selectedUserId: null, selectedRoleId: null,
    selectedWorkflowId: null, selectedEnvironmentId: null,
  });
});

describe('selectionStore user/role selection', () => {
  it('selectUser and selectRole set their ids independently', () => {
    useSelectionStore.getState().selectUser('u1');
    useSelectionStore.getState().selectRole('r1');
    expect(useSelectionStore.getState().selectedUserId).toBe('u1');
    expect(useSelectionStore.getState().selectedRoleId).toBe('r1');
    expect(useSelectionStore.getState().selectedWorkCenterId).toBeNull();
  });

  it('setHierarchy switches the active hierarchy without clearing selections', () => {
    useSelectionStore.getState().selectUser('u1');
    useSelectionStore.getState().setHierarchy('user');
    expect(useSelectionStore.getState().activeHierarchy).toBe('user');
    expect(useSelectionStore.getState().selectedUserId).toBe('u1');
  });

  it('selectUser(null) clears the selection', () => {
    useSelectionStore.getState().selectUser('u1');
    useSelectionStore.getState().selectUser(null);
    expect(useSelectionStore.getState().selectedUserId).toBeNull();
  });
});

describe('selectionStore workflow/environment selection', () => {
  it('selectWorkflow and selectEnvironment set their ids independently', () => {
    useSelectionStore.getState().selectWorkflow('wf1');
    useSelectionStore.getState().selectEnvironment('e1');
    expect(useSelectionStore.getState().selectedWorkflowId).toBe('wf1');
    expect(useSelectionStore.getState().selectedEnvironmentId).toBe('e1');
    expect(useSelectionStore.getState().selectedWorkCenterId).toBeNull();
  });

  it('setHierarchy accepts the two artifact hierarchies without clearing selections', () => {
    useSelectionStore.getState().selectWorkflow('wf1');
    useSelectionStore.getState().setHierarchy('environment');
    expect(useSelectionStore.getState().activeHierarchy).toBe('environment');
    expect(useSelectionStore.getState().selectedWorkflowId).toBe('wf1');
  });

  it('selectWorkflow(null) clears the selection', () => {
    useSelectionStore.getState().selectWorkflow('wf1');
    useSelectionStore.getState().selectWorkflow(null);
    expect(useSelectionStore.getState().selectedWorkflowId).toBeNull();
  });
});

describe('selectionStore has no library hierarchy', () => {
  it('exposes neither the library selection nor its setter', () => {
    // The Hierarchy union is the contract HierarchyPane and DetailPanel switch over. A
    // stray 'library' member would let a dead branch keep compiling long after the pane
    // it rendered was deleted.
    const s = useSelectionStore.getState();
    expect(Object.keys(s)).not.toContain('selectedLibraryId');
    expect(Object.keys(s)).not.toContain('selectLibrary');
  });
});
