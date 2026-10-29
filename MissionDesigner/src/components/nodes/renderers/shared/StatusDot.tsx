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

interface StatusDotProps {
  cx: number
  cy: number
  r: number
  active: boolean
}

/**
 * Green filled dot when active, gray outline when inactive.
 * Used for action reference and form design status indicators.
 */
export function StatusDot({ cx, cy, r, active }: StatusDotProps) {
  return active ? (
    <circle cx={cx} cy={cy} r={r} fill="#22c55e" />
  ) : (
    <circle cx={cx} cy={cy} r={r} fill="none" stroke="#94a3b8" strokeWidth="1" />
  )
}
