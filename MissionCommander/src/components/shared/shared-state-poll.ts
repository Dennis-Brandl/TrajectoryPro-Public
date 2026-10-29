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

/** Poll cadence for the shared-state tables (spec §6.6): the same 2 s the Runtime pane uses
 *  (RUNTIME_PANE_POLL_MS in runtime/RuntimeWorkflowDetail.tsx). Its own constant so the
 *  Environment and Work Center panes do not import a runtime component to get a number. */
export const SHARED_STATE_POLL_MS = 2000;
