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

import { and, eq } from 'drizzle-orm';
import { environmentSpec, wcResource, wcValueProperty, RESOURCE_TYPES } from '../db/schema/index.js';
import { compareDefinitionPrecedence, type DefinitionOrigin } from './environment-precedence.js';
import { MAX_NAME_LENGTH } from './names.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
type Db = PgDatabase<any, Schema>;

// int4's max value (Postgres wc_resource.use_limit is a plain `integer` column). Designer's
// resource-count input has a `min` but no `max`, so an author-typed value can reach here
// unbounded — reject it before the insert rather than let Postgres raise 22003 and abort
// the whole ingest transaction.
const PG_INT4_MAX = 2147483647;

/** The environment-spec shapes this module reads. Mirrors ResourcePropertySpecification and
 *  PropertySpecification in the engine's spec/types.ts — structural, because the spec arrives
 *  as untyped jsonb from a Designer export. */
export type EnvResourceSpec = {
  name: string;
  resource_type: string;
  use_limit?: number;
  names?: string[];
  description?: string;
};
export type EnvValuePropertySpec = {
  name: string;
  entries?: { name: string; value: string }[];
};

export type MaterializeInput = {
  workCenterId: string;
  envSpecId: string;
  /** Display name, used only to make a conflict warning readable. */
  envSpecName: string;
  version: string;
  state: string;
  downloadedAt: Date;
  /** The environment spec's raw jsonb, exactly as stored on environment_spec. */
  specJsonb: unknown;
};

/** Why a raw resource-array element can't be trusted as an EnvResourceSpec, or null when it's
 *  fine to keep. An earlier ruling on this branch established that a silently-missing
 *  declaration should stay visible to the operator, so this is reported as a warning by the
 *  caller rather than dropped without a trace — the same treatment declarationProblem gives a
 *  declaration that passes this shape check but is garbage underneath. */
function resourceShapeProblem(r: unknown, index: number): string | null {
  if (!r || typeof r !== 'object') return `resource declaration at position ${index + 1} is not an object`;
  const obj = r as Record<string, unknown>;
  if (typeof obj.name !== 'string') return `resource declaration at position ${index + 1} has no string name`;
  if (typeof obj.resource_type !== 'string') return `resource "${obj.name}" has no string resource_type`;
  return null;
}

/** Same idea as resourceShapeProblem, for the value-property array. */
function valuePropertyShapeProblem(p: unknown, index: number): string | null {
  if (!p || typeof p !== 'object') return `value property at position ${index + 1} is not an object`;
  const obj = p as Record<string, unknown>;
  if (typeof obj.name !== 'string') return `value property at position ${index + 1} has no string name`;
  return null;
}

/** Pull the two declaration arrays out of an untrusted spec blob. Anything malformed is
 *  skipped (with a warning) rather than failing the whole load — a load must never fail
 *  because a spec carried a surprising shape, but a dropped declaration must stay visible to
 *  the operator loading the package. */
export function readRegistrySource(specJsonb: unknown): {
  resources: EnvResourceSpec[];
  valueProperties: EnvValuePropertySpec[];
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!specJsonb || typeof specJsonb !== 'object') return { resources: [], valueProperties: [], warnings };
  const spec = specJsonb as Record<string, unknown>;
  const rawResources = spec['resource_property_specifications'];
  const rawValues = spec['value_property_specifications'];

  const resources: EnvResourceSpec[] = [];
  if (Array.isArray(rawResources)) {
    rawResources.forEach((r, index) => {
      const problem = resourceShapeProblem(r, index);
      if (problem) { warnings.push(`Resource was not loaded: ${problem}.`); return; }
      resources.push(r as EnvResourceSpec);
    });
  }

  const valueProperties: EnvValuePropertySpec[] = [];
  if (Array.isArray(rawValues)) {
    rawValues.forEach((p, index) => {
      const problem = valuePropertyShapeProblem(p, index);
      if (problem) { warnings.push(`Value property was not loaded: ${problem}.`); return; }
      valueProperties.push(p as EnvValuePropertySpec);
    });
  }

  return { resources, valueProperties, warnings };
}

/**
 * A declaration that passes readRegistrySource's loose shape filter (name + resource_type
 * are strings) can still be garbage underneath — jsonb is untrusted. Returns what's wrong,
 * or null when it is safe to write. The caller SKIPS a bad declaration and warns instead of
 * throwing: one malformed resource must never fail the whole load (module docstring below,
 * spec §4.5/§4.6 warn-never-fail).
 */
