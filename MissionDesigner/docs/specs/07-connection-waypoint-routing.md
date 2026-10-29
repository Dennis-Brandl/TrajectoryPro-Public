# Connection Waypoint Routing — Runtime Reference

**Audience:** runtime engines and visualizers (Trajectory Pro, Action Server management consoles) that re-render a workflow diagram from an exported `.WFmaster`.

**Scope:** how to interpret the optional `connections[i].waypoints` array so the rendered edge matches what the Mission Designer editor showed when the workflow was exported.

A pure execution engine that does NOT render the diagram can ignore waypoints entirely — they carry no semantic meaning for execution. Connection identity is determined by `from_step_id`, `to_step_id`, `source_handle_id`, and `condition`.

---

## 1. Coordinate Space

- Same units and origin as `step.position.{x, y}` — the React Flow document coordinate system.
- Axis convention: **+X right, +Y down** (DOM/SVG).
- Untransformed: viewport zoom/pan affect rendering only, never the values stored in JSON.

## 2. Wire Shape (Recap)

```jsonc
{
  "from_step_id": "...",
  "to_step_id": "...",
  "source_handle_id": "...", // optional
  "condition": "...", // optional, SELECT 1 only
  "connection_id": "...", // optional, stable runtime ID
  "waypoints": [
    // optional
    { "x": 50, "y": -20 },
  ],
}
```

**Array length is effectively 0 or 1.** The current editor only reads `waypoints[0]`; the drag handler only writes a single-element array. The schema permits longer arrays for forward compatibility, but no editor or renderer behavior is defined for elements beyond index 0. Treat extra elements as opaque on round-trip.

**Default:** missing `waypoints`, `[]`, and `[{ "x": 0, "y": 0 }]` all produce the same rendered path. Exporters omit the field when no manual routing has been applied to keep payloads small.

## 3. Coordinates Are Offsets, Not Absolute Points

Each `{x, y}` is a **delta from a default midpoint** that the editor's orthogonal router computes from the source/target node positions and the workflow's notation (top-to-bottom or left-to-right). The default midpoint itself is NOT stored in the JSON — a renderer must reproduce the algorithm in §4 to know where the offset is being applied.

The semantics of `wpX` and `wpY` depend on (a) the notation's flow direction and (b) whether the connection is "forward" (target after source along the flow axis) or "backward" (a loop that must route around the nodes):

| Notation              | Forward / backward             | Active offset | What it shifts                                                                |
| --------------------- | ------------------------------ | ------------- | ----------------------------------------------------------------------------- |
| Vertical (TB, ISA-88) | forward (`targetY > sourceY`)  | `wpY`         | Y of the horizontal crossover segment between source and target               |
| Vertical              | backward (`targetY < sourceY`) | `wpX`         | X of the vertical bypass lane that routes around the right side of both nodes |
| Horizontal (LR, BPMN) | forward (`targetX > sourceX`)  | `wpX`         | X of the vertical crossover segment between source and target                 |
| Horizontal            | backward (`targetX < sourceX`) | `wpY`         | Y of the horizontal bypass lane below both nodes                              |

The off-axis component (e.g., `wpX` on a forward TB connection) is **read but not applied**. It is whatever was last persisted, typically `0`.

## 4. Routing Algorithm

Pseudocode reproducing `calculatePathPoints` from `src/components/edges/ConditionalEdge.tsx`. Returns an ordered list of points; render as a polyline / orthogonal SVG path connecting them in order.

```
const OFFSET            = 5    // base offset from node when very close
const TURN              = 20   // 2 grid marks: turnaround for backward loops
const NODE_CLEARANCE_V  = 30   // vertical clearance when bypassing below
const NODE_CLEARANCE_H  = 50   // horizontal clearance when bypassing to the right

function pathPoints(sourceX, sourceY, targetX, targetY, sourcePosition, waypoints):
    wpX = waypoints[0]?.x ?? 0
    wpY = waypoints[0]?.y ?? 0

    isVerticalFlow = (sourcePosition == BOTTOM or sourcePosition == TOP)
    points = [ {sourceX, sourceY} ]

    if isVerticalFlow:
        if targetY < sourceY:                              # backward loop (vertical)
            routeX = max(sourceX, targetX) + NODE_CLEARANCE_H + wpX
            points += {sourceX, sourceY + TURN}            # down 2 grid marks
            points += {routeX,  sourceY + TURN}            # right to bypass lane
            points += {routeX,  targetY - TURN}            # up past target
            points += {targetX, targetY - TURN}            # left to above target
        else:                                              # forward (vertical)
            dy = abs(targetY - sourceY)
            dx = abs(targetX - sourceX)
            if dy > 5 and dx > 5:
                midY = (sourceY + targetY) / 2 + wpY
                points += {sourceX, midY}
                points += {targetX, midY}
            else:
                nearY = sourceY + OFFSET
                points += {sourceX, nearY}
                points += {targetX, nearY}
    else:
        if targetX < sourceX:                              # backward loop (horizontal)
            routeY = max(sourceY, targetY) + NODE_CLEARANCE_V + wpY
            points += {sourceX + TURN, sourceY}            # right 2 grid marks
            points += {sourceX + TURN, routeY}             # down to bypass lane
            points += {targetX  - TURN, routeY}            # left past target
            points += {targetX  - TURN, targetY}           # up to target level
        else:                                              # forward (horizontal)
            dx = abs(targetX - sourceX)
            dy = abs(targetY - sourceY)
            if dx > 5 and dy > 5:
                midX = (sourceX + targetX) / 2 + wpX
                points += {midX, sourceY}
                points += {midX, targetY}
            else:
                nearX = sourceX + OFFSET
                points += {nearX, sourceY}
                points += {nearX, targetY}

    points += {targetX, targetY}
    return points
```

