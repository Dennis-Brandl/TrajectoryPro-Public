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
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type {
  BreakpointKey,
  FormDocument,
  FormEvent,
  FormValues,
  Row,
  Section,
  SignatureDraft,
} from '@mission/form-schema'
import { computeValidation, documentHasRowsAt, resolveSectionRows } from '@mission/form-schema'
import { blockLayoutClasses } from './blockClasses'
import { FormRendererContext, type ButtonJobs, type TimerRun, useFormRenderer } from './context'
import { renderBlock } from './blocks/index'

export interface FormDocumentViewProps {
  document: FormDocument
  /** 'run' (default) for the UI-host; 'edit' for Mission Designer's form-designer overlay. */
  mode?: 'run' | 'edit'
  /** Host-owned field state (controlled). */
  values?: FormValues
  /**
   * Resolve non-URL image src keys (spec image map / package assets).
   *
   * Pass a stable reference: an inline arrow invalidates the renderer context on every
   * render, which matters once block views are memoized.
   */
  images?: (srcKey: string) => string | undefined
  /**
   * Workflow event sink. Never called in edit mode.
   *
   * `validation` is emitted on exactly three triggers — a `fieldChange`, a `signature`,
   * and a timer settling. It is NOT emitted on mount, on a host-driven `values` change, or on a
   * `document` change, so a host must compute the initial gate itself and recompute
   * it on every screen change. See `docs/HOST-CONTRACT.md` §2.
   *
   * Hosts must also key this component per screen (`key={screenId}`): the settled-timer
   * set is private state that is never reset when `document` changes, and the remount is
   * what discards it. See `docs/HOST-CONTRACT.md` §3.
   */
  onEvent?: (event: FormEvent) => void
  /**
   * Host-owned e-signature draft (spec 2026-09-06 D2/D3). Read by the esignature block;
   * never merged into `values`. Pass the same object you pass to `computeValidation`.
   */
  signature?: SignatureDraft | null
  /** Server-side signature failure, shown inline under the esignature fields. */
  signatureError?: string | null
  /** Advisory shown above the esignature fields, e.g. "Must be signed by someone other than Jane". */
  signatureHint?: string | null
  /**
   * The colour the form is drawn on, resolved (`#hex` or `rgb()`), e.g. from
   * `getComputedStyle` of `var(--form-color-surface)`. When set, an author's text, header,
   * button or divider colour below 3:1 against it is dropped and the block keeps the theme
   * colour (HOST-CONTRACT §7). Omit it to draw authored colours as authored.
   */
  surfaceColor?: string | null
  /**
   * State for the form's job buttons (Continue/Yes/No), with the same gating the host applies
   * to its own buttons. Honoured in both modes for labels; job events never fire in edit mode.
   * See `docs/HOST-CONTRACT.md` §8.
   */
  buttonJobs?: ButtonJobs
  /**
   * Draw this screen type's rows. Omit it and the renderer measures its own width, using the
   * same thresholds as layout.css (desktop >= 1024px, tablet >= 600px, phone below).
   * Only a section with `rowsAt` changes rows; spans, order and visibility always follow
   * the container queries in layout.css.
   */
  breakpoint?: BreakpointKey
  className?: string
}

/** The screen type for a container width, matching layout.css's container queries. */
export function breakpointForWidth(width: number): BreakpointKey {
  if (width >= 1024) return 'base'
  if (width >= 600) return 'tablet'
  return 'phone'
}

/**
 * The screen type of the viewport element, kept current as it resizes. Only measured when
 * `enabled` (a document with per-screen rows), so other forms do no layout work at all.
 * Measured before paint, so a phone never flashes the desktop rows first. Without a width
 * (no layout engine, e.g. jsdom) it stays on desktop.
 */
function useContainerBreakpoint(ref: RefObject<HTMLDivElement | null>, enabled: boolean): BreakpointKey {
  const [bp, setBp] = useState<BreakpointKey>('base')
  useLayoutEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const apply = (width: number) => {
      if (width > 0) setBp(breakpointForWidth(width))
    }
    apply(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) apply(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, enabled])
  return bp
}

