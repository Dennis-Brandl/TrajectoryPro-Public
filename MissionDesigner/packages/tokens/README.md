# @mission/tokens

Design tokens for the Trajectory product family. Authored in W3C DTCG JSON,
generated to CSS via Style Dictionary v4.

## Build

```sh
npm run build --workspace=@mission/tokens
```

Outputs `dist/tokens.light.css` (`:root` block, primitives + light semantic
tokens + theme-invariant brand) and `dist/tokens.dark.css` (`.dark` block,
dark overrides only). Consumers `@import` both from their entry CSS.

## Source layout

- `tokens/primitives/*.json` — color, radius, etc. (raw values)
- `tokens/semantic/light/*.json` — `--background`, `--primary`, ... in light mode
- `tokens/semantic/dark/*.json` — same keys, dark values
- `tokens/semantic/brand.json` — `--brand-accent`, theme-invariant

## Notes

- Theme switching uses MD's existing `.dark` class on the document root.
- Dist files are gitignored; consumers regenerate via the build script.
