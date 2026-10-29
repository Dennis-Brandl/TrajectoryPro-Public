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

// Runtime IDs are never truncated from the end (spec 2026-10-09 §4): the last segment is
// what tells two batches apart, so it is split off and kept whole, and only the head gives
// way — a CSS ellipsis on the head reads as an elided middle ("MIX-2026…0002").
const SEPARATORS = '-_./: '

export function splitRuntimeId(label: string): [head: string, tail: string] {
  // From the second-to-last character: a trailing separator belongs to the tail.
  for (let i = label.length - 2; i >= 0; i--) {
    if (SEPARATORS.includes(label[i]!)) return [label.slice(0, i + 1), label.slice(i + 1)]
  }
  return label.length > 4 ? [label.slice(0, -4), label.slice(-4)] : ['', label]
}

export const INSTANCE_COLOURS = 6

/** Which --pilot-instance-N stripe a runtime gets (spec §5.2): FNV-1a over the runtime ID,
 *  so a runtime keeps its colour across tabs, reloads and terminals. */
export function instanceStripe(runtimeLabel: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < runtimeLabel.length; i++) {
    h ^= runtimeLabel.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h % INSTANCE_COLOURS) + 1
}