function declarationProblem(r: EnvResourceSpec): string | null {
  if (r.name.length > MAX_NAME_LENGTH) {
    return `name exceeds ${MAX_NAME_LENGTH} characters`;
  }
  if (!(RESOURCE_TYPES as readonly string[]).includes(r.resource_type)) {
    return `unknown resource_type "${r.resource_type}"`;
  }
  if (r.use_limit !== undefined) {
    if (typeof r.use_limit !== 'number' || !Number.isFinite(r.use_limit)) {
      return `use_limit is not a finite number`;
    }
    // wc_resource.use_limit is a Postgres `integer` (int4). Designer's count input has a `min`
    // but no `max`, so an out-of-range or fractional value must be caught here — an insert
    // that reaches Postgres with one raises 22003 and aborts the whole load (spec §4.5/§4.6
    // warn-never-fail).
    if (!Number.isInteger(r.use_limit) || r.use_limit < 0 || r.use_limit > PG_INT4_MAX) {
      return `use_limit is not a non-negative integer within Postgres int4 range (max ${PG_INT4_MAX})`;
    }
  }
  if (r.names !== undefined && !(Array.isArray(r.names) && r.names.every((n) => typeof n === 'string'))) {
    return `names is not an array of strings`;
  }
  return null;
}

type Definition = {
  resourceType: string;
  useLimit: number | null;
  poolNames: string[];
  description: string | null;
};

function definitionOf(r: EnvResourceSpec): Definition {
  return {
    resourceType: r.resource_type,
    useLimit: r.use_limit ?? null,
    // Only a named pool has a roster; anything else records an empty one so a type change
    // away from 'named pool' clears the old roster rather than leaving it stranded.
    poolNames: r.resource_type === 'named pool' ? [...(r.names ?? [])] : [],
    description: r.description ?? null,
  };
}

/** A short, human-readable rendering of a definition, used to make a conflict warning say
 *  what actually differs without anyone needing to open Designer. */
function describeDefinition(d: Definition): string {
  const parts = [d.resourceType];
  if (d.useLimit !== null) parts.push(`use_limit ${d.useLimit}`);
  if (d.poolNames.length > 0) parts.push(`names [${d.poolNames.join(', ')}]`);
  if (d.description) parts.push(`"${d.description}"`);
  return parts.join(', ');
}

function sameArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function definitionDiffers(row: { resourceType: string; useLimit: number | null; poolNames: string[]; description: string | null }, next: Definition): boolean {
  return row.resourceType !== next.resourceType
    || row.useLimit !== next.useLimit
    || row.description !== next.description
    || !sameArray(row.poolNames, next.poolNames);
}

/**
 * Write one environment spec's resource and value-property DEFINITIONS into the work
 * center's shared registry (spec §4.5).
 *
 * Live state is never written: `in_use` and an existing row's `available_names` survive
 * every load, because a re-load must not disturb workflows that are already holding.
 *
 * Returns human-readable conflict warnings. A conflict NEVER fails the load — managing the
 * resource name space is the workflow author's responsibility, and blocking a load would
 * punish an operator for an authoring problem they cannot fix from the Mission Commander
 * (spec §4.6, user ruling 2026-08-31).
 */
