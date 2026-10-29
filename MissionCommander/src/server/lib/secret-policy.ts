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

const PLACEHOLDERS = new Set(['insecure-dev-secret-change-me', 'change-me-in-production', 'mission-internal-dev-token']);
const MIN_LENGTH = 32;
const DEV_INTERNAL_TOKEN = 'mission-internal-dev-token';

/** Problems with the secrets Commander needs in production; empty when fine (and always
 *  empty outside production). Values are trimmed first — a Windows .env leaves a trailing \r. */
export function secretProblems(env: NodeJS.ProcessEnv): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  const secret = (env.BETTER_AUTH_SECRET ?? '').trim();
  if (PLACEHOLDERS.has(secret) || secret.length < MIN_LENGTH) {
    problems.push('BETTER_AUTH_SECRET is missing, a placeholder, or shorter than 32 characters.');
  }
  const token = (env.ENGINE_INTERNAL_TOKEN ?? '').trim();
  if (token === DEV_INTERNAL_TOKEN || (token !== '' && token.length < MIN_LENGTH)) {
    problems.push('ENGINE_INTERNAL_TOKEN is the public dev default or shorter than 32 characters.');
  }
  return problems;
}
