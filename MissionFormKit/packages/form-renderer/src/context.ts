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
import { createContext, useContext } from 'react'
import type { FormEvent, FormValues, SignatureDraft } from '@mission/form-schema'

/** Host-supplied state for one job button. */
export interface ButtonJobState {
  enabled: boolean
  /** The word the host shows for this job when the author typed none. */
  label: string
  /** id of the element that explains why the button is disabled. */
  describedBy?: string
}

export interface ButtonJobs {
  continue: ButtonJobState
  yes: ButtonJobState
  no: ButtonJobState
  /** A signature is required for the step: Continue/Yes labels become "Sign & ...". No is exempt. */
  signed: boolean
}

export interface FormRendererContextValue {
  mode: 'run' | 'edit'
  values: FormValues
  /** Resolve a non-URL image src key to a displayable URL/data URI. */
  resolveImage: (srcKey: string) => string | undefined
  /** Emit a workflow event. No-op in edit mode (enforced by the provider). */
  emit: (event: FormEvent) => void
  /** Host-owned e-signature draft (spec 2026-09-06 D3); null when the host has none. */
  signature: SignatureDraft | null
  /** Server-side signature failure shown inline by the esignature block. */
  signatureError: string | null
  /** Advisory shown by the esignature block, e.g. who must sign. */
  signatureHint: string | null
  /** The resolved form surface colour; authored colours below 3:1 against it are dropped (spec §14). */
  surfaceColor: string | null
  /** Host state for job buttons; null when the host passes none. */
  buttonJobs: ButtonJobs | null
}

export const FormRendererContext = createContext<FormRendererContextValue>({
  mode: 'run',
  values: {},
  resolveImage: () => undefined,
  emit: () => {},
  signature: null,
  signatureError: null,
  signatureHint: null,
  surfaceColor: null,
  buttonJobs: null,
})

export function useFormRenderer(): FormRendererContextValue {
  return useContext(FormRendererContext)
}
