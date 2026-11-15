# Pictures for recipe steps

Two sources, one default.

## Line art (default)

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
import { ART_NAMES, artDataUri } from '../.claude/skills/recipe-to-workflow/lib/line-art.mjs'
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

**Record the provenance.** Add a `photos` array to the recipe spec — source URL, author,
licence, and the date checked — so a licence claim can be re-checked later rather than
trusted.

This path is documented but not yet implemented: `lib/build-forms.mjs` always calls
`artDataUri`. Adding it means an image-source switch there, an `images/` entry list
returned from `buildWorkflow`, and those entries written in `lib/build.mjs` alongside the
`.WFmaster`. The ZIP writer already takes arbitrary binary entries.
