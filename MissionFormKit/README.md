# Mission FormKit

Shared form document schema, tokens, and renderer for Mission Designer
and the Trajectory runtime display applications ("one renderer, two modes").

Packages:
- `@mission/form-schema` — formDocument v2 types, JSON Schema, validator, breakpoint cascade. React-free.
- `@mission/form-tokens` — form-surface design tokens compiled to `--form-*` CSS custom properties (light/dark).
- `@mission/form-renderer` — React 19 renderer; one component tree for the Mission Designer editor (edit mode) and the runtime UI-host (run mode).

**Building an app that drives the renderer? Read [`docs/HOST-CONTRACT.md`](docs/HOST-CONTRACT.md) first.**
It states the obligations the renderer cannot enforce — who computes the completion gate, why keying
the renderer per screen is load-bearing, and which surprising behaviours are intentional.
Deferred work is tracked in [`docs/BACKLOG.md`](docs/BACKLOG.md).

## Commands
- `npm install`
- `npm run build:tokens` — generate `packages/form-tokens/dist/*.css`
- `npm run typecheck` — `tsc -b`
- `npm test` — vitest
- `npm run demo` — renderer playground at 380/768/1440 + event log (needs `npm run build:tokens` first)
- `npm run shell` — form flow host prototype (needs `npm run build:tokens` first)
- `npm run golden` — deterministic renderer harness for pixel goldens (`/?w=768&mode=edit`)
- `npm run test:e2e` — Playwright pixel goldens (needs `npx playwright install chromium` once)

## Visual goldens

`npm run test:e2e` compares the renderer against committed pixel baselines at 380/768/1440
in run and edit modes (`e2e/goldens.spec.ts`, harness in `packages/form-renderer/golden/`).

Baselines are **generated and committed on Windows/Chromium** and are platform-specific
(font/antialiasing rendering differs across OSes). Regenerate after an intentional visual
change with `npm run test:e2e -- --update-snapshots`, then review the diff before committing.
Making these portable for CI later means regenerating the baselines inside Playwright's
Linux container (`mcr.microsoft.com/playwright`) and adding a workflow — no test/harness
code changes required. @playwright/test is pinned exactly because the bundled Chromium build determines the pixels — bumping it changes the rendering engine and requires regenerating the baselines.


## License

Apache-2.0 © 2026 Dennis L. Brandl. See [`LICENSE`](./LICENSE).
