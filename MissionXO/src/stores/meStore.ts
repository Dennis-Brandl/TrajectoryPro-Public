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
import type { MePrincipal } from '@/lib/api/types';
import { me as fetchMe } from '@/lib/api/me';
import { usePrincipalStore } from '@/stores/principalStore';

type State = { me: MePrincipal | null; setMe: (me: MePrincipal) => void; refresh: () => Promise<void> };

export const useMeStore = create<State>((set, get) => ({
  me: null,
  // Commander components XO reuses read the principal from Commander's own store.
  setMe: (me) => { set({ me }); usePrincipalStore.getState().setPrincipal(me); },
  refresh: async () => { get().setMe(await fetchMe()); },
}));