/** Stable identity, so omitting `values` does not invalidate the context every render. */
const EMPTY_VALUES: FormValues = {}

export function FormDocumentView({
  document: doc,
  mode = 'run',
  values = EMPTY_VALUES,
  onEvent,
  images,
  signature = null,
  signatureError = null,
  signatureHint = null,
  surfaceColor = null,
  buttonJobs,
  breakpoint,
  className,
}: FormDocumentViewProps) {
  const [settledTimers] = useState(() => new Set<string>())
  const [timerRuns] = useState(() => new Map<string, TimerRun>())
  const viewportRef = useRef<HTMLDivElement>(null)
  const perScreenRows = useMemo(() => documentHasRowsAt(doc), [doc])
  const measured = useContainerBreakpoint(viewportRef, perScreenRows && breakpoint === undefined)
  const tier: BreakpointKey = breakpoint ?? (perScreenRows ? measured : 'base')

  const contextValue = useMemo(
    () => ({
      mode,
      values,
      resolveImage: images ?? (() => undefined),
      signature,
      signatureError,
      signatureHint,
      surfaceColor,
      buttonJobs: buttonJobs ?? null,
      timerRuns,
      emit: (event: FormEvent) => {
        if (mode !== 'run') return
        onEvent?.(event)
        if (event.kind === 'fieldChange') {
          const nextValues = { ...values, [event.fieldName]: event.value }
          onEvent?.({ kind: 'validation', ...computeValidation(doc, nextValues, settledTimers, signature) })
        } else if (event.kind === 'signature') {
          const nextDraft = { loginName: event.loginName, password: event.password }
          onEvent?.({ kind: 'validation', ...computeValidation(doc, values, settledTimers, nextDraft) })
        }
      },
    }),
    [
      mode,
      values,
      onEvent,
      images,
      doc,
      settledTimers,
      timerRuns,
      signature,
      signatureError,
      signatureHint,
      surfaceColor,
      buttonJobs,
    ],
  )

  const handleTimerSettle = (fieldName: string) => {
    if (mode !== 'run') return
    settledTimers.add(fieldName)
    onEvent?.({ kind: 'validation', ...computeValidation(doc, values, settledTimers, signature) })
  }

  const content = doc.sections.filter((s) => s.role === 'content')
  const footer = doc.sections.filter((s) => s.role === 'footer')

  return (
    <FormRendererContext.Provider value={contextValue}>
      <div
        ref={viewportRef}
        className={['tfk-viewport', className].filter(Boolean).join(' ')}
        data-mode={mode}
        data-rows-breakpoint={perScreenRows ? tier : undefined}
      >
        <div className="tfk-scroll">
          {content.map((section) => (
            <SectionView key={section.id} section={section} bp={tier} onTimerSettle={handleTimerSettle} />
          ))}
        </div>
        {footer.length > 0 && (
          <div className="tfk-footer">
            {footer.map((section) => (
              <SectionView key={section.id} section={section} bp={tier} onTimerSettle={handleTimerSettle} />
            ))}
          </div>
        )}
      </div>
    </FormRendererContext.Provider>
  )
}

function SectionView({
  section,
  bp,
  onTimerSettle,
}: {
  section: Section
  bp: BreakpointKey
  onTimerSettle: (fieldName: string) => void
}) {
  const rows = resolveSectionRows(section, bp)
  return (
    <section className="tfk-section" data-section-id={section.id} data-section-role={section.role}>
      {rows.map((row) => (
        <RowView key={row.id} row={row} onTimerSettle={onTimerSettle} />
      ))}
    </section>
  )
}

function RowView({ row, onTimerSettle }: { row: Row; onTimerSettle: (fieldName: string) => void }) {
  const { mode } = useFormRenderer()
  return (
    <div className={`tfk-row tfk-gap-${row.gap ?? 'md'}`} data-row-id={row.id}>
      {row.blocks.map((block) => (
        <div
          key={block.id}
          className={blockLayoutClasses(block.layout)}
          data-block-id={block.id}
          data-block-type={block.type}
          inert={mode === 'edit' ? true : undefined}
        >
          {renderBlock(block, onTimerSettle)}
        </div>
      ))}
    </div>
  )
}
