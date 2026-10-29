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

/** A run that never started (a rare orphaned/errored-before-start row) has no meaningful
 *  elapsed time — the em dash matches the rest of the app's "no value" convention rather
 *  than showing a misleading 0s. Below an hour, the smaller unit is left unpadded on its
 *  own ("12s") but zero-padded when paired with a larger unit ("4m 05s", "2h 05m"), so the
 *  pairing always reads as a fixed-width clock digit. */
export function formatDuration(startedAt: string | null, finishedAt: string): string {
  if (startedAt === null) return '—';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}
