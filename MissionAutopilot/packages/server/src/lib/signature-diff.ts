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

/**
 * Compares two action input/output signatures the way authored state code
 * experiences them: by parameter id and value type only. Defaults,
 * descriptions and output target wiring do not change what `inputs[...]` /
 * `outputs[...]` the code can read or write, so they are ignored.
 *
 * Returns human-readable change lines, in incoming order for additions and
 * type changes, followed by removals; an empty array means "same signature".
 */

interface ParamSignature {
  id: string
  valueType: string
}

function toSignatures(specs: unknown): ParamSignature[] {
  if (!Array.isArray(specs)) return []
  const out: ParamSignature[] = []
  for (const spec of specs) {
    if (!spec || typeof spec !== 'object') continue
    const { id, value_type } = spec as { id?: unknown; value_type?: unknown }
    if (typeof id !== 'string' || id === '') continue
    out.push({ id, valueType: typeof value_type === 'string' ? value_type : '' })
  }
  return out
}

function diffSide(kind: 'input' | 'output', prev: unknown, next: unknown): string[] {
  const before = toSignatures(prev)
  const after = toSignatures(next)
  const beforeById = new Map(before.map((p) => [p.id, p]))
  const afterIds = new Set(after.map((p) => p.id))
  const lines: string[] = []

  for (const param of after) {
    const old = beforeById.get(param.id)
    if (!old) {
      lines.push(`${kind} \`${param.id}\` added (${param.valueType || 'untyped'})`)
    } else if (old.valueType !== param.valueType) {
      lines.push(
        `${kind} \`${param.id}\` type ${old.valueType || 'untyped'} → ${param.valueType || 'untyped'}`
      )
    }
  }
  for (const param of before) {
    if (!afterIds.has(param.id)) lines.push(`${kind} \`${param.id}\` removed`)
  }
  return lines
}

export function diffSignature(
  prevInputs: unknown,
  prevOutputs: unknown,
  nextInputs: unknown,
  nextOutputs: unknown
): string[] {
  return [
    ...diffSide('input', prevInputs, nextInputs),
    ...diffSide('output', prevOutputs, nextOutputs),
  ]
}
