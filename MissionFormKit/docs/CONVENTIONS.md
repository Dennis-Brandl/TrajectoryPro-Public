<!-- Copyright (c) 2026 Dennis Brandl. All Rights Reserved. -->

# Conventions

Rules for contributing to the kit itself. Host authors want [`HOST-CONTRACT.md`](HOST-CONTRACT.md).

Only rules that have actually been contested are recorded here. This is not a style guide.

---

## Inline styles are banned for LAYOUT. Authored appearance is not layout.

Geometry, spacing, and flow come from classes and tokens — never from a `style` prop. That is what
keeps `(schema, width) → layout` deterministic and the two render modes identical.

**Authored appearance values are the exception, and they are legitimate**: they are per-block data an
author picked, so no fixed class can express them.

```tsx
style={{ color: block.color }}            // TextBlock, HeaderBlock
style={{ background: block.color }}       // ButtonBlock
style={{ borderTopColor: block.color }}   // DividerBlock
style={{ aspectRatio: block.aspectRatio }} // ImageBlock, VideoBlock
```

> **History.** The P1 plan wrote this rule as an allowlist of exactly two properties (`color`,
> `aspectRatio`). That enumeration was already false when written — `ButtonBlockView` used
> `background`, which the same plan specified. The wording, not the code, was the defect: the real rule
> is *layout vs appearance*, and enumerating properties mistook two examples for the principle.
>
> It cost something. `divider.color` shipped in the types and the design spec but was silently dropped
> by the renderer, because rendering it needed `borderTopColor` and that "wasn't on the list" —
> authored divider colours vanished, and P4's v1→v2 converter would have carried v1 colours straight
> into the void. Fixed 2026-07-15 by rendering it and correcting the rule.

If you need a new inline style, ask which side of the line it falls on. Appearance the author chose:
fine, add it above. Anything that positions or sizes: find the class.

## Rich text has exactly one sink

`dangerouslySetInnerHTML` appears in `sanitize.ts`'s consumer (`TextHtml`) and nowhere else. Rich text
is dompurify-sanitized on the way in. `sanitizeHtml` throws rather than passing content through when it
cannot run — a sanitizer that fails open is worse than one that fails loudly.

## Mode guards live inside the block

A block must not rely on the wrapper's `inert` to stay silent in edit mode. `inert` does not block a
programmatic `.click()` even in a browser, and jsdom does not implement its click-blocking at all.
Guard `mode` in the component. See `HOST-CONTRACT.md` §5 — this has already caused one defect.