export async function materializeEnvironmentRegistry(
  tx: Db, input: MaterializeInput,
): Promise<{ warnings: string[] }> {
  const { resources, valueProperties, warnings: shapeWarnings } = readRegistrySource(input.specJsonb);
  const warnings: string[] = [...shapeWarnings];
  const incoming: DefinitionOrigin = {
    state: input.state, version: input.version, downloadedAt: input.downloadedAt,
  };

  for (const r of resources) {
    const problem = declarationProblem(r);
    if (problem) {
      warnings.push(`Resource "${r.name}" was not loaded: ${problem}.`);
      continue;
    }

    const next = definitionOf(r);
    const [existing] = await tx.select().from(wcResource)
      .where(and(eq(wcResource.workCenterId, input.workCenterId), eq(wcResource.name, r.name)))
      .limit(1);

    if (!existing) {
      await tx.insert(wcResource).values({
        workCenterId: input.workCenterId,
        name: r.name,
        resourceType: next.resourceType,
        useLimit: next.useLimit,
        poolNames: next.poolNames,
        // A brand-new pool is fully available. Every other type starts at in_use 0 with an
        // empty roster, which the column defaults already give.
        availableNames: next.poolNames,
        description: next.description,
        definedByEnvSpecId: input.envSpecId,
        definedFromName: input.envSpecName,
        definedFromVersion: input.version,
        definedFromState: input.state,
      }).onConflictDoNothing({ target: [wcResource.workCenterId, wcResource.name] });
      continue;
    }

    if (!definitionDiffers(existing, next)) {
      // Identical redeclaration — the common case when the same environment is re-loaded.
      // The definition itself needs no write, but provenance can still be stale: an
      // orphaned incumbent (its declaring spec was deleted, defined_by_env_spec_id is NULL)
      // never gets repaired by anything else, since provenance is otherwise written only on
      // first insert or a won conflict. "the registry is derived state, so a re-load is the
      // operator's way to rebuild it" (ingest/wfenvirx.ts) has to include this half too, or
      // the row stays orphaned forever. Also refresh when the incoming spec outranks a
      // non-orphaned incumbent, so precedence still matters even without a definition
      // change. Silent either way — the definitions agree, so there is no conflict to warn
      // about. Do NOT refresh a non-orphaned incumbent that outranks or ties the incoming
      // spec, or two equal-ranked specs would fight over the row's provenance on every load.
      let shouldRepair = existing.definedByEnvSpecId === null;
      if (!shouldRepair) {
        const { origin: incumbentOrigin } = await originOfIncumbent(
          tx, existing.definedByEnvSpecId, existing.definedFromState, existing.definedFromVersion, existing.definedFromName,
        );
        shouldRepair = compareDefinitionPrecedence(incoming, incumbentOrigin) > 0;
      }
      if (shouldRepair) {
        await tx.update(wcResource).set({
          definedByEnvSpecId: input.envSpecId,
          definedFromName: input.envSpecName,
          definedFromVersion: input.version,
          definedFromState: input.state,
          updatedAt: new Date(),
        }).where(and(eq(wcResource.workCenterId, input.workCenterId), eq(wcResource.name, r.name)));
      }
      continue;
    }

    const { origin: incumbentOrigin, name: incumbentName } = await originOfIncumbent(
      tx, existing.definedByEnvSpecId, existing.definedFromState, existing.definedFromVersion, existing.definedFromName,
    );
    const incumbentDef: Definition = {
      resourceType: existing.resourceType, useLimit: existing.useLimit,
      poolNames: existing.poolNames, description: existing.description,
    };
    const incomingWins = compareDefinitionPrecedence(incoming, incumbentOrigin) > 0;
    warnings.push(conflictWarning({
      resourceName: r.name,
      incomingName: input.envSpecName, incomingVersion: input.version, incomingState: input.state, incomingDef: next,
      incumbentName, incumbentVersion: existing.definedFromVersion, incumbentState: existing.definedFromState, incumbentDef,
      winner: incomingWins ? 'incoming' : 'incumbent',
      sameSpec: existing.definedByEnvSpecId === input.envSpecId,
    }));
    if (!incomingWins) continue;

    await tx.update(wcResource).set({
      resourceType: next.resourceType,
      useLimit: next.useLimit,
      poolNames: next.poolNames,
      // Names that survive the roster change stay exactly as they were (free stays free,
      // held stays held); brand-new names join as free. A HELD name dropped from the roster
      // lands in neither array, which is precisely what makes releaseNamed() discard it
      // instead of returning it to the pool (spec §4.6, "retired names").
      availableNames: nextAvailableNames(existing.availableNames, existing.poolNames, next.poolNames),
      description: next.description,
      definedByEnvSpecId: input.envSpecId,
      definedFromName: input.envSpecName,
      definedFromVersion: input.version,
      definedFromState: input.state,
      updatedAt: new Date(),
    }).where(and(eq(wcResource.workCenterId, input.workCenterId), eq(wcResource.name, r.name)));
  }

  // Value properties: seed entries that do not exist yet and leave every existing value
  // alone. ON CONFLICT DO NOTHING is the whole rule — a re-load must never reset a value a
  // running workflow (or an operator) has moved, which would silently rewind live state.
  //
  // The `Description` entry is seeded like any other: properties.ts excludes it from GROUP
  // reads, but it is still a real entry and the panes render it as annotation.
  for (const p of valueProperties) {
    // Property and entry names sit in wc_value_property's primary key (like a resource name
    // in wc_resource's), so an oversized one overflows the btree index row (SQLSTATE 54000,
    // a logged 500) — reject it here, the same as declarationProblem does for a resource.
    if (p.name.length > MAX_NAME_LENGTH) {
      warnings.push(`Value property was not loaded: name exceeds ${MAX_NAME_LENGTH} characters.`);
      continue;
    }
    // Absent entries is a legitimate declaration (a property with no entries yet) and is
    // skipped silently. Present-but-not-an-array is malformed jsonb from an untrusted
    // Designer export -- skip it too, but warn, the same way the resource path warns on a
    // malformed `names` field, so a silently-missing value property stays visible to the
    // operator loading the package.
    if (p.entries === undefined || p.entries === null) continue;
    if (!Array.isArray(p.entries)) {
      warnings.push(`Value property "${p.name}" was not loaded: entries is not an array.`);
      continue;
    }
    for (const entry of p.entries) {
      if (typeof entry?.name !== 'string') continue;
      if (entry.name.length > MAX_NAME_LENGTH) {
        warnings.push(`Value property "${p.name}" entry was not loaded: name exceeds ${MAX_NAME_LENGTH} characters.`);
        continue;
      }
      await tx.insert(wcValueProperty).values({
        workCenterId: input.workCenterId,
        propertyName: p.name,
        entryName: entry.name,
        value: typeof entry.value === 'string' ? entry.value : '',
        definedByEnvSpecId: input.envSpecId,
      }).onConflictDoNothing({
        target: [wcValueProperty.workCenterId, wcValueProperty.propertyName, wcValueProperty.entryName],
      });
    }
  }

  return { warnings };
}

