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
import type { ESignatureBlock, SignatureDraft } from '@mission/form-schema'
import { useFormRenderer } from '../context'

const EMPTY_DRAFT: SignatureDraft = { loginName: '', password: '' }

/**
 * E-signature (spec 2026-09-06 D2): the fields live in the form, the host's chrome signs.
 * The draft is host-owned (context.signature) and never enters `values`; every keystroke
 * emits `signature` and the provider follows it with `validation` (same as fieldChange).
 */
export function ESignatureBlockView({ block }: { block: ESignatureBlock }) {
  const { emit, signature, signatureError, signatureHint } = useFormRenderer()
  const draft = signature ?? EMPTY_DRAFT
  const loginId = `${block.id}-login`
  const passwordId = `${block.id}-password`
  const errorId = `${block.id}-error`
  const update = (patch: Partial<SignatureDraft>) =>
    emit({ kind: 'signature', blockId: block.id, loginName: draft.loginName, password: draft.password, ...patch })

  return (
    <fieldset className="tfk-fieldset tfk-esig" aria-describedby={signatureError ? errorId : undefined}>
      <legend className="tfk-label">{block.label || 'E-signature'}</legend>
      {block.meaning && <p className="tfk-esig-meaning">{block.meaning}</p>}
      <p className="tfk-hint">{block.roleName ? `Sign as: ${block.roleName}` : 'Any member of this work center'}</p>
      {signatureHint && <p className="tfk-hint">{signatureHint}</p>}
      <div className="tfk-field">
        <label className="tfk-label" htmlFor={loginId}>
          Login name
        </label>
        <input
          id={loginId}
          className="tfk-control"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-required="true"
          value={draft.loginName}
          onChange={(e) => update({ loginName: e.target.value })}
        />
      </div>
      <div className="tfk-field">
        <label className="tfk-label" htmlFor={passwordId}>
          Password
        </label>
        <input
          id={passwordId}
          className="tfk-control"
          type="password"
          autoComplete="new-password"
          aria-required="true"
          value={draft.password}
          onChange={(e) => update({ password: e.target.value })}
        />
      </div>
      {signatureError && (
        <p id={errorId} className="tfk-error" role="alert">
          {signatureError}
        </p>
      )}
    </fieldset>
  )
}
