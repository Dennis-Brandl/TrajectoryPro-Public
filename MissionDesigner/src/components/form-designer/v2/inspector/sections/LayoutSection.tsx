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
import type { Block, BlockLayout, GridSpan, SpaceToken } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { resolveBp, setBp, clearBp, isOverridden } from '@/lib/form-document/layout-ops'
import { ownRowTarget, rowAboveTarget } from '@/lib/form-document/column-ops'

const field: React.CSSProperties = { marginBottom: 10 }
const labelCls = 'text-gray-500 dark:text-gray-400'
const labelSt: React.CSSProperties = { fontSize: 11, display: 'block', marginBottom: 2 }
const inputCls = 'bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600'
const inputSt: React.CSSProperties = {
  width: '100%',
  fontSize: 13,
  padding: '4px 8px',
  borderRadius: 4,
  boxSizing: 'border-box',
}
const SPANS: GridSpan[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

export function LayoutSection({ block, onUpdate }: { block: Block; onUpdate: (patch: Partial<Block>) => void }) {
  const bp = useFormDocumentStore((s) => s.activeBreakpoint)
  const formDoc = useFormDocumentStore((s) => s.document)
  const arrangeColumns = useFormDocumentStore((s) => s.arrangeColumns)
  const moveIntoRowAbove = useFormDocumentStore((s) => s.moveIntoRowAbove)
  const moveToOwnRow = useFormDocumentStore((s) => s.moveToOwnRow)
  const layout: BlockLayout = block.layout ?? {}
  const isImage = block.type === 'image'
  const write = (next: BlockLayout) => onUpdate({ layout: next } as Partial<Block>)

  // Reset Order to automatic (DOM order) for the active breakpoint. On base this drops the
  // field entirely; on tablet/phone it clears just the override so it inherits desktop.
  const clearOrder = () => {
    if (layout.order === undefined) return
    if (bp === 'base') {
      const { order: _o, ...rest } = layout
      write(rest)
    } else {
      write({ ...layout, order: clearBp(layout.order, resolveBp(layout.order, 'base', 0), bp) })
    }
  }

  const span = resolveBp(layout.span, bp, 12)
  const visible = resolveBp(layout.visible, bp, true)
  const overridden = isOverridden(layout.span, bp) || isOverridden(layout.visible, bp) || isOverridden(layout.order, bp)

  return (
    <div style={{ padding: '4px 12px 12px' }}>
      {/* Columns: rows are how a form gets columns; these are the click alternative to dragging. */}
      <div style={field}>
        <span className={labelCls} style={labelSt}>
          Columns in this row
        </span>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={n === 1 ? 'Arrange in 1 column' : `Arrange in ${n} columns`}
              title={`Make this row hold ${n} element${n === 1 ? '' : 's'} side by side, pulling elements up from the rows below or pushing extras down`}
              onClick={() => arrangeColumns(block.id, n)}
              className={inputCls}
              style={{ ...inputSt, width: 'auto', flex: 1, cursor: 'pointer' }}
            >
              {n}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            title="Put this element beside the elements in the row above"
            disabled={!rowAboveTarget(formDoc, block.id)}
            onClick={() => moveIntoRowAbove(block.id)}
            className={inputCls}
            style={{ ...inputSt, width: 'auto', flex: 1, fontSize: 11, cursor: 'pointer' }}
          >
            Move into row above
          </button>
          <button
            type="button"
            title="Take this element out of its row onto a new full-width row below"
            disabled={!ownRowTarget(formDoc, block.id)}
            onClick={() => moveToOwnRow(block.id)}
            className={inputCls}
            style={{ ...inputSt, width: 'auto', flex: 1, fontSize: 11, cursor: 'pointer' }}
          >
            Move to its own row
          </button>
        </div>
      </div>

      {/* Span (per-breakpoint) */}
      <div style={field}>
        <label htmlFor="tfk-span" className={labelCls} style={labelSt}>
          Span
        </label>
        <select
          id="tfk-span"
          value={span}
          onChange={(e) => write({ ...layout, span: setBp(layout.span, 12, bp, Number(e.target.value) as GridSpan) })}
          className={inputCls}
          style={inputSt}
        >
          {SPANS.map((n) => (
            <option key={n} value={n}>
              {n} / 12
            </option>
          ))}
        </select>
      </div>

      {/* Visible (per-breakpoint) */}
      <div style={field}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => write({ ...layout, visible: setBp(layout.visible, true, bp, e.target.checked) })}
          />
          <span className="text-gray-700 dark:text-slate-200" style={{ fontSize: 13 }}>
            Visible on {bp}
          </span>
        </label>
      </div>

      {/* Order (per-breakpoint); empty input or the Auto button = unset (DOM order) */}
      <div style={field}>
        <label htmlFor="tfk-order" className={labelCls} style={labelSt}>
          Order ({bp})
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            id="tfk-order"
            type="number"
            value={layout.order === undefined ? '' : String(resolveBp(layout.order, bp, 0))}
            placeholder="auto"
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                clearOrder()
              } else {
                write({ ...layout, order: setBp(layout.order, 0, bp, Number(raw)) })
              }
            }}
            className={inputCls}
            style={{ ...inputSt, flex: 1 }}
          />
          <button
            type="button"
            onClick={clearOrder}
            disabled={layout.order === undefined}
            aria-label="Reset order to automatic"
            title="Automatic order (DOM order)"
            className="bg-gray-50 dark:bg-slate-800 text-gray-700 dark:text-slate-300 border border-gray-300 dark:border-gray-600 disabled:opacity-40"
            style={{
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 4,
              cursor: layout.order === undefined ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Auto
          </button>
        </div>
      </div>

      {/* Clear override (tablet/phone only) */}
      {bp !== 'base' && overridden && (
        <button
          type="button"
          onClick={() =>
            write({
              ...layout,
              span: clearBp(layout.span, 12, bp),
              visible: clearBp(layout.visible, true, bp),
              ...(layout.order ? { order: clearBp(layout.order, resolveBp(layout.order, 'base', 0), bp) } : {}),
            })
          }
          className="text-blue-600 dark:text-blue-400"
          style={{
            fontSize: 11,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            marginBottom: 10,
            padding: 0,
          }}
        >
          Clear {bp} override (inherit desktop)
        </button>
      )}

      {/* Align (global) */}
      <div style={field}>
        <label htmlFor="tfk-align" className={labelCls} style={labelSt}>
          Align
        </label>
        <select
          id="tfk-align"
          value={layout.align ?? 'start'}
          onChange={(e) => write({ ...layout, align: e.target.value as 'start' | 'center' | 'end' })}
          className={inputCls}
          style={inputSt}
        >
          <option value="start">Start</option>
          <option value="center">Center</option>
          <option value="end">End</option>
        </select>
      </div>

      {/* Min height (global; SpaceToken only — an existing {rem} value is left untouched until changed) */}
      <div style={field}>
        <label htmlFor="tfk-minheight" className={labelCls} style={labelSt}>
          Min Height
        </label>
        <select
          id="tfk-minheight"
          value={typeof layout.minHeight === 'string' ? layout.minHeight : ''}
          onChange={(e) => {
            const v = e.target.value
            if (v === '') {
              const { minHeight: _m, ...rest } = layout
              write(rest)
            } else {
              write({ ...layout, minHeight: v as SpaceToken })
            }
          }}
          className={inputCls}
          style={inputSt}
        >
          <option value="">(unset)</option>
          {(['none', 'xs', 'sm', 'md', 'lg', 'xl'] as const).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {/* Max width (global; readable-measure cap in ch or rem) */}
      <div style={field}>
        <label htmlFor="tfk-maxwidth" className={labelCls} style={labelSt}>
          Max Width
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            id="tfk-maxwidth"
            type="number"
            value={layout.maxWidth ? String('ch' in layout.maxWidth ? layout.maxWidth.ch : layout.maxWidth.rem) : ''}
            placeholder="unset"
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                const { maxWidth: _w, ...rest } = layout
                write(rest)
                return
              }
              const unit = layout.maxWidth && 'rem' in layout.maxWidth ? 'rem' : 'ch'
              write({ ...layout, maxWidth: { [unit]: Number(raw) } as { ch: number } | { rem: number } })
            }}
            className={inputCls}
            style={{ ...inputSt, flex: 1 }}
          />
          <select
            aria-label="Max width unit"
            value={layout.maxWidth && 'rem' in layout.maxWidth ? 'rem' : 'ch'}
            onChange={(e) => {
              if (!layout.maxWidth) return
              const n = 'ch' in layout.maxWidth ? layout.maxWidth.ch : layout.maxWidth.rem
              write({ ...layout, maxWidth: { [e.target.value]: n } as { ch: number } | { rem: number } })
            }}
            className={inputCls}
            style={{ ...inputSt, width: 70 }}
          >
            <option value="ch">ch</option>
            <option value="rem">rem</option>
          </select>
        </div>
      </div>

      {/* Aspect ratio (global; required for images) */}
      {(isImage || block.type === 'video') && (
        <div style={field}>
          <label htmlFor="tfk-aspect" className={labelCls} style={labelSt}>
            Aspect Ratio
          </label>
          <input
            id="tfk-aspect"
            value={layout.aspectRatio ?? (isImage ? '16/9' : '')}
            onChange={(e) => {
              const v = e.target.value
              if (v === '') {
                const { aspectRatio: _omit, ...rest } = layout
                write(rest)
              } else {
                write({ ...layout, aspectRatio: v })
              }
            }}
            className={inputCls}
            style={inputSt}
            placeholder="16/9"
          />
        </div>
      )}
    </div>
  )
}
