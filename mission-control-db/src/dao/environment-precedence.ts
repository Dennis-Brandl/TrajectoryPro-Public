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
 * Which of two competing environment-spec declarations owns a shared definition
 * (spec §4.6, "newest Effective wins").
 *
 * `effectiveFrom` is deliberately NOT consulted: it is NULL through every ingest path
 * (wfenvirx never sets one, the load route passes no meta.effectiveFrom — see the
 * StateBadge comment in the CM), so a date-driven rule would never fire. The three tiers
 * below are the only signals that actually carry data.
 *
 * Ties are meaningful: a 0 result means the incumbent KEEPS the definition. A load must
 * never displace an equal-ranked declaration, or two specs at the same version would flip
 * the definition back and forth on every re-load.
 */
export type DefinitionOrigin = {
  state: string | null;
  version: string | null;
  downloadedAt: Date | null;
};

/** > 0 when `a` outranks `b`; < 0 when `b` outranks `a`; 0 when neither does. */
export function compareDefinitionPrecedence(a: DefinitionOrigin, b: DefinitionOrigin): number {
  const aEffective = a.state === 'Effective' ? 1 : 0;
  const bEffective = b.state === 'Effective' ? 1 : 0;
  if (aEffective !== bEffective) return aEffective - bEffective;

  const byVersion = compareVersions(a.version ?? '', b.version ?? '');
  if (byVersion !== 0) return byVersion;

  const aAt = a.downloadedAt?.getTime() ?? 0;
  const bAt = b.downloadedAt?.getTime() ?? 0;
  if (aAt !== bAt) return aAt < bAt ? -1 : 1;
  return 0;
}

/**
 * Dotted-segment compare. Numeric segments compare numerically ('1.10.0' > '1.9.0', which a
 * plain string compare gets backwards); any segment that is not all-digits on either side
 * falls back to a string compare of that segment. A missing segment reads as '', which
 * compares equal to a numeric 0 only when the other side is also absent — so '1.0' and
 * '1.0.0' tie while '1.0.1' outranks '1.0'.
 */
export function compareVersions(a: string, b: string): number {
  const as = a.split('.');
  const bs = b.split('.');
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const ax = as[i] ?? '';
    const bx = bs[i] ?? '';
    if (ax === bx) continue;
    const an = /^\d+$/.test(ax) ? Number(ax) : null;
    const bn = /^\d+$/.test(bx) ? Number(bx) : null;
    if (an !== null && bn !== null) {
      if (an !== bn) return an < bn ? -1 : 1;
      continue;
    }
    // One side absent, the other numeric zero — '1.0' vs '1.0.0' must tie.
    if (ax === '' && bn === 0) continue;
    if (bx === '' && an === 0) continue;
    const byString = ax.localeCompare(bx);
    if (byString !== 0) return byString < 0 ? -1 : 1;
  }
  return 0;
}
