# The workflow spec

One JSON file per workflow. This is the only file you write by hand. Two source sets,
one spec shape, one builder:

| Source set | File | Built to |
| --- | --- | --- |
| `recipes/` | `<slug>.recipe.json` | `examples/recipes/` |
| `procedures/` | `<slug>.procedure.json` | `examples/procedures/` |

They differ only in vocabulary. A recipe says `ingredients` and `equipment`; anything
else says `checklist` and `question`. Both names work in either set — use the one that
reads naturally for the subject.

## Top level

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | The workflow name. Becomes the package name and the `.WFmaster` entry name (non-alphanumerics become `_`). |
| `slug` | no | File-safe id. Defaults to the filename. **Seeds every OID**, so changing it renumbers the whole workflow. |
| `summary` | no | One line. Becomes the workflow `description`. |
| `steps` | yes | The method, in order. |
| `checklist` | no | The opening "what you need" screen. See below. |
| `question` | no | The branching question. Omit for a straight line. |
| `library` | no | Library name for the `.WFlibX` path. Unused by the `.WFmasterX` build. |
| `kind` / `course` | no | Free text. Documentation only. |
| `source` | recipes | Where the recipe comes from, and its rights. See below. |
| `ingredients` | no | Recipe spelling of `checklist.items`. |
| `serves` | no | Recipe only. Shown on the first screen as "Makes …". |
| `equipment` | no | Recipe spelling of `question`. |

### `checklist`

```json
{
  "title": "Before you start",
  "intro": "One line above the list. Optional.",
  "items": ["Alarm panel key", "Site address and gate code"]
}
```

Split across as many screens as the phone budget needs. Omit the whole block for a
workflow that opens straight into its first step.

### `source`

```json
{
  "title": "The Boston Cooking-School Cook Book",
  "author": "Fannie Merritt Farmer",
  "year": 1896,
  "publisher": "Little, Brown and Company",
  "rights": "Public domain (published 1896, United States)"
}
```

Carried for provenance. State the rights basis explicitly — "public domain" with a year
and country, not just the word.

### `question` (`equipment`)

```json
{
  "prompt": "Which oven are you using?",
  "help": "The heat and the timing differ, so the steps after this follow the oven you pick.",
  "noun": "oven",
  "property": "OvenType",
  "label": "Oven",
  "options": [
    { "value": "gas",        "label": "Gas oven" },
    { "value": "electric",   "label": "Electric oven" },
    { "value": "convection", "label": "Convection oven" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `prompt` | The question, as the screen's heading. |
| `help` | Optional sentence under it, explaining why it is being asked. |
| `noun` | Used in the `SELECT 1` step's description ("Which oven?"). |
| `property` | Workflow value property name. The answer is stored at `<property>.Value`. |
| `label` | Label on the radio group. Defaults to "Choose one". |
| `options` | At least two. `value` is matched by `SELECT 1`; `label` is what the cook sees. |

The first option is also marked `is_default`, so a value that somehow matches nothing
still routes somewhere instead of dead-ending.

### `steps[]`

| Field | Required | Meaning |
| --- | --- | --- |
| `title` | yes | Screen heading. Short. |
| `body` | yes | The instruction. One idea. |
| `art` | no | A drawing name from `lib/line-art.mjs`. |
| `note` | no | Smaller text under the body — the "why", a tip, a warning. |
| `timer` | no | `{ "label": "Roast", "minutes": 75 }`. Also takes `seconds` and `blockDone`. |
| `only` | no | Array of `question` option values. The step appears only on those branches. |
| `track` | no | Track name. Consecutive tracked steps run concurrently. See below. |
| `photo` | no | `File:<name>` on Wikimedia Commons. See `images.md`. |
| `button` | no | Override the button label. |
| `allowBack` | no | Override the Back default. |
| `allowStop` | no | Override the Stop default. |

## How `track` becomes a parallel fork

`only` picks one path. `track` runs several at once.

A run of consecutive steps carrying `track` forms one region. Each distinct track name
becomes one concurrent branch, in first-appearance order:

```json
{ "title": "Sound the alarm",    "track": "Alarm" },
{ "title": "Release the doors",  "track": "Alarm" },
{ "title": "Call the fire service", "track": "Call 911" },
{ "title": "Announce the evacuation", "track": "Evacuate" }
```

becomes

```
... -> PARALLEL -+-> Sound the alarm -> Release the doors -+
                 +-> Call the fire service ---------------+-> WAIT ALL -> ...
                 +-> Announce the evacuation -------------+
```

`WAIT ALL` holds the workflow until every track has finished, which is the point: the
alarm must not wait on the phone call. Use it when the actions are genuinely independent
and genuinely simultaneous — not merely adjacent in a list.

Both `PARALLEL` and `WAIT ALL` are Back barriers, so the first screen of each track and
the first screen after the join carry no Back. That is the graph, not a choice.

A step may carry both `only` and `track`, but a region is one or the other: a run of
tracked steps ends where the tracking stops.

## How `only` becomes a branch

Steps are read in order. Every **run of consecutive steps carrying `only`** opens one
`SELECT 1` on the stored answer, and the branches rejoin at the next shared step:

```
  … shared …
      │
   SELECT 1 ────────┬──────────────┬───────────────┐
      │ gas         │ electric     │ convection    │  (an option with no steps
   [gas step]    [electric step] [convection step] │   falls straight through)
      └─────────────┴──────────────┴───────────────┘
      │
  … shared …
```

A recipe may branch more than once: a later run of `only` steps opens a second
`SELECT 1` on the same stored answer. The cook is asked once.

An `only` run where several steps share one option value becomes a chain on that branch,
in spec order.

## Worked example

`recipes/roast-chicken.recipe.json` is the reference: ingredients, an oven question, a
three-way branch of one step each, a timer with a note, and a plain finish. 11 steps in,
13 screens and 16 workflow steps out.
