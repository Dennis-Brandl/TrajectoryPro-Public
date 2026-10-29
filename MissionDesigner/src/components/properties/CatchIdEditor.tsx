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

import { useEffect, useState } from 'react'

interface Props {
  value: string
  onChange: (id: string) => void
  takenIds: string[]
  hideHeading?: boolean
}

export function CatchIdEditor({ value, onChange, takenIds, hideHeading = false }: Props) {
  const [local, setLocal] = useState(value)
  useEffect(() => {
    setLocal(value)
  }, [value])
  const trimmed = local.trim()
  const duplicate = trimmed !== '' && trimmed !== value && takenIds.includes(trimmed)
  const commit = () => {
    if (trimmed && !duplicate && trimmed !== value) onChange(trimmed)
  }

  return (
    <section className={hideHeading ? '' : 'mt-3 border-t pt-3'}>
      {!hideHeading && <h4 className="text-xs font-semibold text-muted-foreground">CATCH id</h4>}
      <div className="mt-1 flex items-center">
        <input
          aria-label="catch_id"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          className={`rounded border px-2 py-0.5 text-xs ${duplicate ? 'border-red-500' : ''}`}
        />
        {duplicate && <span className="ml-2 text-[10px] text-red-600">catch_id must be unique</span>}
      </div>
    </section>
  )
}
