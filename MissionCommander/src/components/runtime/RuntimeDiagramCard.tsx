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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { useResourceView } from '@/lib/hooks/useResourceView';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { Button } from '@/components/ui/button';
import { WorkflowGraph } from './diagram/WorkflowGraph';
import { ForceCompleteControl } from './ForceCompleteControl';
import { gateTimerLine } from './gate-timer-text';
import { useNow } from '@/lib/hooks/useNow';
import { findSpecByOid, humaniseState, resolveDisplayState } from './diagram/state';
import type { DiagramStep, GateTimer, RuntimeWorkflowDiagram } from '@/lib/api/types';
import { isForceCompletable } from './force-completable';

export const RUNTIME_LIVE_STATES_POLL_MS = 2000;

// Same swatch set as the Pilot's Workflows tab legend (state.ts colorFor).
const LEGEND: Array<[string, string]> = [
  ['#6b7280', 'Idle'], ['#93c5fd', 'Waiting'], ['#3b82f6', 'Executing'],
  ['#eab308', 'Paused'], ['#4ade80', 'Completed'], ['#ef4444', 'Errored'],
];

type TooltipState = { step: DiagramStep; anchor: { x: number; y: number }; noChild?: boolean };

// Session-lifetime cache: the frozen recipe never changes after creation (Pilot precedent).
const diagramCache = new Map<string, RuntimeWorkflowDiagram>();

function GateTimerLine({ timer }: { timer: GateTimer }) {
  const now = useNow(1000);
  return <div className="text-xs text-muted-foreground">{gateTimerLine(timer, now)}</div>;
}

