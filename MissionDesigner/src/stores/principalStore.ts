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

// Phase 5a: the client's home for the team principal returned by /api/v2/me
// (memberships, per-team rights, and the user's teams). Populated once at boot
// (bootSequence). The 5b sidebar reads `teams`; 5c affordance-gating reads
// `rightsByTeam` via principalHasRight. This is display-only — the server
// re-authorizes every write; it never trusts the client.

import { create } from 'zustand'
import type { MePrincipal } from './specificationStore/apiClient'
import { categoryForEntityType } from '@/lib/lifecycle'

interface PrincipalState {
  principal: MePrincipal | null
  setPrincipal: (p: MePrincipal) => void
  clearPrincipal: () => void
}

export const usePrincipalStore = create<PrincipalState>((set) => ({
  principal: null,
  setPrincipal: (p) => set({ principal: p }),
  clearPrincipal: () => set({ principal: null }),
}))

/**
 * Whether `principal` holds `right` (e.g. 'workflow:edit') in team `teamId`.
 * Admins hold every right everywhere. A null principal holds nothing.
 * Mirrors the server's `can()` (policy.ts) for UI affordance gating only.
 * Callers must pass a non-null teamId (library.teamId may be null — guard before calling).
 */
export function principalHasRight(principal: MePrincipal | null, teamId: string, right: string): boolean {
  if (!principal) return false
  if (principal.isAdministrator) return true
  return principal.rightsByTeam[teamId]?.includes(right) ?? false
}

/** Convenience hook: the current principal (or null before boot). */
export function usePrincipal(): MePrincipal | null {
  return usePrincipalStore((s) => s.principal)
}

/**
 * The current user's display name, or 'Unknown' before boot / when absent.
 * Phase 5d slice 2 — sources `userName` off the principal, replacing the
 * legacy route-context `useCurrentUser` hook.
 */
export function useUserName(): string {
  return usePrincipalStore((s) => s.principal?.name ?? 'Unknown')
}

/**
 * Whether `principal` may perform `verb` on `lib` — the client mirror of the
 * server's `canDo()` (policy.ts). Admin → true. A null principal, a null/absent
 * library, or a null `teamId` (the 5a tolerance for minimal fixtures) → false.
 * `verb` is an object verb ('edit'|'create'|'delete'|'approve'|'makeEffective')
 * or a library verb ('library.create'|'library.delete'); the right string is
 * `${category}:${verb}`.
 */
export function principalCan(
  principal: MePrincipal | null,
  lib: { teamId?: string | null; entityType: string } | null | undefined,
  verb: string,
): boolean {
  if (!principal) return false
  if (principal.isAdministrator) return true
  if (!lib || lib.teamId == null) return false
  return principalHasRight(principal, lib.teamId, `${categoryForEntityType(lib.entityType)}:${verb}`)
}

/**
 * Whether `principal` holds `right` in ANY team they belong to (or is admin).
 * Used for team-agnostic affordances (e.g. the sidebar "New Library" button,
 * pending per-team targeting in 5d).
 */
export function principalHasRightInAnyTeam(principal: MePrincipal | null, right: string): boolean {
  if (!principal) return false
  if (principal.isAdministrator) return true
  return Object.values(principal.rightsByTeam).some((rights) => rights.includes(right))
}
