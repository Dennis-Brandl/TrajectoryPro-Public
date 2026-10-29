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
import { useMemo } from 'react'
import type { SizeAt, TypeToken } from '@mission/form-schema'
import { useFormRenderer } from '../context'
import { guardAuthoredColor } from '../color-guard'

/**
 * Map a type-scale token (and its per-device overrides) to controls.css font-size classes.
 * Overrides add a class only when set, so a block without `sizeAt` keeps today's class list.
 */
export function sizeClasses(
  size: TypeToken | undefined,
  sizeAt: SizeAt | undefined,
  fallback: TypeToken,
): string {
  let out = `tfk-size-${size ?? fallback}`
  if (sizeAt?.tablet) out += ` tfk-size-tablet-${sizeAt.tablet}`
  if (sizeAt?.phone) out += ` tfk-size-phone-${sizeAt.phone}`
  return out
}

/** Map an authored text alignment to its controls.css class ('' when unset). */
export function alignClass(align: 'left' | 'center' | 'right' | undefined): string {
  return align ? ` tfk-text-${align}` : ''
}

/**
 * The `*` is decorative — assistive tech learns required-ness from the control's
 * `aria-required`, so announcing "asterisk" as well would be noise.
 */
function LabelText({ label, required }: { label: string; required: boolean | undefined }) {
  return (
    <>
      {label}
      {required && (
        <span className="tfk-required" aria-hidden="true">
          {' *'}
        </span>
      )}
    </>
  )
}

/** Stacked field label (spec §3.2: labels always stack above the control). */
export function FieldLabel({
  label,
  required,
  htmlFor,
}: {
  label: string | undefined
  required: boolean | undefined
  htmlFor?: string
}) {
  if (!label) return null
  return (
    <label className="tfk-label" htmlFor={htmlFor}>
      <LabelText label={label} required={required} />
    </label>
  )
}

/**
 * Label for a checkbox/radio `<fieldset>`.
 *
 * `<legend>` rather than `<label>`: a label with no control to point at names
 * nothing, whereas a legend is the group's accessible name.
 *
 * Required-ness rides in the accessible name as visually-hidden text rather than
 * `aria-required`, because `<fieldset>` maps to role `group`, which has no such
 * state — and putting it on each checkbox would claim every option is individually
 * required. Radio groups could use `role="radiogroup"` + `aria-required` instead,
 * but then the two group kinds would announce required-ness differently; one way for
 * both is worth more than the purer state on one of them.
 */
export function GroupLabel({
  label,
  required,
}: {
  label: string | undefined
  required: boolean | undefined
}) {
  if (!label) return null
  return (
    <legend className="tfk-label">
      <LabelText label={label} required={required} />
      {required && <span className="tfk-sr-only"> (required)</span>}
    </legend>
  )
}

// Resolves named colours and hsl() for the guard. Kept for the page's lifetime: a
// document reuses a handful of authored colours.
const resolved = new Map<string, string | null>()

// Values that follow their context, the light/dark mode or the system palette rather than
// naming one colour: never resolved, so never cached — the guard keeps them, as it keeps
// anything it cannot judge.
const CONTEXTUAL =
  /currentcolor|var\(|light-dark\(|^(inherit|initial|unset|revert(-layer)?|accentcolor|accentcolortext|activetext|buttonborder|buttonface|buttontext|canvas|canvastext|field|fieldtext|graytext|highlight|highlighttext|linktext|mark|marktext|selecteditem|selecteditemtext|visitedtext)$/i

export function isContextualColor(color: string): boolean {
  return CONTEXTUAL.test(color.trim())
}

function resolveCssColor(color: string): string | null {
  if (typeof document === 'undefined' || !document.body || isContextualColor(color)) return null
  if (resolved.has(color)) return resolved.get(color)!
  const probe = document.createElement('span')
  probe.style.color = color
  probe.style.display = 'none'
  document.body.appendChild(probe)
  try {
    const value = window.getComputedStyle(probe).color || null
    resolved.set(color, value)
    return value
  } finally {
    probe.remove()
  }
}

/** The authored colour to draw, or undefined when it is unreadable on the host's surface (spec §14). */
export function useAuthoredColor(color: string | undefined): string | undefined {
  const { surfaceColor } = useFormRenderer()
  return guardAuthoredColor(color, surfaceColor, resolveCssColor)
}

/**
 * Sanitized rich text with the same guard applied to colours set on selected text
 * (`<span style="color:…">` from Designer's content editor). Only the colour goes; the
 * text and any other inline styling stay. Unchanged when the host passes no surface.
 */
export function useGuardedHtml(html: string): string {
  const { surfaceColor } = useFormRenderer()
  return useMemo(() => {
    if (!surfaceColor || typeof document === 'undefined' || !html.includes('color')) return html
    const template = document.createElement('template')
    template.innerHTML = html
    let changed = false
    for (const el of template.content.querySelectorAll<HTMLElement>('[style]')) {
      const color = el.style.color
      if (color && guardAuthoredColor(color, surfaceColor, resolveCssColor) === undefined) {
        el.style.removeProperty('color')
        if (!el.getAttribute('style')?.trim()) el.removeAttribute('style')
        changed = true
      }
    }
    return changed ? template.innerHTML : html
  }, [html, surfaceColor])
}
