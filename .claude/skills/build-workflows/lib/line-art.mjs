// Line art for recipe steps: original SVG drawings, emitted as data URIs.
//
// These are drawn here rather than fetched so the kit has no network dependency
// and no licence question: original work, published under the repository's own
// licence. Each drawing is a few hundred bytes, so a whole recipe's images cost
// less than one photograph would.
//
// Every drawing uses a 100x100 user-space box and `currentColor`, so it inherits
// the form's text colour and stays legible in both light and dark themes. Stroke
// widths are chosen to survive being scaled down to a phone thumbnail.

const VIEW = 100

/** Shared drawing primitives. Keep strokes >= 2.5 so they hold up when scaled down. */
const S = 'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"'
const THIN = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'

/**
 * The drawing set. A recipe step names one of these in its `art` field.
 *
 * Adding one: draw inside 0 0 100 100, use only the S / THIN stroke styles, and
 * leave ~8 units of margin so nothing clips when the renderer rounds the box.
 */
export const DRAWINGS = {
  oven: `
    <rect x="14" y="16" width="72" height="70" rx="6" ${S}/>
    <rect x="24" y="40" width="52" height="36" rx="4" ${THIN}/>
    <line x1="14" y1="32" x2="86" y2="32" ${S}/>
    <circle cx="26" cy="24" r="3.5" ${THIN}/>
    <circle cx="40" cy="24" r="3.5" ${THIN}/>
    <line x1="36" y1="58" x2="64" y2="58" ${THIN}/>`,
  stovetop: `
    <rect x="12" y="26" width="76" height="52" rx="6" ${S}/>
    <circle cx="36" cy="44" r="10" ${THIN}/>
    <circle cx="64" cy="44" r="10" ${THIN}/>
    <circle cx="36" cy="66" r="7" ${THIN}/>
    <circle cx="64" cy="66" r="7" ${THIN}/>`,
  pot: `
    <path d="M22 40 h56 v26 a10 10 0 0 1 -10 10 h-36 a10 10 0 0 1 -10 -10 z" ${S}/>
    <line x1="16" y1="40" x2="84" y2="40" ${S}/>
    <path d="M14 48 a6 6 0 0 1 0 -12" ${THIN}/>
    <path d="M86 48 a6 6 0 0 0 0 -12" ${THIN}/>
    <path d="M40 28 q4 -8 0 -14" ${THIN}/>
    <path d="M56 28 q4 -8 0 -14" ${THIN}/>`,
  pan: `
    <path d="M18 44 h44 v16 a12 12 0 0 1 -12 12 h-20 a12 12 0 0 1 -12 -12 z" ${S}/>
    <line x1="62" y1="48" x2="88" y2="40" ${S}/>
    <path d="M32 34 q4 -7 0 -12" ${THIN}/>
    <path d="M48 34 q4 -7 0 -12" ${THIN}/>`,
  bowl: `
    <path d="M16 44 h68 a34 34 0 0 1 -68 0 z" ${S}/>
    <line x1="12" y1="44" x2="88" y2="44" ${S}/>
    <path d="M34 34 q6 -8 14 -4" ${THIN}/>`,
  whisk: `
    <line x1="50" y1="14" x2="50" y2="40" ${S}/>
    <path d="M50 40 q-18 16 -10 38 q10 8 20 0 q8 -22 -10 -38" ${S}/>
    <path d="M50 42 v34" ${THIN}/>
    <path d="M38 52 q12 14 24 0" ${THIN}/>`,
  knife: `
    <path d="M20 68 l34 -34 a18 18 0 0 1 8 22 l-20 20 z" ${S}/>
    <line x1="20" y1="68" x2="12" y2="76" ${S}/>
    <line x1="60" y1="24" x2="78" y2="18" ${S}/>`,
  board: `
    <rect x="16" y="26" width="60" height="54" rx="5" ${S}/>
    <path d="M76 38 h10 a4 4 0 0 1 0 8 h-10" ${THIN}/>
    <line x1="30" y1="44" x2="60" y2="44" ${THIN}/>
    <line x1="30" y1="56" x2="60" y2="56" ${THIN}/>`,
  mixing: `
    <path d="M20 46 h60 a30 30 0 0 1 -60 0 z" ${S}/>
    <line x1="16" y1="46" x2="84" y2="46" ${S}/>
    <line x1="62" y1="16" x2="46" y2="48" ${S}/>
    <path d="M58 20 l10 6" ${THIN}/>`,
  rolling: `
    <rect x="24" y="42" width="52" height="18" rx="9" ${S}/>
    <line x1="10" y1="51" x2="24" y2="51" ${S}/>
    <line x1="76" y1="51" x2="90" y2="51" ${S}/>
    <path d="M20 74 q30 -10 60 0" ${THIN}/>`,
  pie: `
    <path d="M14 56 h72 a36 36 0 0 1 -72 0 z" ${S}/>
    <path d="M10 56 q40 -14 80 0" ${S}/>
    <path d="M34 48 l10 -10 M50 46 l10 -10 M64 50 l8 -8" ${THIN}/>`,
  cookie: `
    <circle cx="50" cy="52" r="30" ${S}/>
    <circle cx="40" cy="44" r="3.5" ${THIN}/>
    <circle cx="58" cy="40" r="3.5" ${THIN}/>
    <circle cx="52" cy="60" r="3.5" ${THIN}/>
    <circle cx="36" cy="60" r="3" ${THIN}/>`,
  chicken: `
    <path d="M26 64 q0 -26 24 -26 q24 0 24 26 z" ${S}/>
    <path d="M40 38 q2 -12 -6 -16" ${THIN}/>
    <path d="M60 38 q-2 -12 6 -16" ${THIN}/>
    <ellipse cx="50" cy="72" rx="34" ry="7" ${S}/>
    <path d="M38 56 q12 6 24 0" ${THIN}/>`,
  timer: `
    <circle cx="50" cy="56" r="28" ${S}/>
    <line x1="50" y1="56" x2="50" y2="38" ${S}/>
    <line x1="50" y1="56" x2="62" y2="62" ${S}/>
    <line x1="40" y1="20" x2="60" y2="20" ${S}/>
    <line x1="50" y1="20" x2="50" y2="28" ${S}/>`,
  fridge: `
    <rect x="28" y="12" width="44" height="76" rx="6" ${S}/>
    <line x1="28" y1="42" x2="72" y2="42" ${S}/>
    <line x1="62" y1="30" x2="62" y2="36" ${S}/>
    <line x1="62" y1="50" x2="62" y2="58" ${S}/>`,
  plate: `
    <circle cx="50" cy="52" r="32" ${S}/>
    <circle cx="50" cy="52" r="22" ${THIN}/>`,
  measure: `
    <path d="M30 34 h40 l-5 44 a6 6 0 0 1 -6 5 h-18 a6 6 0 0 1 -6 -5 z" ${S}/>
    <line x1="26" y1="34" x2="74" y2="34" ${S}/>
    <line x1="36" y1="50" x2="48" y2="50" ${THIN}/>
    <line x1="36" y1="62" x2="48" y2="62" ${THIN}/>`,
  thermometer: `
    <path d="M44 20 a6 6 0 0 1 12 0 v38 a12 12 0 1 1 -12 0 z" ${S}/>
    <circle cx="50" cy="70" r="7" fill="currentColor"/>
    <line x1="60" y1="32" x2="68" y2="32" ${THIN}/>
    <line x1="60" y1="44" x2="68" y2="44" ${THIN}/>`,
  serve: `
    <path d="M18 60 a32 32 0 0 1 64 0 z" ${S}/>
    <line x1="12" y1="60" x2="88" y2="60" ${S}/>
    <line x1="50" y1="28" x2="50" y2="22" ${S}/>
    <path d="M30 76 h40" ${THIN}/>`,
  wash: `
    <path d="M24 44 h52 v24 a12 12 0 0 1 -12 12 h-28 a12 12 0 0 1 -12 -12 z" ${S}/>
    <line x1="20" y1="44" x2="80" y2="44" ${S}/>
    <path d="M50 36 v-10 a8 8 0 0 1 16 0" ${THIN}/>
    <line x1="42" y1="56" x2="42" y2="66" ${THIN}/>
    <line x1="58" y1="56" x2="58" y2="66" ${THIN}/>`,

  // --- facility / emergency ------------------------------------------------
  alarm: `
    <path d="M30 62 v-7 a20 20 0 0 1 40 0 v7" ${S}/>
    <line x1="23" y1="62" x2="77" y2="62" ${S}/>
    <path d="M43 68 a7 7 0 0 0 14 0" ${THIN}/>
    <line x1="50" y1="35" x2="50" y2="28" ${THIN}/>
    <path d="M16 56 a15 15 0 0 1 5 -17" ${THIN}/>
    <path d="M84 56 a15 15 0 0 0 -5 -17" ${THIN}/>`,
  phone: `
    <path d="M32 20 c-11 7 -13 22 -6 34 c8 16 22 30 38 38 c12 6 26 3 32 -8 l-13 -13 c-4 -4 -10 -1 -13 3 c-9 -6 -17 -14 -23 -23 c4 -3 7 -9 3 -13 z" ${S}/>`,
  exit: `
    <rect x="18" y="18" width="36" height="64" rx="4" ${S}/>
    <circle cx="46" cy="52" r="3" ${THIN}/>
    <line x1="62" y1="50" x2="86" y2="50" ${S}/>
    <polyline points="76,40 86,50 76,60" ${S}/>`,
  extinguisher: `
    <rect x="36" y="34" width="28" height="48" rx="8" ${S}/>
    <path d="M44 34 v-8 h12 v8" ${S}/>
    <line x1="40" y1="24" x2="66" y2="19" ${S}/>
    <path d="M64 32 q14 5 10 19 q-2 7 -9 8" ${THIN}/>
    <line x1="43" y1="52" x2="57" y2="52" ${THIN}/>
    <line x1="43" y1="61" x2="57" y2="61" ${THIN}/>`,
  flame: `
    <path d="M50 86 c-16 0 -27 -12 -27 -25 c0 -17 15 -23 19 -42 c10 10 14 17 14 25 c4 -4 6 -9 6 -15 c10 11 15 21 15 32 c0 13 -11 25 -27 25 z" ${S}/>
    <path d="M50 76 c-7 0 -13 -6 -13 -13 c0 -8 8 -12 11 -21 c6 7 15 13 15 21 c0 7 -6 13 -13 13 z" ${THIN}/>`,
  water: `
    <path d="M14 42 q9 -9 18 0 t18 0 t18 0 t18 0" ${S}/>
    <path d="M14 60 q9 -9 18 0 t18 0 t18 0 t18 0" ${S}/>
    <path d="M14 78 q9 -9 18 0 t18 0 t18 0 t18 0" ${S}/>`,
  wind: `
    <path d="M14 36 h40 a9 9 0 1 0 -9 -9" ${S}/>
    <path d="M14 54 h54 a10 10 0 1 1 -10 10" ${S}/>
    <path d="M14 72 h30 a8 8 0 1 0 -8 8" ${S}/>`,
  firstaid: `
    <rect x="18" y="28" width="64" height="50" rx="8" ${S}/>
    <path d="M42 28 v-7 h16 v7" ${THIN}/>
    <line x1="50" y1="41" x2="50" y2="65" ${S}/>
    <line x1="38" y1="53" x2="62" y2="53" ${S}/>`,
  shelter: `
    <path d="M18 52 l32 -27 l32 27" ${S}/>
    <path d="M27 52 v31 h46 v-31" ${S}/>
    <rect x="42" y="63" width="16" height="20" ${THIN}/>`,
  clipboard: `
    <rect x="26" y="22" width="48" height="62" rx="5" ${S}/>
    <rect x="40" y="15" width="20" height="13" rx="4" ${S}/>
    <line x1="36" y1="46" x2="64" y2="46" ${THIN}/>
    <line x1="36" y1="58" x2="64" y2="58" ${THIN}/>
    <line x1="36" y1="70" x2="56" y2="70" ${THIN}/>`,
  radio: `
    <rect x="34" y="30" width="32" height="54" rx="5" ${S}/>
    <line x1="59" y1="30" x2="65" y2="14" ${S}/>
    <line x1="41" y1="42" x2="59" y2="42" ${THIN}/>
    <line x1="41" y1="50" x2="59" y2="50" ${THIN}/>
    <circle cx="50" cy="67" r="6" ${THIN}/>`,
  power: `
    <path d="M32 32 a26 26 0 1 0 36 0" ${S}/>
    <line x1="50" y1="16" x2="50" y2="48" ${S}/>`,
  camera: `
    <rect x="20" y="40" width="44" height="21" rx="4" ${S}/>
    <path d="M64 44 l14 -7 v27 l-14 -7 z" ${S}/>
    <line x1="42" y1="40" x2="42" y2="26" ${S}/>
    <line x1="30" y1="26" x2="54" y2="26" ${S}/>`,
  announce: `
    <path d="M30 42 h14 l24 -17 v50 l-24 -17 h-14 a7 7 0 0 1 -7 -7 v-2 a7 7 0 0 1 7 -7 z" ${S}/>
    <path d="M76 38 a16 16 0 0 1 0 24" ${THIN}/>
    <path d="M85 31 a27 27 0 0 1 0 38" ${THIN}/>`,
}

export const ART_NAMES = Object.keys(DRAWINGS)

/**
 * Build one drawing as an SVG data URI.
 *
 * Percent-encoded rather than base64: an SVG is text, so encodeURIComponent keeps
 * it smaller than base64 would and leaves it readable in a diff. The `#` and `%`
 * characters must still be escaped by hand because a raw `#` truncates the URI.
 */
export function artDataUri(name) {
  const body = DRAWINGS[name]
  if (!body) throw new Error(`unknown drawing "${name}" — known: ${ART_NAMES.join(', ')}`)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" ` +
    `width="${VIEW}" height="${VIEW}" role="img">${body.replace(/\s+/g, ' ').trim()}</svg>`
  return 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/#/g, '%23')
}
