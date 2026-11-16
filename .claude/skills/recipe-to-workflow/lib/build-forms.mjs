// Recipe spec -> form documents, plus the phone height budget.
//
// The skill's job is to turn prose into a *recipe spec* (reference/recipe-spec.md).
// This module turns one step of that spec into a Trajectory Form Document v2, so the
// fiddly parts — OIDs, breakpoint spans, the phone height budget — are computed once
// here instead of being retyped per recipe.
//
// Everything is deterministic: the same spec always produces byte-identical JSON, so
// regenerating a recipe shows a clean diff.

import { artDataUri } from './line-art.mjs'
import { creditLine } from './photos.mjs'

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Trajectory OIDs are snowflake-shaped numeric strings. Real ones come from
 * generateOID(); generated files mint theirs from a hash of a stable seed so a
 * rebuild does not churn every id. 18 digits keeps them snowflake-shaped and clear
 * of any live allocator, which is time-based and will not collide with a
 * hash-derived value in practice.
 */
export function oid(seed) {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193) >>> 0
    h2 = Math.imul(h2 + seed.charCodeAt(i) + i, 0x85ebca6b) >>> 0
  }
  const digits = (BigInt(h1) * 1000000007n + BigInt(h2)).toString().padStart(12, '7')
  return ('9' + digits).slice(0, 18).padEnd(18, '3')
}

export const ISO = '2026-01-01T00:00:00.000Z'

// ---------------------------------------------------------------------------
// Phone budget
//
// "Limited scrolling on the phone" is enforced, not hoped for: every screen is
// measured against the space a phone actually leaves for form content, and the
// build refuses to emit a recipe whose screen overflows. The numbers below are
// deliberately conservative. This is a budget, not a renderer: it exists to catch
// a step that is trying to say too much, and the fix is to split the step.
// ---------------------------------------------------------------------------

export const PHONE = {
  width: 360,
  /** Viewport minus OS chrome, Pilot's step header, and the fixed button bar. */
  usableHeight: 560,
  charsPerLine: 34,
  lineHeight: 20,
  headerHeight: 34,
  timerHeight: 96,
  dividerHeight: 13,
  rowGap: 12,
}

function wrapLines(text, charsPerLine) {
  let lines = 0
  for (const para of String(text).split('\n')) {
    lines += Math.max(1, Math.ceil(para.length / Math.max(8, charsPerLine)))
  }
  return lines
}

/** Height a block costs on the phone, given the span it occupies there. */
function phoneBlockHeight(block, span) {
  switch (block.type) {
    case 'header':
      return PHONE.headerHeight + (wrapLines(block.content, PHONE.charsPerLine - 6) - 1) * 24
    case 'text':
      return wrapLines(block.content, Math.round((PHONE.charsPerLine * span) / 12)) * PHONE.lineHeight
    case 'image': {
      const w = (PHONE.width * span) / 12
      const ratio = (block.layout && block.layout.aspectRatio) || '1/1'
      const parts = ratio.split('/').map(Number)
      const scale = (block.scalePercentAt && block.scalePercentAt.phone ? block.scalePercentAt.phone : 100) / 100
      return w * (parts[1] / parts[0]) * scale
    }
    case 'timer':
      return PHONE.timerHeight
    case 'divider':
      return PHONE.dividerHeight
    case 'textInput':
      return 64
    case 'textarea':
      return 24 + (block.rows || 3) * PHONE.lineHeight
    case 'radio':
    case 'checkbox':
      return 24 + block.options.length * 34
    default:
      return 32
  }
}

function atPhone(per, fallback) {
  if (!per) return fallback
  if (per.phone !== undefined) return per.phone
  if (per.tablet !== undefined) return per.tablet
  if (per.base !== undefined) return per.base
  return fallback
}

/**
 * Estimated height of a form document on the phone, honouring phone visibility,
 * phone spans, and the phone row regrouping when a section has one.
 */
