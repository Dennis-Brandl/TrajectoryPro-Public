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
import type { ButtonBarStyle } from '@mission/form-schema'
import { JOB_DEFAULT_LABEL, signedLabel } from '@mission/form-schema'
import { FormRendererContext, useFormRenderer, type ButtonJobs } from './context'
import { sizeClasses, useAuthoredColor } from './blocks/common'

export interface StepButtonBarProps {
  kind: 'continue' | 'yesno'
  barStyle: ButtonBarStyle
  /** Labels + enabled + signed, as the host builds them. */
  jobs: ButtonJobs
  onPress(job: 'continue' | 'yes' | 'no'): void
  /** null / absent = not shown. */
  back?: { onBack(): void; disabled: boolean } | null
  stop?: { onStop(): void; disabled: boolean } | null
  /** Surface the bar sits on; authored colors unreadable on it are dropped. Absent = no guard. */
  surfaceColor?: string
  /**
   * The host's own decision whether this is a narrow screen on which it shows Back and Stop
   * elsewhere: true = the bar leaves them out, false = the bar always shows them. Absent = the
   * bar decides by its own width (below 600 px it hides them). A host that shows its own copies
   * should decide here from the same width it uses for those, so they appear exactly once.
   */
  compact?: boolean
}

type Job = 'continue' | 'yes' | 'no'

/** The step's fixed button row: Back on the left, the step's buttons centered, Stop on the right. */
export function StepButtonBar({ surfaceColor, ...props }: StepButtonBarProps) {
  const outer = useFormRenderer()
  if (surfaceColor === undefined) return <StepButtonBarView {...props} />
  return (
    <FormRendererContext.Provider value={{ ...outer, surfaceColor }}>
      <StepButtonBarView {...props} />
    </FormRendererContext.Provider>
  )
}

function StepButtonBarView({
  kind,
  barStyle,
  jobs,
  onPress,
  back: backIn,
  stop: stopIn,
  compact,
}: Omit<StepButtonBarProps, 'surfaceColor'>) {
  const order: Job[] = kind === 'yesno' ? ['yes', 'no'] : ['continue']
  const colorOf = (job: Job) => (job === 'yes' ? barStyle.yesColor : job === 'no' ? barStyle.noColor : barStyle.color)
  const back = compact ? null : backIn
  const stop = compact ? null : stopIn
  return (
    <div className="tfk-step-bar" data-compact={compact === undefined ? undefined : String(compact)}>
      <div className="tfk-step-bar-inner">
        <div className="tfk-step-bar-left">
          {back && (
            <button
              type="button"
              className="tfk-step-bar-aux tfk-step-bar-back"
              disabled={back.disabled || undefined}
              onClick={back.onBack}
            >
              Back
            </button>
          )}
        </div>
        <div className="tfk-step-bar-main">
          {order.map((job) => (
            <BarButton
              key={job}
              job={job}
              jobs={jobs}
              color={colorOf(job)}
              sizeClass={sizeClasses(barStyle.size, undefined, 'md')}
              onPress={onPress}
            />
          ))}
        </div>
        <div className="tfk-step-bar-right">
          {stop && (
            <button
              type="button"
              className="tfk-step-bar-aux tfk-step-bar-stop"
              disabled={stop.disabled || undefined}
              onClick={stop.onStop}
            >
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** One job button; its authored color goes through the same contrast guard as a form button. */
function BarButton(props: {
  job: Job
  jobs: ButtonJobs
  color: string | undefined
  sizeClass: string
  onPress(job: Job): void
}) {
  const { job, jobs, sizeClass, onPress } = props
  const color = useAuthoredColor(props.color)
  const state = jobs[job]
  let label = state.label.trim() || JOB_DEFAULT_LABEL[job]
  if (jobs.signed && job !== 'no') label = signedLabel(label)
  const disabled = state.enabled === false
  return (
    <button
      type="button"
      className={`tfk-button tfk-button-primary tfk-step-bar-btn ${sizeClass}`}
      style={color && !disabled ? { background: color } : undefined}
      disabled={disabled || undefined}
      aria-describedby={state.describedBy}
      aria-keyshortcuts={job === 'continue' ? 'Control+Enter' : undefined}
      onClick={() => onPress(job)}
    >
      {label}
    </button>
  )
}
