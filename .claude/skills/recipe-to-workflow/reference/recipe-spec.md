# The recipe spec

One JSON file per recipe in `recipes/<slug>.recipe.json`. This is the only file you
write by hand.

## Top level

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | The workflow name. Becomes the package name and the `.WFmaster` entry name (non-alphanumerics become `_`). |
| `slug` | no | File-safe id. Defaults to the filename. **Seeds every OID**, so changing it renumbers the whole workflow. |
| `course` | no | `entree` or `dessert`. Documentation only. |
| `serves` | no | Free text. Shown on the ingredients screen as "Makes …". |
| `summary` | no | One line. Becomes the workflow `description`. |
| `source` | yes | Where the recipe comes from, and its rights. See below. |
| `ingredients` | yes | Array of strings. Split across screens automatically. |
| `equipment` | no | The branching question. Omit for a straight-line recipe. |
| `steps` | yes | The method, in order. |
| `library` | no | Library name for the `.WFlibX` path. Unused by the `.WFmasterX` build. |

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

### `equipment`

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
| `only` | no | Array of `equipment` option values. The step appears only on those branches. |
| `button` | no | Override the button label. |
| `allowBack` | no | Override the Back default. |
| `allowStop` | no | Override the Stop default. |

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
