# Pictures for recipe steps

Two sources, one default.

## Line art (default)

Two families in one set: kitchen subjects for recipes (`oven`, `pot`, `knife`, …) and
facility subjects for procedures (`alarm`, `phone`, `exit`, `extinguisher`, `flame`,
`water`, `wind`, `firstaid`, `shelter`, `clipboard`, `radio`, `power`, `camera`,
`announce`). `ART_NAMES` is the list; nothing stops a procedure using a kitchen drawing
if it genuinely fits.

`lib/line-art.mjs` holds 20 original kitchen drawings: `oven`, `stovetop`, `pot`, `pan`,
`bowl`, `whisk`, `knife`, `board`, `mixing`, `rolling`, `pie`, `cookie`, `chicken`,
`timer`, `fridge`, `plate`, `measure`, `thermometer`, `serve`, `wash`.

Name one with `"art": "oven"` on a step. Unknown names throw at build time with the list.

Why these are the default:

- **~1 KB each**, percent-encoded SVG inline in `src`. All six example recipes together
  are under 40 KB. One photograph would be larger than all of them.
- **No licensing question.** Original work in this repository, under its licence.
- **No network.** The build is offline and reproducible.
- **Theme-correct.** Every stroke is `currentColor`, so the drawing takes the form's text
  colour and stays legible in light and dark.
- **Sharp at any size**, which matters when the same drawing renders at 3/12 of a desktop
  row and 4/12 of a 360px phone.

Inline data URIs are a shape Designer already expects: its packager **skips data URIs**
when collecting form images (`src/lib/packageFormat/image-collectors.ts`), so they pass
through into the `.WFmaster` untouched and need no `images/` entry.

### Adding a drawing

Draw inside the 0 0 100 100 box, use only the `S` and `THIN` stroke styles already
defined, and leave about 8 units of margin. Then look at it — the first `chicken` drawing
passed every check and still read as a blob with an arrow. Render a contact sheet:

```bash
# from MissionDesigner, which has playwright; uses the installed Edge, no browser download
node --input-type=module -e "
import { ART_NAMES, artDataUri } from '../.claude/skills/build-workflows/lib/line-art.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
mkdirSync('/tmp/art', { recursive: true })
for (const n of ART_NAMES) writeFileSync('/tmp/art/' + n + '.svg',
  decodeURIComponent(artDataUri(n).replace('data:image/svg+xml,', '')))
"
```

then screenshot them in a grid and actually look at the result.

## Public domain photographs

A different trade, and more work. Use when a drawing genuinely cannot carry the step —
telling two cuts of meat apart, say.

**Where.** Wikimedia Commons filtered to public domain or CC0; USDA, NIH and other US
federal works; pre-1929 US publications, including the plates in the cookbooks the
recipes come from.

**Check each image on its own.** "On Wikimedia" is not a licence. Open the file page, read
the licence, and record it. A CC-BY photo needs attribution and is not public domain.

**How they are packaged.** Photographs do **not** go inline. They belong in the ZIP:

```
images/{imageOid}-{filename}      e.g. images/900000000000000123-apple-slices.jpg
```

with the block carrying `imageOid` and `src` set to the bare filename. Commander resolves
bare filename first, then `{imageOid}-{filename}`, then any entry ending `-{filename}`
(`docs/JSON_SCHEMA.md` §2.2). Missing bytes are not an error — the image renders empty.

**Budget.** 50–300 KB each; 30 images across six recipes is several megabytes of package
against 40 KB today. Resize to the largest size any breakpoint actually renders (a
desktop row at 3/12 of ~1100px is ~275px wide; 600px covers retina) before encoding.

**Record the provenance.** `photos/credits.json` holds one record per photo — Commons file
title, author, licence, source URL, byte size and sha256 — so a licence claim can be
re-checked later rather than trusted. It is the tracked artefact; the image files themselves
stay local.

### Using it

Name the Commons file on the step:

```json
{ "title": "Serve warm", "body": "…", "photo": "File:AppleDumpling.jpg" }
```

then fetch before building:

```bash
node lib/fetch-photos.mjs          # resolve every photo named in recipes/, licence-check, cache
node lib/fetch-photos.mjs --check  # re-verify cached bytes against credits.json's sha256
```

`lib/photos.mjs` is the gate. It queries Commons for each exact title, reads the licence
short name, and accepts only `Public domain`, `CC0` and `CC BY` 2.0/2.5/3.0/4.0; anything
matching SA, NC or ND is **refused**, not downgraded. A title that cannot be resolved is
refused too, rather than silently falling back to a drawing. Every accepted photo renders
with `creditLine()` beneath it — `Photo: <author>, <licence>, via Wikimedia Commons` —
because CC BY requires attribution and the credit must survive into the package.

The request sends a generic `User-Agent` (`TrajectoryPro-recipe-skill/1.0`). Commons asks
automated clients for contact details; do **not** put the operator's name or address there.

`lib/build-forms.mjs` switches on `photo` before `art`, returns the image entries it used,
and `lib/build.mjs` writes them into the package as `images/{imageOid}-{filename}` with a
matching `form_element_images` list on the step. A photo screen costs more vertical space
than a drawing, so it is measured against the same phone budget as everything else.