/** Names free after a roster change: survivors that were already free, plus every name the
 *  new roster introduces. Held survivors stay held by being absent from the result. */
export function nextAvailableNames(
  currentlyAvailable: readonly string[],
  oldRoster: readonly string[],
  newRoster: readonly string[],
): string[] {
  const wasKnown = new Set(oldRoster);
  const stillFree = newRoster.filter((n) => currentlyAvailable.includes(n));
  const brandNew = newRoster.filter((n) => !wasKnown.has(n));
  return [...stillFree, ...brandNew.filter((n) => !stillFree.includes(n))];
}

/**
 * The incumbent definition's origin AND its display name (spec §2 U3 / §4.6: a conflict
 * warning must name both specs). The live `environment_spec.name` is preferred when the
 * declaring spec still exists; `defined_from_name` (denormalized onto wc_resource at write
 * time) is the fallback once it's gone — that's the only thing that lets an ORPHANED
 * incumbent (declaring spec deleted) still be named. If neither is available the caller
 * renders it as an unnamed deleted spec rather than printing "null" or "undefined".
 */
async function originOfIncumbent(
  tx: Db, envSpecId: string | null, state: string | null, version: string | null, storedName: string | null,
): Promise<{ origin: DefinitionOrigin; name: string | null }> {
  if (!envSpecId) return { origin: { state, version, downloadedAt: null }, name: storedName };
  const [row] = await tx.select({ downloadedAt: environmentSpec.downloadedAt, name: environmentSpec.name })
    .from(environmentSpec).where(eq(environmentSpec.id, envSpecId)).limit(1);
  return {
    origin: { state, version, downloadedAt: row?.downloadedAt ?? null },
    name: row?.name ?? storedName,
  };
}

function conflictWarning(c: {
  resourceName: string;
  incomingName: string; incomingVersion: string; incomingState: string; incomingDef: Definition;
  incumbentName: string | null; incumbentVersion: string | null; incumbentState: string | null; incumbentDef: Definition;
  winner: 'incoming' | 'incumbent';
  /** Spec §12.1 item 8: the incumbent IS the incoming spec (same environment_spec row) — a
   *  Draft re-load with edited declarations. Naming it on both sides reads as nonsense. */
  sameSpec: boolean;
}): string {
  const incoming = `"${c.incomingName}" v${c.incomingVersion} ${c.incomingState} (${describeDefinition(c.incomingDef)})`;
  if (c.sameSpec) {
    return `Resource "${c.resourceName}" is already registered by this same spec identity with a different definition `
      + `(${describeDefinition(c.incumbentDef)}); the incoming declaration is ${incoming}. `
      + `The registry keeps the existing definition — bump the version to change a live declaration.`;
  }
  const incumbentLabel = c.incumbentName ? `"${c.incumbentName}"` : 'an unnamed deleted spec';
  const incumbent = `${incumbentLabel} v${c.incumbentVersion ?? '?'} ${c.incumbentState ?? '?'} (${describeDefinition(c.incumbentDef)})`;
  return c.winner === 'incoming'
    ? `Resource "${c.resourceName}" is declared differently by ${incoming} than by ${incumbent}. `
      + `The work center shares one resource name space, so the newer Effective declaration now owns it.`
    : `Resource "${c.resourceName}" is declared differently by ${incoming} than by ${incumbent}. `
      + `${incumbentLabel} outranks it, so the existing definition was kept.`;
}
