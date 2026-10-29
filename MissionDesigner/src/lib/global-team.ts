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
 * The GLOBAL team (spec 2026-10-12): an ordinary team row with a fixed id whose
 * action, environment and step libraries every signed-in user can see and use.
 * Shared by server and client — "is global" is always `teamId === GLOBAL_TEAM_ID`.
 */

export const GLOBAL_TEAM_ID = 'team-global'
export const GLOBAL_TEAM_NAME = 'GLOBAL'

const GLOBAL_ENTITY_TYPES: readonly string[] = ['action', 'environment', 'step']

export function isGlobalTeam(teamId: string | null | undefined): boolean {
  return teamId === GLOBAL_TEAM_ID
}

/** Workflow libraries never belong to GLOBAL (spec U2). */
export function allowedInGlobal(entityType: string): boolean {
  return GLOBAL_ENTITY_TYPES.includes(entityType)
}

/** The entity types among `entityTypes` that may not be written into `teamId`. */
export function globalForbiddenEntityTypes(teamId: string, entityTypes: Iterable<string>): string[] {
  if (!isGlobalTeam(teamId)) return []
  return [...entityTypes].filter((t) => !allowedInGlobal(t))
}

/**
 * Resolves a library reference by name (references between libraries are names, not ids).
 * A team's own library wins over GLOBAL's (spec U4): the preferred team's match first, then
 * the first match outside GLOBAL, then GLOBAL's. With no GLOBAL candidate this is the plain
 * first match the code used before.
 */
export function pickLibraryByName<L extends { name: string; entityType: string; teamId?: string | null }>(
  libraries: readonly L[],
  name: string,
  entityType: string,
  preferTeamId?: string | null,
): L | undefined {
  const matches = libraries.filter((l) => l.name === name && l.entityType === entityType)
  if (matches.length <= 1) return matches[0]
  return (
    (preferTeamId ? matches.find((l) => l.teamId === preferTeamId) : undefined) ??
    matches.find((l) => !isGlobalTeam(l.teamId)) ??
    matches[0]
  )
}

/**
 * The libraries of `entityType` a picker may offer when the saved reference is a bare name
 * resolved with `preferTeamId`: each name appears once, as the library that name resolves to.
 * Offering a library the name does not resolve to would save a reference to a different one.
 */
export function pickableLibraries<L extends { name: string; entityType: string; teamId?: string | null }>(
  libraries: readonly L[],
  entityType: string,
  preferTeamId?: string | null,
): L[] {
  const ofType = libraries.filter((l) => l.entityType === entityType)
  return ofType.filter((l) => pickLibraryByName(ofType, l.name, entityType, preferTeamId) === l)
}

/**
 * The libraries `names` resolve to (see pickLibraryByName), each once, in name order. Exports
 * use it to load only the libraries they will bundle, not every library sharing a name.
 */
export function librariesForNames<L extends { name: string; entityType: string; teamId?: string | null }>(
  libraries: readonly L[],
  names: Iterable<string>,
  entityType: string,
  preferTeamId?: string | null,
): L[] {
  const out = new Set<L>()
  for (const name of names) {
    const lib = pickLibraryByName(libraries, name, entityType, preferTeamId)
    if (lib) out.add(lib)
  }
  return [...out]
}

/** Display name for pickers; stored references always keep the bare name. */
export function libraryLabel(lib: { name: string; teamId?: string | null }): string {
  return isGlobalTeam(lib.teamId) ? `${lib.name} (GLOBAL)` : lib.name
}

/**
 * Action library names referenced by environment specs, each mapped to the team of the first
 * environment naming it. Resolving a name with that team as `preferTeamId` gives exports the
 * same answer the editor shows (spec 2026-10-12 U4).
 */
export function actionLibraryRefs(
  envSpecs: Iterable<{ libraryId: string | null; data: Record<string, unknown> }>,
  teamOfLibrary: (libraryId: string) => string | null | undefined,
): Map<string, string | null> {
  const refs = new Map<string, string | null>()
  for (const spec of envSpecs) {
    const actions = (spec.data.included_actions ?? spec.data.includedActions) as
      | Array<{ action_library?: string; actionLibrary?: string }>
      | undefined
    for (const action of actions ?? []) {
      const name = action.action_library ?? action.actionLibrary
      if (name && !refs.has(name)) refs.set(name, (spec.libraryId && teamOfLibrary(spec.libraryId)) ?? null)
    }
  }
  return refs
}