export function estimatePhoneHeight(doc) {
  let total = 0
  for (const section of doc.sections) {
    const byId = new Map()
    for (const row of section.rows) for (const b of row.blocks) byId.set(b.id, b)
    const rows =
      section.rowsAt && section.rowsAt.phone
        ? section.rowsAt.phone.map((r) => r.blockIds.map((id) => byId.get(id)).filter(Boolean))
        : section.rows.map((r) => r.blocks)
    for (const blocks of rows) {
      const shown = blocks.filter((b) => atPhone(b.layout && b.layout.visible, true) !== false)
      if (shown.length === 0) continue
      let tallest = 0
      for (const b of shown) {
        const span = atPhone(b.layout && b.layout.span, 12)
        tallest = Math.max(tallest, phoneBlockHeight(b, span))
      }
      total += tallest + PHONE.rowGap
    }
  }
  return Math.round(total)
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function textBlock(id, content, opts) {
  const o = opts || {}
  const block = {
    id,
    type: 'text',
    content,
    size: o.size || 'md',
    sizeAt: o.sizeAt || { phone: 'sm' },
  }
  if (o.layout) block.layout = o.layout
  return block
}

function headerBlock(id, content) {
  return {
    id,
    type: 'header',
    content,
    size: 'xl',
    sizeAt: { tablet: 'lg', phone: 'md' },
    layout: { span: { base: 12 } },
  }
}

export function fieldName(label) {
  const base = String(label)
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '')
  return base || 'Field'
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

/**
 * Past this many characters of body text, the phone drops the drawing instead of
 * keeping it beside the text. Two columns at 360px would wrap the text into a
 * ribbon and push the step over the height budget.
 *
 * Hiding a drawing is always safe. Only required inputs and blockDone timers may
 * not be hidden (form-schema's findHiddenRequired), and neither is ever hidden here.
 */
const PHONE_PAIR_BUDGET = 110

/**
 * An instruction screen: title, optional picture, body, optional note, optional timer.
 *
 * A step takes either `art` (a line drawing, inline) or `photo` (a Commons title,
 * packaged under images/). A photograph is given its own full-width row rather than
 * being set beside the text: it carries detail worth seeing, and it needs a credit
 * line directly beneath it.
 *
 * `images` collects {imageOid, filename} for the caller, which turns them into the
 * step's form_element_images and the package's images/ entries.
 */
export function instructionScreen(seed, step, photos = {}, images = []) {
  const id = (suffix) => oid(seed + ':' + suffix)
  const rows = [{ id: id('row-title'), blocks: [headerBlock(id('title'), step.title)] }]

  if (step.photo) {
    const entry = photos[step.photo]
    if (!entry) {
      throw new Error(
        'step "' + step.title + '" references ' + step.photo +
          ' but it is not in photos/credits.json — run `node lib/fetch-photos.mjs` first',
      )
    }
    const imageOid = id('photo-oid')
    images.push({ imageOid, filename: entry.filename })
    rows.push({
      id: id('row-photo'),
      blocks: [
        {
          id: id('photo'),
          type: 'image',
          // A bare filename, not a data URI: Commander resolves it against the
          // package's images/ folder, falling back to {imageOid}-{filename}.
          src: entry.filename,
          imageOid,
          objectFit: 'cover',
          scalePercentAt: { tablet: 85, phone: 70 },
          layout: {
            span: { base: 8, tablet: 10, phone: 12 },
            aspectRatio: '4/3',
            align: 'center',
          },
        },
      ],
    })
    rows.push({
      id: id('row-credit'),
      blocks: [
        textBlock(id('credit'), creditLine(entry), {
          size: 'xs',
          sizeAt: { phone: 'xs' },
          layout: { span: { base: 12 }, align: 'center' },
        }),
      ],
    })
  }

  const bodyBlocks = []
  const pairOnPhone = Boolean(step.art) && step.body.length <= PHONE_PAIR_BUDGET
  if (step.art) {
    bodyBlocks.push({
      id: id('art'),
      type: 'image',
      src: artDataUri(step.art),
      objectFit: 'contain',
      scalePercentAt: { phone: 70 },
      layout: {
        span: { base: 3, tablet: 4, phone: pairOnPhone ? 4 : 12 },
        aspectRatio: '1/1',
        align: 'center',
        visible: { base: true, tablet: true, phone: pairOnPhone },
      },
    })
  }
  bodyBlocks.push(
    textBlock(id('body'), step.body, {
      layout: {
        span: {
          base: step.art ? 9 : 12,
          tablet: step.art ? 8 : 12,
          phone: pairOnPhone ? 8 : 12,
        },
      },
    }),
  )
  rows.push({ id: id('row-body'), blocks: bodyBlocks })

  if (step.note) {
    rows.push({
      id: id('row-note'),
      blocks: [
        textBlock(id('note'), step.note, {
          size: 'sm',
          sizeAt: { phone: 'xs' },
          layout: { span: { base: 12 } },
        }),
      ],
    })
  }

  if (step.timer) {
    const minutes = step.timer.minutes || 0
    const seconds = step.timer.seconds || 0
    rows.push({
      id: id('row-timer'),
      blocks: [
        {
          id: id('timer'),
          type: 'timer',
          label: step.timer.label,
          fieldName: fieldName(step.timer.label),
          durationSeconds: Math.round(minutes * 60 + seconds),
          direction: 'countdown',
          blockDone: step.timer.blockDone === true,
          layout: { span: { base: 6, tablet: 8, phone: 12 }, align: 'center' },
        },
      ],
    })
  }

  return { version: 2, sections: [{ id: id('sec'), role: 'content', rows }] }
}

/** A bulleted list screen. Long lists are split by the caller, not here. */
export function listScreen(seed, title, lines, intro) {
  const id = (suffix) => oid(seed + ':' + suffix)
  const rows = [{ id: id('row-title'), blocks: [headerBlock(id('title'), title)] }]
  if (intro) {
    rows.push({
      id: id('row-intro'),
      blocks: [textBlock(id('intro'), intro, { size: 'sm', layout: { span: { base: 12 } } })],
    })
  }
  const bullet = String.fromCharCode(0x2022) + ' '
  rows.push({
    id: id('row-list'),
    blocks: [textBlock(id('list'), lines.map((l) => bullet + l).join('\n'), { layout: { span: { base: 12 } } })],
  })
  return { version: 2, sections: [{ id: id('sec'), role: 'content', rows }] }
}

/** The equipment question: a required radio whose answer drives every SELECT 1. */
/**
 * The one name that ties the question screen to its branch.
 *
 * It is used in four places and they must all agree:
 *   - the radio block's `outputParameter`               (what the user answered)
 *   - the step's output_parameter_specifications `id`   (what the step declares)
 *   - that specification's `target`                     (where the engine stores it)
 *   - the SELECT 1's `input_name`                       (what the branch reads)
 *
 * It is deliberately dotted. `id` and `target` are kept identical so the string is
 * the same on every surface: the engine resolves the block's outputParameter to the
 * matching spec and writes `target` (MissionEngine/src/core/properties.ts
 * captureFormOutputs), Designer's SELECT 1 source picker offers a step's output
 * parameters by name (hooks/useSourcePickerExtraGroups.ts), and the dotted form is
 * also offered under Value Properties because the workflow declares the property
 * with a `Value` entry. Name it `OvenType` and target it `OvenType.Value` and the
 * two pickers disagree about what to type into the branch.
 */
export function questionOutputName(question) {
  return question.property + '.Value'
}

export function questionScreen(seed, question) {
  const id = (suffix) => oid(seed + ':' + suffix)
  const rows = [{ id: id('row-title'), blocks: [headerBlock(id('title'), question.prompt)] }]
  if (question.help) {
    rows.push({
      id: id('row-help'),
      blocks: [textBlock(id('help'), question.help, { size: 'sm', layout: { span: { base: 12 } } })],
    })
  }
  rows.push({
    id: id('row-choice'),
    blocks: [
      {
        id: id('choice'),
        type: 'radio',
        fieldName: question.property,
        label: question.label || 'Choose one',
        required: true,
        options: question.options.map((o) => ({ label: o.label, value: o.value })),
        // The step's own output parameter, by name. Designer's Parameter Binding
        // inspector lists the step's `outputs` and stores the chosen one's NAME in
        // block.outputParameter (form-designer/v2/inspector/sections/
        // ParameterBindingSection.tsx), so this must match an entry in the step's
        // output_parameter_specifications or the dropdown shows nothing selected.
        outputParameter: questionOutputName(question),
        layout: { span: { base: 12 } },
      },
    ],
  })
  return { version: 2, sections: [{ id: id('sec'), role: 'content', rows }] }
}
