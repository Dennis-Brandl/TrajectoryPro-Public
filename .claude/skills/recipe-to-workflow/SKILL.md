---
name: recipe-to-workflow
description: Turn a recipe — pasted text, a scan, a photo of a page, or a URL — into an importable Trajectory Pro .WFmasterX workflow package with desktop, tablet and phone layouts, equipment branching, and Back/Stop on every screen. Use when asked to make a workflow from a recipe, convert recipes into Mission Pilot or Mission XO procedures, or add a recipe to the examples.
---

# Recipe to workflow

Turns a recipe into a `.WFmasterX` package that Mission Commander loads and Mission
Pilot and Mission XO run.

You do **not** hand-write the workflow JSON. You write a short *recipe spec* and the
builder produces the package, because the parts that are easy to get wrong — OIDs,
graph wiring, per-breakpoint layout, the phone height budget, the ZIP shape — are
computed rather than typed.

## The loop

```bash
cd .claude/skills/recipe-to-workflow

# 1. write recipes/<slug>.recipe.json   (see reference/recipe-spec.md)
# 2. build
node lib/build.mjs <slug>

# 3. validate against Mission Designer's own validators
cd ../../../MissionDesigner
NODE_PATH=./node_modules npx tsx \
  ../.claude/skills/recipe-to-workflow/lib/validate.ts
```

Build every recipe with a bare `node lib/build.mjs`. Both commands exit non-zero on a
problem, so a failure is a failure, not a line of output to scan past.

Packages are written to **`examples/recipes/` at the repository root** — outside the
skill, gitignored, and an easy folder to reach from Designer's and Commander's file
dialogs. They are build artefacts: `recipes/*.recipe.json` is the tracked source and a
rebuild reproduces them byte for byte, so they are rebuilt rather than committed. Send
them elsewhere with `--out <dir>`.

**Always run the validator before saying a recipe is done.** It calls the real
`validateWorkflowSpecification`, `validateFormDocument`, the `@mission/form-schema`
authoring checks, and the real `importWorkflow`. A package that passes is one Designer
accepts; your reading of the schema is not evidence.

## Writing the spec

Read `reference/recipe-spec.md` for every field. The shape:

```json
{
  "name": "Roast Chicken",
  "slug": "roast-chicken",
  "course": "entree",
  "serves": "4 to 6",
  "summary": "One line.",
  "source": { "title": "...", "author": "...", "year": 1896, "rights": "Public domain ..." },
  "ingredients": ["1 roasting chicken, 4 to 5 lb", "..."],
  "equipment": {
    "prompt": "Which oven are you using?",
    "noun": "oven",
    "property": "OvenType",
    "options": [{ "value": "gas", "label": "Gas oven" }]
  },
  "steps": [
    { "title": "Wipe the bird", "body": "...", "art": "wash" },
    { "title": "Heat a gas oven to 400°F", "body": "...", "art": "oven", "only": ["gas"] },
    { "title": "Roast", "body": "...", "art": "timer", "timer": { "label": "Roast", "minutes": 75 } }
  ]
}
```

### Rules that matter

**One idea per screen.** The phone budget is the discipline. A step whose body runs past
a couple of sentences is usually two steps.

**Keep the author's method, not their prose.** Rewrite the instruction as a cook would
act on it. Do not invent quantities, temperatures or times that the source does not give
— if the source is vague, say what it says.

**Equipment branching.** When the method genuinely differs by equipment — oven type, hob
type, mixing method — add an `equipment` block and tag the differing steps with `only`.
The question is asked once, early, and stored; every `only` run after that becomes its own
`SELECT 1`, and the branches rejoin through a `WAIT ANY`. Do not branch on things that do
not change the steps.

The builder handles the wiring, which is worth knowing about because it is the part that
fails quietly: the question screen declares an output parameter, the radio binds to it, and
the `SELECT 1` reads the same key. Leave the declaration out and the recipe still *runs* —
but the binding shows as empty in Designer and the question step never appears in the
SELECT 1's source picker, so the branch cannot be edited. `reference/workflow-format.md`
has the three-way table and the proof.

**Every option needs a path.** An option with no `only` steps falls straight through to
the next shared step. That is fine and intended.

