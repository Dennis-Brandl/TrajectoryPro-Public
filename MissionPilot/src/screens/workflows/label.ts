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

/** Word-wraps a step name into at most `maxLines` lines of at most `perLine` characters for
 *  a diagram node (spec §5.7). A word longer than a line is split; text that still does not
 *  fit ends the last line with "…". Never returns an empty array. */
export function wrapLabel(name: string, perLine: number, maxLines: number): string[] {
  const lines: string[] = []
  let line = ''
  for (let word of name.trim().split(/\s+/).filter(Boolean)) {
    while (word.length > perLine) {
      if (line) {
        lines.push(line)
        line = ''
      }
      lines.push(word.slice(0, perLine))
      word = word.slice(perLine)
    }
    if (!word) continue
    if (!line) line = word
    else if (line.length + 1 + word.length <= perLine) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (lines.length === 0) return ['']
  if (lines.length <= maxLines) return lines
  const rest = lines.slice(maxLines - 1).join(' ')
  const last = rest.length <= perLine ? rest : `${rest.slice(0, perLine - 1).trimEnd()}…`
  return [...lines.slice(0, maxLines - 1), last]
}
