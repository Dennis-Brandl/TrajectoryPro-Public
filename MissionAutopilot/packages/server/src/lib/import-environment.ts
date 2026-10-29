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
 * import-environment.ts — how an uploaded environment row is reconciled with
 * the environments already stored, before its actions are reconciled
 * (import-actions.ts).
 *
 * Designer's "Create New Version" on an environment clones it under a fresh
 * oid with the same name. That is the same environment to Mission Autopilot:
 *
 *   1. Match by oid → update in place (the old upsert).
 *   2. Otherwise, when exactly one stored environment carries the same
 *      `local_id` and the package itself lists that name only once, re-key
 *      the stored row to the incoming oid: create the new row from the
 *      package, re-point its actions, instance rows and execution-log
 *      history, delete the old row. Code, timeouts and import flags live on
 *      the action rows and follow. A stored environment whose oid another
 *      environment in the same package claims is never a fallback source.
 *   3. Otherwise create a new environment.
 *
 * The caller tears down the old oid's SSE property buses once the upload
 * transaction has committed.
 */
import type {
  ActionRepository,
  EnvironmentInput,
  EnvironmentRepository,
  InstanceRepository,
  LogRepository,
} from '@mission/autopilot-storage'

export interface EnvironmentImportRepos {
  environments: EnvironmentRepository
  actions: ActionRepository
  instances: InstanceRepository
  log: LogRepository
}

export interface EnvironmentSyncOptions {
  /** Names listed more than once in the package being imported — never re-keyed. */
  duplicateIncomingNames?: ReadonlySet<string>
  /**
   * Every environment oid the package carries. A stored environment whose oid
   * is claimed by ANOTHER incoming environment is matched by that oid and must
   * not be taken as a name-fallback source (the user renamed it and created a
   * fresh environment under the old name, in one export).
   */
  incomingOids?: ReadonlySet<string>
}

export interface EnvironmentSyncResult {
  created: boolean
  /** The oid the environment was re-keyed from, when the name fallback fired. */
  rekeyedFrom: string | null
}

export async function syncEnvironmentRow(
  repos: EnvironmentImportRepos,
  incoming: EnvironmentInput,
  options: EnvironmentSyncOptions = {}
): Promise<EnvironmentSyncResult> {
  // Serialize every upload touching this environment NAME: the by-oid check,
  // the name-fallback scan and the create all run under one transaction-scoped
  // advisory lock, so a concurrent upload of the same package (same new oid)
  // sees the committed re-key on its by-oid read instead of racing to create.
  await repos.environments.lockName(incoming.local_id)

  const byOid = await repos.environments.findByOid(incoming.oid)
  if (byOid) {
    await repos.environments.update(incoming.oid, incoming)
    return { created: false, rekeyedFrom: null }
  }

  if (!options.duplicateIncomingNames?.has(incoming.local_id)) {
    const sameName = (await repos.environments.findAll()).filter(
      (e) => e.local_id === incoming.local_id && !options.incomingOids?.has(e.oid)
    )
    if (sameName.length === 1) {
      const source = sameName[0]!
      // New parent first, children re-pointed, old parent last — actions'
      // ON DELETE CASCADE must never fire and instances' FK (no cascade)
      // stays satisfied throughout.
      await repos.environments.create(incoming)
      await repos.actions.reassignEnvironment(source.oid, incoming.oid)
      await repos.instances.reassignEnvironment(source.oid, incoming.oid)
      await repos.log.reassignEnvironment(source.oid, incoming.oid)
      await repos.environments.delete(source.oid)
      return { created: false, rekeyedFrom: source.oid }
    }
  }

  await repos.environments.create(incoming)
  return { created: true, rekeyedFrom: null }
}