**No environment actions.** Recipes are instructions a person follows. No `ACTION PROXY`
steps, no environments, no action libraries. This is why a recipe package contains only
the `.WFmaster` and `manifest.json`.

**Timers** are helpers, not gates. `blockDone` is false unless you set it, so the cook can
move on early. Never set `blockDone` on a step whose timer you would also want hidden on
the phone — the authoring check rejects a required block hidden at any breakpoint.

## What the builder decides for you

| Thing | Rule |
| --- | --- |
| Back | Wherever a screen actually lies upstream. Resolved on the finished graph, not from the step's place in the spec: `SELECT 1` is transparent, so a branch's first screen goes back to the question, but `START` and `WAIT ANY` are barriers, so the first screen and the first screen after a rejoin have no Back. |
| Stop | On every screen except the last, where the run is ending anyway. |
| Button label | `Next`, or `Done` on the last screen. Override per step with `"button"`. |
| Step names | The header shown inside the step, because `local_id` is what Designer puts on the canvas node and in the SELECT 1 source picker. De-duplicated with a ` (2)` suffix. |
| Branch wiring | The question's output parameter, the radio's binding and the `SELECT 1`'s `input_name` are all the same key; branches rejoin through a `WAIT ANY`. |
| Layout | Every step is created at the origin, then the whole graph goes through Mission Designer's own dagre settings, so an imported recipe sits where pressing Auto Layout would put it. |
| Drawing on phone | Kept beside the text while the body is short; hidden on the phone past ~110 characters, because two columns at 360px shred the text. |
| Ingredients | Split across as many screens as the phone budget needs. |
| OIDs | Derived from the recipe slug, so a rebuild is byte-identical. |

Override `allowBack`, `allowStop` or `button` per step only when the default is actually
wrong for that recipe.

## Limited scrolling on the phone

Every screen is measured against a phone's usable height (360×560 after OS chrome, the
step header and the fixed button bar) and the build **fails** if one overflows. That is
the mechanism behind "limited scrolling": it is checked, not hoped for.

When a screen overflows, split the step. Do not shrink the budget.

## Pictures

Drawings come from `lib/line-art.mjs` — 20 original kitchen line drawings, about 1 KB
each, inline as SVG data URIs. They inherit the form's text colour, so they work in light
and dark themes, and they need no network and raise no licensing question.

Name one with `"art": "<name>"`. Run `node -e "import('./lib/line-art.mjs').then(m=>console.log(m.ART_NAMES.join(', ')))"`
to list them. Omit `art` for a screen that needs no picture.

For photographs, name one with `"photo": "File:<Commons file name>"` and fetch it first:

```bash
node lib/fetch-photos.mjs            # resolve, licence-check and cache every photo named
node lib/fetch-photos.mjs --check    # re-verify the cached files against photos/credits.json
```

Only Public domain, CC0 and CC BY are accepted — anything carrying SA, NC or ND is refused
rather than quietly downgraded — and every photo renders with its credit line beneath it,
because CC BY requires attribution. It is a different trade from line art: real photos are
50–300 KB each and travel in the package's `images/` folder rather than inline. The fetched
files are local only; `photos/credits.json` is what is tracked. `reference/images.md` has
the detail.

## Sources

Use recipes that are actually in the public domain and name the source in `source`. Safe
ground is pre-1929 US publication: Fannie Farmer's *Boston Cooking-School Cook Book*
(1896), Mrs Beeton's *Book of Household Management* (1861), Mary Randolph's *The Virginia
House-Wife* (1824), *The White House Cook Book* (1887).

A list of ingredients is not copyrightable, but the prose around it is — so rewrite the
method in your own words rather than transcribing a modern author's.

## Beyond recipes

The same builder handles any step-by-step procedure with no machine actions. For plain
workflow text, the work is the same: write the spec, build, validate. For a *picture* of
a workflow, read the diagram into the same spec shape first — boxes become steps,
diamonds become the `equipment` question plus `only` tags — and say what you could not
read rather than inventing it.

## Reference

- `reference/recipe-spec.md` — every field of the recipe spec
- `reference/workflow-format.md` — the Trajectory format facts this relies on, with file
  and line citations, so a future schema change can be checked against it
- `reference/images.md` — line art and the public domain photo path
