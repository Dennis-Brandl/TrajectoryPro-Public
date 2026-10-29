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

import { eq, inArray } from 'drizzle-orm';
import { role, workflowSignatureRole } from '../db/schema/index.js';
import { MAX_NAME_LENGTH } from '../dao/names.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

// E-signature roles referenced by a .WFmasterX package.
//
// An e-signature block (FormKit `esignature`, spec 2026-09-06) names a role defined in
// Mission Commander that its signer must hold, as a plain string, `roleName`, inside a
// step's form_document. Designer
// keeps its own list of those names and nothing ties it to the `role` table, so a package
// can arrive naming a role Mission Commander has never heard of — and the engine then fails the
// first signature attempt with SIGNATURE_ROLE_UNKNOWN. The load creates the missing roles
// (exact trimmed name, D8) and links every referenced role to the entry so the work center's
// Roles tab lists it as a role used by its workflows (work_center_role VIEW).
//
// Same degrade-to-noop stance as the image walker: malformed shapes are skipped, never thrown.

export interface SignatureRolesResult {
  /** Distinct role names the package references, in document order. */
  referenced: string[];
  /** The subset of `referenced` that did not exist before this load and was created. */
  created: string[];
  warnings: string[];
}

/** Walk one spec's steps for e-signature blocks and collect their trimmed role names. */
function collectFromSteps(steps: unknown, out: string[]): void {
  if (!Array.isArray(steps)) return;
  for (const step of steps as Array<Record<string, unknown> | null>) {
    if (!step || typeof step !== 'object') continue;
    const doc = step.form_document as Record<string, unknown> | undefined;
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.sections)) continue;
    for (const section of doc.sections as Array<Record<string, unknown> | null>) {
      const rows = section && typeof section === 'object' ? section.rows : undefined;
      if (!Array.isArray(rows)) continue;
      for (const row of rows as Array<Record<string, unknown> | null>) {
        const blocks = row && typeof row === 'object' ? row.blocks : undefined;
        if (!Array.isArray(blocks)) continue;
        for (const block of blocks as Array<Record<string, unknown> | null>) {
          if (!block || typeof block !== 'object' || block.type !== 'esignature') continue;
          if (typeof block.roleName !== 'string') continue;
          const name = block.roleName.trim();
          if (name && !out.includes(name)) out.push(name);
        }
      }
    }
  }
}

/** Distinct, trimmed, non-empty e-signature role names: root + every (recursive) embedded child. */
export function collectSignatureRoleNames(root: unknown): string[] {
  const names: string[] = [];
  const visit = (spec: unknown): void => {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return;
    const s = spec as Record<string, unknown>;
    collectFromSteps(s.steps, names);
    if (Array.isArray(s.children)) for (const c of s.children) visit(c);
  };
  visit(root);
  return names;
}

/**
 * Find-or-create every role the entry's e-signature blocks name, then link each to the entry.
 * Idempotent: a re-load of the same package creates nothing and links nothing new, which is
 * what lets a package loaded before this existed be backfilled by loading it again.
 * role.name is globally UNIQUE (the sound natural key, spec D8), so onConflictDoNothing on
 * the name is the right idempotency; a lost race re-reads the winner's row.
 */
export async function linkSignatureRoles(tx: Db, workflowId: string, root: unknown): Promise<SignatureRolesResult> {
  const warnings: string[] = [];
  const referenced = collectSignatureRoleNames(root).filter((name) => {
    if (name.length <= MAX_NAME_LENGTH) return true;
    warnings.push(`E-signature role "${name.slice(0, 40)}…" exceeds ${MAX_NAME_LENGTH} characters and was not created`);
    return false;
  });
  if (referenced.length === 0) return { referenced, created: [], warnings };

  const existing = await tx.select({ id: role.id, name: role.name })
    .from(role).where(inArray(role.name, referenced));
  const idByName = new Map(existing.map((r) => [r.name, r.id]));
  const created: string[] = [];
  for (const name of referenced) {
    if (idByName.has(name)) continue;
    const [row] = await tx.insert(role).values({ name })
      .onConflictDoNothing({ target: role.name })
      .returning({ id: role.id });
    if (row) {
      idByName.set(name, row.id);
      created.push(name);
    } else {
      const [winner] = await tx.select({ id: role.id }).from(role).where(eq(role.name, name)).limit(1);
      if (winner) idByName.set(name, winner.id);
    }
  }

  const roleIds = referenced.map((n) => idByName.get(n)).filter((id): id is string => id !== undefined);
  if (roleIds.length) {
    await tx.insert(workflowSignatureRole)
      .values(roleIds.map((roleId) => ({ workflowId, roleId })))
      .onConflictDoNothing();
  }
  return { referenced, created, warnings };
}
