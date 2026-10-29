// @vitest-environment jsdom
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
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useSelectionStore } from '@/stores/selectionStore';
import { DetailPanel } from './DetailPanel';

afterEach(cleanup);

describe('DetailPanel', () => {
  it('no selected work center shows the create hint', () => {
    useSelectionStore.setState({ activeHierarchy: 'work_center', selectedWorkCenterId: null });
    render(<DetailPanel />);
    expect(screen.getByText('Select a work center in the tree, or create one.')).toBeInTheDocument();
  });
});
