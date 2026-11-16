// Fetch and licence-check photographs from Wikimedia Commons.
//
// A search filter is not a licence check, so every file is re-queried by exact title
// here and its licence read from the API before a byte is downloaded. Anything that
// is not public domain, CC0 or plain CC BY is refused by name — share-alike, non-
// commercial and no-derivatives terms all carry obligations a workflow package
// should not quietly take on.
//
// Images are cached under photos/ (gitignored, re-fetchable) and their provenance is
// written to photos/credits.json, which IS tracked: that file is the evidence for
// every licence claim, and it lets a later rebuild verify it got the same bytes.

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const PHOTO_DIR = path.resolve(here, '..', 'photos')
export const CREDITS_FILE = path.join(PHOTO_DIR, 'credits.json')

const API = 'https://commons.wikimedia.org/w/api.php'
// Wikimedia asks automated clients to identify themselves. A tool name is enough;
// never put the operator's name or address in here.
const UA = 'TrajectoryPro-recipe-skill/1.0 (workflow example builder)'

/** Width to download. Covers a desktop row at 3/12 of ~1100px on a 2x display. */
export const PHOTO_WIDTH = 640

const ALLOWED = /^(public domain|CC0|CC BY (2\.0|2\.5|3\.0|4\.0))/i
const FORBIDDEN = /\b(SA|NC|ND)\b|share.?alike|noncommercial|no.?derivat/i

const stripTags = (html) => String(html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

async function api(params) {
  const url = API + '?' + new URLSearchParams(params).toString()
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error('Commons API ' + res.status + ' for ' + JSON.stringify(params.titles ?? params.gsrsearch))
  return res.json()
}

/**
 * Look up one file by exact title and decide whether it may be used.
 * Returns the metadata plus a scaled-image URL; downloads nothing.
 */
export async function describe(title) {
  const data = await api({
    action: 'query',
    format: 'json',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime',
    iiurlwidth: String(PHOTO_WIDTH),
  })
  const pages = Object.values(data?.query?.pages ?? {})
  const page = pages[0]
  if (!page || page.missing !== undefined) throw new Error('no such file on Commons: ' + title)
  const info = page.imageinfo?.[0]
  if (!info) throw new Error('no image info for ' + title)

  const meta = info.extmetadata ?? {}
  const licence = stripTags(meta.LicenseShortName?.value) || 'unknown'
  const author = stripTags(meta.Artist?.value) || 'unknown'

  if (!ALLOWED.test(licence) || FORBIDDEN.test(licence)) {
    throw new Error(
      'refusing ' + title + ': licence "' + licence + '" is not public domain, CC0 or plain CC BY',
    )
  }

  return {
    title,
    licence,
    author,
    mime: info.mime,
    width: info.width,
    height: info.height,
    thumbUrl: info.thumburl ?? info.url,
    thumbWidth: info.thumbwidth ?? info.width,
    thumbHeight: info.thumbheight ?? info.height,
    descriptionUrl: info.descriptionurl,
  }
}

/** Filename used inside the package: the Commons name, made ZIP- and URL-safe. */
export function photoFilename(title, mime) {
  const ext = mime === 'image/png' ? '.png' : '.jpg'
  const base = title
    .replace(/^File:/i, '')
    .replace(/\.(jpe?g|png|JPE?G|PNG)$/i, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80)
  return base + ext
}

/**
 * Fetch one photo into the cache if it is not already there, and return its record.
 * Re-running is cheap: a cached file with a matching hash is not downloaded again.
 */
export async function fetchPhoto(title, credits) {
  const existing = credits[title]
  if (existing && existsSync(path.join(PHOTO_DIR, existing.filename))) {
    const bytes = readFileSync(path.join(PHOTO_DIR, existing.filename))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 === existing.sha256) return { ...existing, cached: true }
    console.warn('  cache for ' + title + ' does not match its recorded hash; refetching')
  }

  const meta = await describe(title)
  const res = await fetch(meta.thumbUrl, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error('download failed ' + res.status + ' for ' + title)
  const bytes = Buffer.from(await res.arrayBuffer())
  const filename = photoFilename(title, meta.mime)

  mkdirSync(PHOTO_DIR, { recursive: true })
  writeFileSync(path.join(PHOTO_DIR, filename), bytes)

  return {
    title,
    filename,
    licence: meta.licence,
    author: meta.author,
    descriptionUrl: meta.descriptionUrl,
    width: meta.thumbWidth,
    height: meta.thumbHeight,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    fetchedAt: new Date().toISOString().slice(0, 10),
    cached: false,
  }
}

export function loadCredits() {
  if (!existsSync(CREDITS_FILE)) return {}
  return JSON.parse(readFileSync(CREDITS_FILE, 'utf8'))
}

export function saveCredits(credits) {
  mkdirSync(PHOTO_DIR, { recursive: true })
  const ordered = {}
  for (const key of Object.keys(credits).sort()) {
    const { cached, ...rest } = credits[key]
    ordered[key] = rest
  }
  writeFileSync(CREDITS_FILE, JSON.stringify(ordered, null, 2) + '\n')
}

/** Read the cached bytes for a credits entry. */
export function photoBytes(entry) {
  return readFileSync(path.join(PHOTO_DIR, entry.filename))
}

/**
 * The on-screen credit line.
 *
 * CC BY requires the author and licence to be shown wherever the image is. Public
 * domain carries no obligation, but naming the source anyway costs one line and
 * tells a reader where the picture came from.
 */
export function creditLine(entry) {
  const pd = /public domain|CC0/i.test(entry.licence)
  const who = entry.author && entry.author !== 'unknown' ? entry.author : 'unknown author'
  return pd
    ? 'Photo: ' + who + ' (' + entry.licence + '), Wikimedia Commons'
    : 'Photo: ' + who + ', ' + entry.licence + ', via Wikimedia Commons'
}
