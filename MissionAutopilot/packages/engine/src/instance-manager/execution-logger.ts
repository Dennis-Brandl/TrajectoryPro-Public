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

import type { Instance } from '@mission/autopilot-storage'
import {
  InstanceRepository,
  ActionRepository,
  EnvironmentRepository,
  CodeVersionRepository,
  LogRepository,
  SettingsRepository,
} from '@mission/autopilot-storage'

export class ExecutionLogger {
  constructor(
    private readonly actionRepo: ActionRepository,
    private readonly environmentRepo: EnvironmentRepository,
    private readonly codeVersionRepo: CodeVersionRepository,
    private readonly logRepo: LogRepository,
    private readonly settingsRepo: SettingsRepository,
    private readonly instanceRepo: InstanceRepository
  ) {}

  async writeLog(instanceId: string, terminalState: string, instance: Instance): Promise<void> {
    const action = await this.actionRepo.findByOid(instance.action_oid)
    const environment = await this.environmentRepo.findByOid(instance.environment_oid)
    const logMaxSize = (await this.settingsRepo.getNumericValue('log_max_size')) ?? 10000

    const completedAt = instance.completed_at ?? new Date().toISOString()
    const startedAt = instance.started_at ?? instance.created_at // Fallback per research Pitfall 4
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime()

    // Build code_versions_used from pinned versions
    const codeVersionsUsed: Record<string, number> = {}
    const pinnedVersions = instance.pinned_code_versions as Array<{
      state: string
      code_version_id: string
    }>
    for (const pinned of pinnedVersions) {
      const version = await this.codeVersionRepo.findById(pinned.code_version_id)
      if (version) {
        codeVersionsUsed[pinned.state] = version.version_number
      }
    }

    // Build rich state_executions from state_history + execution metadata. The
    // Console renders one row per entry with state name, code version (or "no
    // code"), entered_at, and duration. The runtime appends a duplicate entry
    // to state_history when stamping completed_at on a terminal state — those
    // adjacent duplicates collapse so the Console doesn't show COMPLETED twice
    // with a 0ms duration.
    const stateHistory = instance.state_history as Array<{ state: string; timestamp: string }>
    const executedSet = new Set(instance.states_with_code_executed as string[])
    const collapsed: Array<{ state: string; timestamp: string }> = []
    for (const entry of stateHistory) {
      const prev = collapsed[collapsed.length - 1]
      if (!prev || prev.state !== entry.state) collapsed.push(entry)
    }
    const stateExecutions = collapsed.map((entry, i) => {
      const nextTimestamp = collapsed[i + 1]?.timestamp ?? completedAt
      const duration = new Date(nextTimestamp).getTime() - new Date(entry.timestamp).getTime()
      return {
        state: entry.state,
        had_code: executedSet.has(entry.state),
        code_version_number: codeVersionsUsed[entry.state] ?? null,
        entered_at: entry.timestamp,
        duration_ms: Number.isFinite(duration) ? duration : null,
      }
    })

    const entry = await this.logRepo.insert(
      {
        runtime_action_instance_id: instanceId,
        action_oid: instance.action_oid,
        action_name: action?.local_id ?? instance.action_oid,
        environment_oid: instance.environment_oid,
        environment_name: environment?.local_id ?? '',
        workflow_instance_id: instance.workflow_instance_id,
        step_oid: instance.step_oid,
        input_parameters: instance.input_parameters,
        output_parameters: instance.output_parameters,
        states_executed: stateExecutions,
        code_versions_used: codeVersionsUsed,
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: durationMs,
        final_status: terminalState as 'COMPLETED' | 'ABORTED' | 'STOPPED',
        error: instance.error ?? undefined,
      },
      logMaxSize
    )

    // Insert first, claim second: exactly one writer keeps its row when two
    // terminal passes overlap on the same instance — the atomic
    // `UPDATE … WHERE NOT is_logged` decides the winner, and the loser deletes
    // the row it just inserted. This ordering means a crash between insert and
    // claim leaves the row in place with is_logged still false, so the
    // instance is retained (and its log preserved) rather than silently lost —
    // claiming first and inserting second would instead leave is_logged=true
    // with no log row, and InstanceRepository.cleanup() would later delete the
    // instance with nothing to show it ever ran.
    const claimed = await this.instanceRepo.markLogged(instanceId)
    if (!claimed) {
      await this.logRepo.deleteById(entry.id)
      return
    }
  }
}
