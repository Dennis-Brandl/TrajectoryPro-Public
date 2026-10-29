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
 * Waypoint for custom edge routing.
 * Stores offset from default path position.
 */
export interface EdgeWaypoint {
  /** X offset from default position */
  x: number
  /** Y offset from default position */
  y: number
}

/**
 * Data for edges with optional condition expression and waypoints.
 * Used primarily for SELECT 1 outgoing edges.
 */
export interface ConditionalEdgeData extends Record<string, unknown> {
  /** Condition expression displayed on the edge (e.g., "x > 10") */
  condition?: string
  /** Custom waypoints for edge routing - offsets from default positions */
  waypoints?: EdgeWaypoint[]
  /** Stable connection ID for runtime association (matches Select1OptionSpec.id) */
  connectionId?: string
}
