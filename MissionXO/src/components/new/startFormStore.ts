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
import { create } from 'zustand';

// Typed starting-parameter values per workflow, kept outside the component so a rotation or
// layout switch (which remounts the form) does not lose them. An entry exists only once the
// user has typed.
type State = {
  values: Record<string, Record<string, string>>;
  set: (workflowId: string, values: Record<string, string>) => void;
  clear: (workflowId: string) => void;
};

export const useStartFormStore = create<State>((set) => ({
  values: {},
  set: (workflowId, values) => set((s) => ({ values: { ...s.values, [workflowId]: values } })),
  clear: (workflowId) => set((s) => {
    const { [workflowId]: _drop, ...rest } = s.values;
    return { values: rest };
  }),
}));
