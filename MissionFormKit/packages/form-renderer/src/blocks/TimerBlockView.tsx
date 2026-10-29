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
import { useEffect, useRef, useState } from 'react'
import type { TimerBlock } from '@mission/form-schema'
import { useFormRenderer } from '../context'
import { FieldLabel, sizeClasses } from './common'

function format(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds)
  const mm = String(Math.floor(clamped / 60)).padStart(2, '0')
  const ss = String(clamped % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

/**
 * Elapsed seconds derived from the wall clock, clamped to the run length.
 *
 * The 1s interval only *samples* this — it is not the source of truth. Browsers throttle
 * timers in hidden tabs (~1/min) and suspend them while a tablet sleeps, so counting ticks
 * under-reports real elapsed time. `elapsedSeconds` leaves here as process data for an
 * industrial batch workflow engine, so it must track the clock, not the tick count.
 */
function elapsedSince(startedAt: number, durationSeconds: number): number {
  return Math.max(0, Math.min(Math.floor((Date.now() - startedAt) / 1000), durationSeconds))
}

export function TimerBlockView({ block, onSettle }: { block: TimerBlock; onSettle?: (fieldName: string) => void }) {
  const { mode, emit } = useFormRenderer()
  const [elapsed, setElapsed] = useState(0)
  const [settled, setSettled] = useState(false)
  const settledRef = useRef(false)
  const startedAtRef = useRef(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Latest-refs for the two callbacks the interval fires. The interval is registered once
  // per run and must NOT be re-registered when the host re-renders — putting `emit`/`onSettle`
  // in the dep array below would restart the countdown on every keystroke. Reading them at
  // fire time instead keeps the run intact while un-pinning them from the mount render:
  // both close over the host's `values`, so a pinned instance re-validates an elapsed timer
  // against the values as of mount and reports fields the operator has since filled as missing.
  const emitRef = useRef(emit)
  emitRef.current = emit
  const onSettleRef = useRef(onSettle)
  onSettleRef.current = onSettle

  const clearTimer = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  useEffect(() => {
    if (mode !== 'run' || settledRef.current) return
    emitRef.current({ kind: 'timerState', fieldName: block.fieldName, state: 'running', elapsedSeconds: 0 })
    const startedAt = Date.now()
    startedAtRef.current = startedAt
    intervalRef.current = setInterval(() => {
      if (settledRef.current) return
      const next = elapsedSince(startedAt, block.durationSeconds)
      setElapsed(next)
      if (next < block.durationSeconds) return
      clearTimer()
      settledRef.current = true
      setSettled(true)
      emitRef.current({
        kind: 'timerState',
        fieldName: block.fieldName,
        state: 'elapsed',
        elapsedSeconds: block.durationSeconds,
      })
      onSettleRef.current?.(block.fieldName)
    }, 1000)
    return clearTimer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, block.id])

  const stop = () => {
    if (mode !== 'run' || settledRef.current) return
    settledRef.current = true
    setSettled(true)
    clearTimer()
    // Re-read the clock rather than trusting the last sample: a throttled tab can leave the
    // most recent tick up to a minute behind, and this number is reported process data.
    const at = elapsedSince(startedAtRef.current, block.durationSeconds)
    setElapsed(at)
    emit({ kind: 'timerState', fieldName: block.fieldName, state: 'stopped', elapsedSeconds: at })
    onSettle?.(block.fieldName)
  }

  const shown =
    mode === 'edit'
      ? block.direction === 'countdown'
        ? block.durationSeconds
        : 0
      : block.direction === 'countdown'
        ? block.durationSeconds - elapsed
        : elapsed

  return (
    <div className={`tfk-timer ${sizeClasses(block.size, block.sizeAt, 'md')}`}>
      <FieldLabel label={block.label} required={false} />
      <div className="tfk-timer-display">{format(shown)}</div>
      {!settled && (
        <button type="button" className="tfk-button tfk-button-secondary" onClick={stop}>
          Stop
        </button>
      )}
    </div>
  )
}