**Inputs:**

- `sourceX, sourceY` — center of the source handle (the `from_step_id` node's emit handle, derived from its `position` + node geometry; the editor uses React Flow's handle resolution).
- `targetX, targetY` — center of the target handle on the `to_step_id` node.
- `sourcePosition` — `BOTTOM`/`TOP` for vertical notations (TB, ISA-88), `RIGHT`/`LEFT` for horizontal (BPMN). This is determined by the notation, not stored per-connection.
- `waypoints` — the array from the JSON.

**Output:** a polyline of 4 points (forward, near case or normal case) or 6 points (backward loop). Render as straight-line segments; the editor uses no curves.

## 5. Constants

| Symbol             | Value | Purpose                                                                  |
| ------------------ | ----- | ------------------------------------------------------------------------ |
| `OFFSET`           | 5     | Used when source and target are within 5 px on the off-axis (collapsed). |
| `TURN`             | 20    | Backward-loop turnaround distance away from each node before bypass.     |
| `NODE_CLEARANCE_V` | 30    | Pad below both nodes when bypassing horizontally.                        |
| `NODE_CLEARANCE_H` | 50    | Pad to the right of both nodes when bypassing vertically.                |
| Grid snap          | 5     | Editor snaps drag deltas to multiples of 5; values are always integers.  |

These are shared with the editor and must be kept in lockstep if the runtime intends pixel-identical rendering. They are not embedded in the JSON.

## 6. Worked Examples

### 6a. Forward, vertical (TB), with a midpoint bump

Source at `(200, 100)`, target at `(400, 400)`, `sourcePosition = BOTTOM`, `waypoints = [{ x: 0, y: -30 }]`.

- Forward (`targetY > sourceY`).
- `dy = 300, dx = 200` — both > 5, take the midpoint branch.
- `midY = (100 + 400)/2 + (-30) = 220`.
- Points: `(200,100) → (200,220) → (400,220) → (400,400)`.

Without the waypoint (`wpY = 0`), `midY = 250` and the crossover sits halfway. The waypoint moved the horizontal segment up by 30 px.

### 6b. Backward loop, vertical (TB)

Source at `(300, 500)`, target at `(300, 200)`, `sourcePosition = BOTTOM`, `waypoints = [{ x: 40, y: 0 }]`.

- Backward (`targetY < sourceY`).
- `routeX = max(300, 300) + 50 + 40 = 390`.
- Points: `(300,500) → (300,520) → (390,520) → (390,180) → (300,180) → (300,200)`.

The bypass lane sits 90 px to the right of the nodes (50 base + 40 from waypoint).

### 6c. Forward, horizontal (LR)

Source at `(100, 200)`, target at `(500, 250)`, `sourcePosition = RIGHT`, `waypoints = [{ x: 60, y: 0 }]`.

- Forward (`targetX > sourceX`).
- `dx = 400, dy = 50` — both > 5.
- `midX = (100 + 500)/2 + 60 = 360`.
- Points: `(100,200) → (360,200) → (360,250) → (500,250)`.

### 6d. Forward, vertical, collapsed off-axis

Source at `(200, 100)`, target at `(202, 400)` (essentially aligned), `waypoints` omitted.

- Forward, but `dx = 2 ≤ 5` — take the "near" branch.
- `nearY = 100 + 5 = 105`.
- Points: `(200,100) → (200,105) → (202,105) → (202,400)`.

The "near" branch produces a tiny notch right at the source rather than splitting the long vertical span. Waypoints have no effect in this branch.

## 7. Edge Cases

- **Short segments hide the editor's drag handle** when their length is < 20 px. This is editor UX only; renderers should still draw the segment.
- **Identical source and target positions** are not produced by the editor (a self-loop is modeled differently as a SELECT 1 / WAIT cycle), so no special case is required.
- **Notation switches** (the workflow's `display_style` changes flowchart ↔ bpmn) are user-initiated in the editor and persist new positions; runtime should always use the `display_style` recorded in the spec to determine `sourcePosition`.

## 8. For Non-Visualizing Consumers

If your runtime does not render a 2D diagram (CLI executor, server-side validator, Action Server invoking actions in sequence), `waypoints` is presentation metadata only. Preserve it on round-trip if you re-emit the workflow JSON; otherwise ignore it.
