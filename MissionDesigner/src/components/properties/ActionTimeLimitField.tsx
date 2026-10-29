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

import { useId, useState } from 'react'
import { Input, Label } from '@mission/ui'
import { formatTimeLimitSeconds, parseTimeLimitSeconds } from '@/lib/action-proxy/default-timeout'

/** Optional per-step deadline for an ACTION PROXY step; blank means no limit. */
export function ActionTimeLimitField({
  timeoutMs,
  disabled,
  onChange,
}: {
  timeoutMs: number | undefined
  disabled: boolean
  onChange: (timeoutMs: number | undefined) => void
}) {
  const id = useId()
  const [text, setText] = useState(() => formatTimeLimitSeconds(timeoutMs))
  const [seen, setSeen] = useState(timeoutMs)
  const [invalid, setInvalid] = useState(false)

  // Re-seed from the prop during render (no effect) when it changes from outside.
  if (seen !== timeoutMs) {
    setSeen(timeoutMs)
    const parsed = parseTimeLimitSeconds(text)
    if (!(parsed.ok && parsed.timeoutMs === timeoutMs)) {
      setText(formatTimeLimitSeconds(timeoutMs))
      setInvalid(false)
    }
  }

  const handle = (value: string) => {
    setText(value)
    const parsed = parseTimeLimitSeconds(value)
    if (parsed.ok) {
      setInvalid(false)
      onChange(parsed.timeoutMs)
    } else {
      setInvalid(true)
    }
  }

  return (
    <div className="space-y-0.5">
      <Label htmlFor={id} className="text-xs">
        Time limit (seconds)
      </Label>
      <Input
        id={id}
        inputMode="numeric"
        value={text}
        disabled={disabled}
        placeholder={disabled ? 'Choose an action first' : 'No limit'}
        onChange={(e) => handle(e.target.value)}
        className="h-7 text-sm"
      />
      <p className="text-xs text-muted-foreground">
        Leave blank to wait as long as the action takes. Stop or abort the runtime to give up.
      </p>
      {invalid && (
        <p role="alert" className="text-xs text-destructive">
          Enter a whole number of seconds, 1 or more.
        </p>
      )}
    </div>
  )
}
