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
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiagramSpec } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { DiagramStep } from './DiagramStep';
import { contentBounds, placeEdges, placeSteps, FIT_PADDING } from './layout';

/**
 * New pan after zooming from z0 to z1 while holding one anchor point fixed on screen.
 *
 * `anchorU`/`anchorV` are the anchor's distance from the CURRENT viewBox origin, in viewBox
 * units. The derivation is short because vbW and vbH both scale by exactly 1/zoom: the
 * uniform factor the browser applies under the default preserveAspectRatio="xMidYMid meet"
 * — min(rect.w/vbW, rect.h/vbH) — therefore picks the same axis at any zoom, which makes
 * vbW * scale invariant and the letterbox offset constant. All that remains is shifting the
 * origin by the anchor's distance times (1 - z0/z1).
 */
function panForZoom(
  pan: { x: number; y: number }, z0: number, z1: number, anchorU: number, anchorV: number,
) {
  const k = 1 - z0 / z1;
  return { x: pan.x + anchorU * k, y: pan.y + anchorV * k };
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 8;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * Read-only viewer for a workflow's step graph, replacing the indented Nodes outline.
 *
 * Opens on the ROOT spec. A WORKFLOW PROXY step that resolved to an embedded child (the
 * server does that matching — see dao/workflow-diagram.ts) descends into it, and the
 * breadcrumb climbs back. Children that no proxy step claims get their own strip, because
 * the outline this replaces could reach every child and losing that would be a regression.
 */
export function WorkflowDiagram({ root }: { root: DiagramSpec }) {
  // Path of child oids from the root. Reset whenever a different workflow is shown —
  // otherwise a stale path would index into the new spec's children.
  const [path, setPath] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { setPath([]); setZoom(1); setPan({ x: 0, y: 0 }); }, [root.oid]);

  // Walk the path; a segment that no longer resolves simply stops the walk, so a bad path
  // shows the deepest spec it could reach rather than blanking.
  const trail = useMemo(() => {
    const specs: DiagramSpec[] = [root];
    let current = root;
    for (const oid of path) {
      const next = current.children.find((c) => c.oid === oid);
      if (!next) break;
      specs.push(next);
      current = next;
    }
    return specs;
  }, [root, path]);

  const spec = trail[trail.length - 1];
  const placed = useMemo(() => placeSteps(spec), [spec]);
  const edges = useMemo(() => placeEdges(spec, placed), [spec, placed]);
  const bounds = useMemo(() => contentBounds(placed), [placed]);

  const linkedChildOids = useMemo(
    () => new Set(spec.steps.map((s) => s.childSpecOid).filter((o): o is string => o !== null)),
    [spec],
  );
  const unlinkedChildren = spec.children.filter((c) => !linkedChildOids.has(c.oid));

  const descend = (oid: string) => { setPath((p) => [...p, oid]); setZoom(1); setPan({ x: 0, y: 0 }); };
  const climbTo = (depth: number) => { setPath((p) => p.slice(0, depth)); setZoom(1); setPan({ x: 0, y: 0 }); };
  const fit = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const viewBoxWidth = (bounds.width + FIT_PADDING * 2) / zoom;
  const viewBoxHeight = (bounds.height + FIT_PADDING * 2) / zoom;
  const viewBox = [
    bounds.minX - FIT_PADDING + pan.x,
    bounds.minY - FIT_PADDING + pan.y,
    viewBoxWidth,
    viewBoxHeight,
  ].join(' ');

  const scaleFor = (rect: DOMRect) =>
    rect.width > 0 && rect.height > 0
      ? Math.min(rect.width / viewBoxWidth, rect.height / viewBoxHeight)
      : 0;

  // No cursor exists for a button press, so anchor at the viewBox centre — which, unlike the
  // wheel path, needs no getBoundingClientRect at all.
  const zoomBy = (factor: number) => {
    const z1 = clampZoom(zoom * factor);
    if (z1 === zoom) return;
    setPan((p) => panForZoom(p, zoom, z1, viewBoxWidth / 2, viewBoxHeight / 2));
    setZoom(z1);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <nav aria-label="Diagram breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
          {trail.map((s, i) => (
            <span key={s.oid} className="flex min-w-0 items-center gap-1">
              {i > 0 && <span aria-hidden="true" className="text-muted-foreground">›</span>}
              {i === trail.length - 1 ? (
                <span className="truncate font-medium">{s.name}</span>
              ) : (
                <button type="button" className="truncate underline-offset-2 hover:underline"
                  onClick={() => climbTo(i)}>{s.name}</button>
              )}
            </span>
          ))}
        </nav>
        <div className="flex shrink-0 gap-1">
          <Button type="button" variant="outline" size="sm" onClick={fit}>Fit</Button>
          <Button type="button" variant="outline" size="sm" aria-label="Zoom in"
            onClick={() => zoomBy(1.25)}>+</Button>
          <Button type="button" variant="outline" size="sm" aria-label="Zoom out"
            onClick={() => zoomBy(1 / 1.25)}>−</Button>
        </div>
      </div>

      {spec.steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">This workflow has no steps</p>
      ) : (
        <svg
          viewBox={viewBox}
          role="group"
          aria-label={`${spec.name}: ${spec.steps.length} steps, ${spec.connections.length} connections`}
          className="h-[28rem] w-full touch-none rounded border bg-card"
          onWheel={(e) => {
            const z1 = clampZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
            if (z1 === zoom) return;             // already at a clamp bound
            const rect = e.currentTarget.getBoundingClientRect();
            // A zero-sized rect — jsdom's default, or an element hidden mid-gesture — gives
            // no usable cursor mapping. Fall back to the centre anchor the +/- buttons use,
            // which needs no rect, rather than dividing into a NaN viewBox.
            const scale = scaleFor(rect);
            const [u, v] = scale > 0
              ? [
                  (e.clientX - rect.left - (rect.width - viewBoxWidth * scale) / 2) / scale,
                  (e.clientY - rect.top - (rect.height - viewBoxHeight * scale) / 2) / scale,
                ]
              : [viewBoxWidth / 2, viewBoxHeight / 2];
            setPan((p) => panForZoom(p, zoom, z1, u, v));
            setZoom(z1);
          }}
          onPointerDown={(e) => {
            // A pointerdown that starts on a clickable step (the proxy steps rendered as
            // <g role="button">) must fall through to that step's own onClick, not become a
            // pan. Capturing the pointer here unconditionally retargets the subsequent click
            // to this <svg> — the capturing element — per the Pointer Events spec, so the
            // descendant step's onClick would never fire for a real mouse click even though
            // it fires fine for a synthetic jsdom click (no PointerEvent capture there) and
            // for keyboard activation (no pointer involved at all). Only real browsers, i.e.
            // only Playwright, can see this.
            if ((e.target as Element).closest('[role="button"]')) return;
            drag.current = { x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            // Convert the screen-pixel drag delta into viewBox units. The <svg> sets no
            // preserveAspectRatio, so it defaults to `xMidYMid meet`: the browser scales the
            // whole viewBox by a SINGLE uniform factor — min(rect.width / viewBoxWidth,
            // rect.height / viewBoxHeight) — never stretching the two axes independently.
            // Dividing dx by rect.width and dy by rect.height separately (as this used to)
            // is only correct when the rendered rect happens to share the viewBox's aspect
            // ratio; for the common case where it doesn't (e.g. a wide bpmn layout in a
            // roughly-square panel), that under/over-corrects one axis and drag tracking
            // visibly lags or races the pointer on that axis. A zero-sized rect (jsdom's
            // default, or a real element hidden mid-drag) — or the zero `scale` that would
            // follow from it — must not divide-by-zero into a NaN/Infinity viewBox, so bail
            // out of the update instead.
            const rect = e.currentTarget.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            const scale = scaleFor(rect);
            if (scale === 0) return;
            const dx = (e.clientX - drag.current.x) / scale;
            const dy = (e.clientY - drag.current.y) / scale;
            drag.current = { x: e.clientX, y: e.clientY };
            setPan((p) => ({ x: p.x - dx, y: p.y - dy }));
          }}
          onPointerUp={(e) => {
            drag.current = null;
            // The role="button" guard in onPointerDown can return before capture is ever
            // taken; releasePointerCapture on a pointerId this element doesn't hold is a
            // spec no-op, but hasPointerCapture is the correct guard, not an unconditional
            // call.
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onPointerCancel={(e) => {
            // A gesture the browser aborts (drag out of the window, touch cancel) fires
            // this instead of pointerup. Without clearing drag.current here, the next bare
            // pointermove over the surface — no button held — would still pan.
            drag.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onLostPointerCapture={() => {
            // Capture can be lost without a pointerup/pointercancel ever reaching us (e.g.
            // another element steals it); leaving drag.current set would again let a bare
            // pointermove pan with no button held.
            drag.current = null;
          }}
        >
          <defs>
            <marker id="diagram-arrow" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
            </marker>
          </defs>
          {edges.map((e) => (
            <g key={e.key} data-testid="diagram-edge">
              <path d={e.d} fill="none" strokeWidth={1.5} markerEnd="url(#diagram-arrow)"
                className="stroke-muted-foreground" />
              {e.condition && (
                <text x={e.labelX} y={e.labelY - 4} textAnchor="middle" fontSize={10}
                  className="fill-muted-foreground">{e.condition}</text>
              )}
            </g>
          ))}
          {placed.map((p) => (
            <DiagramStep
              key={p.step.oid} placed={p} notation={spec.notation}
              onOpen={p.step.childSpecOid ? () => descend(p.step.childSpecOid!) : undefined}
            />
          ))}
        </svg>
      )}

      {unlinkedChildren.length > 0 && (
        <div className="space-y-1">
          {/* Children no proxy step claims. Without this they would be unreachable, and the
              Nodes outline this view replaces could reach every one of them. */}
          <div className="text-sm font-medium">Child workflows</div>
          <div className="flex flex-wrap gap-2">
            {unlinkedChildren.map((c) => (
              <Button key={c.oid} type="button" variant="outline" size="sm"
                aria-label={`Open ${c.name}`} onClick={() => descend(c.oid)}>{c.name}</Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