// The live diagram (spec 2026-08-27 §4.4): the ported Pilot WorkflowGraph fed by the CM's
// own read routes — recipe fetched once per instance, live states on the Pilot's 2 s
// cadence, drill-down into WORKFLOW PROXY children. A step tap opens the Phase-1 claim
// affordances (Assign an offer / Force-release a claim); Phases 2-3 add mode controls here.
export function RuntimeDiagramCard({ instanceId, canCommand, busy, onAssign, onForceRelease }: {
  instanceId: string;
  canCommand: boolean;
  busy: boolean;
  onAssign: (assignmentId: string, stepName: string) => void;
  onForceRelease: (assignmentId: string, stepName: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drill, setDrill] = useState<string[]>([]); // child spec oids, root first
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const diagramFetcher = useCallback(async (id: string) => {
    const cached = diagramCache.get(id);
    if (cached) return cached;
    const d = await runtimeWorkflows.diagram(id);
    diagramCache.set(id, d);
    return d;
  }, []);
  const { view: diagram } = useResourceView(instanceId, diagramFetcher, 'Failed to load diagram');

  const liveFetcher = useCallback(() => runtimeWorkflows.liveStates(instanceId), [instanceId]);
  const { view: live, stale } = usePolledView(
    `live-states:${instanceId}`, liveFetcher, 'Failed to load live states', RUNTIME_LIVE_STATES_POLL_MS,
  );

  useEffect(() => { setDrill([]); setTooltip(null); }, [instanceId]);

  const level = useMemo(() => {
    if (!diagram) return null;
    const top = drill[drill.length - 1];
    return top ? findSpecByOid(diagram.root, top) ?? diagram.root : diagram.root;
  }, [diagram, drill]);

  const states = useMemo(
    () => (level ? resolveDisplayState(level, live?.steps ?? {}) : new Map<string, string>()),
    [level, live],
  );
  const mineOids = useMemo(() => new Set<string>(), []); // commander view: no "yours" ring

  const onStepTap = (step: DiagramStep, anchor: { x: number; y: number }) => {
    if (step.stepType === 'WORKFLOW PROXY') {
      const resolvable = step.childSpecOid && diagram && findSpecByOid(diagram.root, step.childSpecOid);
      if (resolvable) {
        setDrill((d) => [...d, step.childSpecOid!]);
        setTooltip(null);
        return;
      }
      setTooltip({ step, anchor, noChild: true });
      return;
    }
    setTooltip({ step, anchor });
  };

  if (!diagram || !level) return null;

  const entry = tooltip ? live?.steps[tooltip.step.oid] : undefined;
  const holder = entry?.assignment
    ? (entry.assignment.status === 'claimed'
      ? (entry.assignment.claimant ? `Claimed by ${entry.assignment.claimant.displayName}` : 'Claimed')
      : 'Offered')
    : null;
  // GATE follow-up 8c: an ARMED gate (control_previous_action) names the ACTION PROXY it
  // controls — a sibling at this level — and where the arming stands.
  const armed = tooltip?.step.stepType === 'GATE' ? entry?.armedGate ?? null : null;
  // stopSent is an attempt marker the engine burns BEFORE any send attempt (gate.ts:88, §6.4) —
  // it never re-attempts, but several branches only log a WARNING instead of sending. So the
  // copy says "requested", never "sent" (which would claim delivery the engine can't promise).
  const armedLine = armed
    ? `Controls ${level.steps.find((s) => s.oid === armed.predecessorOid)?.name ?? armed.predecessorOid}`
      + (armed.stopSent ? ' · open, STOP requested' : armed.open ? ' · open, waiting for it to finish' : ' · evaluating')
    : null;

  return (
    <div className="space-y-2">
      {drill.length > 0 && (
        <nav aria-label="Workflow level" className="flex flex-wrap items-center gap-1 text-sm">
          <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => { setDrill([]); setTooltip(null); }}>
            {diagram.runtimeLabel} {diagram.masterName}
          </button>
          {drill.map((oid, i) => (
            <button key={oid} type="button" disabled={i === drill.length - 1}
              className="text-left underline-offset-2 enabled:hover:underline disabled:text-muted-foreground"
              onClick={() => { setDrill(drill.slice(0, i + 1)); setTooltip(null); }}>
              › {findSpecByOid(diagram.root, oid)?.name ?? oid}
            </button>
          ))}
        </nav>
      )}
      {stale && (
        <p className="text-xs text-muted-foreground" role="status">Diagram live view unavailable — showing last known state</p>
      )}
      <div ref={wrapRef} className="relative flex h-96 rounded border">
        <WorkflowGraph
          spec={level}
          states={states}
          mineOids={mineOids}
          highlightedStepOid={null}
          resetKey={`${instanceId}:${level.oid}`}
          onStepTap={onStepTap}
        />
        {tooltip && (
          <div className="absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border bg-popover p-2 text-sm text-popover-foreground shadow"
            style={{ left: tooltip.anchor.x, top: tooltip.anchor.y }}>
            <div className="font-semibold">{tooltip.step.name}</div>
            <div className="text-xs text-muted-foreground">
              {tooltip.step.stepType} · <span>{humaniseState(states.get(tooltip.step.oid) ?? 'IDLE')}</span>
            </div>
            {holder && <div className="text-xs text-muted-foreground">{holder}</div>}
            {armedLine && <div className="text-xs text-muted-foreground">{armedLine}</div>}
            {entry?.gateTimer && <GateTimerLine timer={entry.gateTimer} />}
            {tooltip.noChild && <div className="text-xs text-muted-foreground">Child workflow not available</div>}
            {entry?.error && <div className="max-w-64 whitespace-normal text-xs text-destructive">{entry.error}</div>}
            <div className="mt-1 flex gap-2">
              {canCommand && entry?.assignment?.status === 'offered' && (
                <Button type="button" size="sm" disabled={busy}
                  onClick={() => { setTooltip(null); onAssign(entry.assignment!.id, tooltip.step.name); }}>
                  Assign
                </Button>
              )}
              {canCommand && entry?.assignment?.status === 'claimed' && (
                <Button type="button" size="sm" variant="destructive" disabled={busy}
                  onClick={() => { setTooltip(null); onForceRelease(entry.assignment!.id, tooltip.step.name); }}>
                  Force release
                </Button>
              )}
              {canCommand && entry && isForceCompletable(tooltip.step.stepType, entry.state) && entry.stepInstanceId && (
                <ForceCompleteControl instanceId={instanceId} stepInstanceId={entry.stepInstanceId}
                  stepName={tooltip.step.name} disabled={busy} timer={entry.gateTimer ?? undefined}
                  onSuccess={() => setTooltip(null)} />
              )}
              <Button type="button" size="sm" variant="ghost" aria-label="Close" onClick={() => setTooltip(null)}>×</Button>
            </div>
          </div>
        )}
      </div>
      <p className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {LEGEND.map(([color, label]) => (
          <span key={label} className="flex items-center gap-1">
            <span className="inline-block size-3 rounded-sm" style={{ background: color }} /> {label}
          </span>
        ))}
      </p>
    </div>
  );
}
