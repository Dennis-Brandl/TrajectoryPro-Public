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
import type { PlacedStep } from './layout';
import { paletteFor } from './colors';
import { NOTATION_CONFIGS } from './notation';
import type { Notation } from '@/lib/api/types';

/** Timed GATE mark (spec 2026-10-13 §4.4). fill="none" so the light/dark fill wrappers can't tint it. */
function ClockMark({ cx, cy, r, stroke }: { cx: number; cy: number; r: number; stroke: string }) {
  return (
    <g data-testid="gate-clock">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={1} />
      <line x1={cx} y1={cy} x2={cx} y2={cy - r * 0.7} stroke={stroke} strokeWidth={1} />
      <line x1={cx} y1={cy} x2={cx + r * 0.6} y2={cy} stroke={stroke} strokeWidth={1} />
    </g>
  );
}

/**
 * One step, drawn at its authored position.
 *
 * Fills: Designer's pastels are used as-is in light mode. In dark mode they would glare, so
 * the stroke color at low opacity stands in — one palette, correct on both surfaces. The
 * light/dark switch is done with two stacked shapes and Tailwind's `dark:` variant rather
 * than reading the theme in JS, so it needs no re-render on toggle.
 */
export function DiagramStep({ placed, notation, onOpen }:
  { placed: PlacedStep; notation: Notation; onOpen?: () => void }) {
  const { step, x, y, width, height, shape } = placed;
  const { stroke, fill } = paletteFor(step.stepType);
  const config = NOTATION_CONFIGS[notation];
  const cx = x + width / 2;
  const cy = y + height / 2;

  const body = (() => {
    switch (shape) {
      case 'endpoint':
        return <circle cx={cx} cy={cy} r={width / 2 - 2} stroke={stroke} strokeWidth={1.5} />;
      case 'gateway':
        return notation === 'isa88'
          ? <rect x={x} y={y} width={width} height={height} stroke={stroke} strokeWidth={1.5} />
          : <polygon points={`${cx},${y} ${x + width},${cy} ${cx},${y + height} ${x},${cy}`}
              stroke={stroke} strokeWidth={1.5} />;
      case 'trapezoid':
        return step.stepType === 'CATCH'
          ? <polygon points={`${x},${y} ${x + width},${y} ${x + width * 0.77},${y + height} ${x + width * 0.23},${y + height}`}
              stroke={stroke} strokeWidth={1.5} />
          : <polygon points={`${x + width * 0.23},${y} ${x + width * 0.77},${y} ${x + width},${y + height} ${x},${y + height}`}
              stroke={stroke} strokeWidth={1.5} />;
      case 'gate':
        return notation === 'isa88'
          ? <g>
              {/* Thin centre-line stems from the gateway slot's connection points to the bars —
                  the classic SFC transition mark. Derived from this shape's own width/height
                  (the CM static renderer's own per-notation ISA-88 size), not the live diagrams'
                  60×60 simplification. */}
              <line x1={cx} y1={y} x2={cx} y2={cy - 5} stroke={stroke} strokeWidth={1} />
              <line x1={cx} y1={cy + 5} x2={cx} y2={y + height} stroke={stroke} strokeWidth={1} />
              <rect x={cx - width / 4} y={cy - 5} width={width / 2} height={3.5} stroke={stroke} strokeWidth={1} />
              <rect x={cx - width / 4} y={cy + 1.5} width={width / 2} height={3.5} stroke={stroke} strokeWidth={1} />
              {step.timedGate && <ClockMark cx={cx + width / 4 + 6} cy={cy} r={3.5} stroke={stroke} />}
            </g>
          : <g>
              <polygon points={`${cx},${y} ${x + width},${cy} ${cx},${y + height} ${x},${cy}`}
                stroke={stroke} strokeWidth={1.5} />
              {/* Parallel bars sit in the upper half so the "GATE" caption fits below them,
                  inside the diamond — the bars keep the fixed palette stroke colour, but the
                  caption needs its own class-based fill (not a `fill` attribute): `body` is
                  rendered twice under the light/dark `<g fill=...>` wrappers below, and a
                  `fill` attribute on the text would inherit through both, landing at ~1.8:1
                  contrast against the light-mode fill. amber-900 mirrors Designer's fixed
                  #78350f (8.1:1) for the same caption on the same fill; amber-500 keeps the
                  prior (already-legible) dark-mode colour. Same pattern as the step label's
                  `fill-foreground` below. */}
              {notation === 'bpmn'
                ? <><line x1={cx - 4} y1={cy - 15} x2={cx - 4} y2={cy - 3} stroke={stroke} strokeWidth={2} />
                    <line x1={cx + 4} y1={cy - 15} x2={cx + 4} y2={cy - 3} stroke={stroke} strokeWidth={2} />
                    <text x={cx} y={cy + 10} textAnchor="middle" fontSize={6} className="fill-amber-900 dark:fill-amber-500" fillOpacity={1}>GATE</text></>
                : <><line x1={cx - 8} y1={cy - 8} x2={cx + 8} y2={cy - 8} stroke={stroke} strokeWidth={2} />
                    <line x1={cx - 8} y1={cy - 1} x2={cx + 8} y2={cy - 1} stroke={stroke} strokeWidth={2} />
                    <text x={cx} y={cy + 12} textAnchor="middle" fontSize={8} className="fill-amber-900 dark:fill-amber-500" fillOpacity={1}>GATE</text></>}
              {step.timedGate && (notation === 'bpmn'
                ? <ClockMark cx={cx} cy={cy + 17} r={3} stroke={stroke} />
                : <ClockMark cx={cx} cy={cy - 18} r={4} stroke={stroke} />)}
            </g>;
      default:
        return <rect x={x} y={y} width={width} height={height} rx={config.rect.rx}
          stroke={stroke} strokeWidth={1.5} />;
    }
  })();

  // GATE steps show no name label — matching the Select1Node gateway convention (spec
  // 2026-08-30 symbol amendment); the shape's own "GATE" caption or bar mark stands in.
  const label = shape === 'gate' ? null : (
    <text x={cx} y={shape === 'rect' || shape === 'gateway' ? cy : y + height + 12}
      textAnchor="middle" dominantBaseline={shape === 'rect' || shape === 'gateway' ? 'middle' : 'hanging'}
      fontSize={config.rect.labelFontPx} className="fill-foreground pointer-events-none">
      {step.name.length > 22 ? `${step.name.slice(0, 21)}…` : step.name}
    </text>
  );

  const content = (
    <>
      {/* Light-mode fill */}
      <g fill={fill} className="dark:hidden">{body}</g>
      {/* Dark-mode fill: the same stroke color, faint, instead of a second palette */}
      <g fill={stroke} fillOpacity={0.18} className="hidden dark:block">{body}</g>
      {label}
    </>
  );

  const title = `${step.name} — ${step.stepType}`;

  // A proxy step that resolved to a child is a real, focusable control; everything else is
  // inert graphics with a <title> for assistive tech.
  if (onOpen) {
    return (
      <g role="button" tabIndex={0} aria-label={`Open ${step.name}`}
        className="cursor-pointer outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
        <title>{title}</title>
        {content}
      </g>
    );
  }
  return <g><title>{title}</title>{content}</g>;
}
