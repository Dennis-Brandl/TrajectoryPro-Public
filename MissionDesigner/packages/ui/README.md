# @mission/ui

Shared UI primitives for the Trajectory product family — shadcn-style React
components built on Radix UI. Lifted from Mission Designer and consumed by the
MissionAutopilot console too (symlinked from this package).

## Components

`Button`, `Dialog`, `AlertDialog`, `DropdownMenu`, `Input`, `Label`, `Badge`,
`Select`, `RadioGroup`, `ScrollArea`, `Textarea`, plus the `cn` class helper.

## Usage

```tsx
import { Button } from '@mission/ui'
;<Button variant="brand">Trigger</Button>
```

The `brand` variant binds to `--brand-accent` from `@mission/tokens`
(family blue, `#007aff`). Saturnis gold lives separately at
`--color-brand-gold` and is reserved for app-specific brand chrome (e.g.
MD's login page). Other shadcn variants — default, destructive, outline,
secondary, ghost, link — work as usual.

## Tailwind setup

Consumers using Tailwind 4 must add a `@source` directive so Tailwind scans
this package's class strings:

```css
@import 'tailwindcss';
@import '@mission/tokens/dist/tokens.light.css';
@import '@mission/tokens/dist/tokens.dark.css';

@source "../packages/ui/src";
```

## No build step

Source TSX is exported directly; consuming app's bundler (Vite + tsc) compiles.
