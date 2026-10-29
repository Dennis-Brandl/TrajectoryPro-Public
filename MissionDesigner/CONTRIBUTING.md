# Contributing to Mission Designer

## Prerequisites

- Node.js 20+
- npm 10+

## Setup

```bash
git clone <repo-url>
cd MissionDesigner
npm install
npm run db:push      # Apply Drizzle migrations to PostgreSQL
npm run dev:all      # Start API server (port 3000) + Vite dev server (port 5173)
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable             | Default                 | Description                                                           |
| -------------------- | ----------------------- | --------------------------------------------------------------------- |
| `PORT`               | `3000`                  | API server port                                                       |
| `DATABASE_URL`       | (required)              | PostgreSQL connection string (e.g. `postgres://user:pass@host/db`)    |
| `ALLOWED_ORIGINS`    | `http://localhost:5173` | Comma-separated allowed CORS origins                                  |
| `BETTER_AUTH_SECRET` | (required)              | Secret for auth session signing. Generate with `openssl rand -hex 32` |

## Architecture Overview

### Frontend (React + Vite)

- **State Management:** Zustand stores with temporal (undo/redo) and persist middleware
  - `flowStore` — canvas nodes, edges, workflow properties, images
  - `libraryStore` — server library/specification CRUD
  - `formDesignerStore` — WYSIWYG form designer state
  - `notationStore` — notation preference (flowchart/BPMN/ISA88)
- **Components:** React Flow canvas, node renderers (unified config-driven), form designer, library sidebar
- **Routing:** TanStack Router with authenticated layout

### Backend (Hono + PostgreSQL)

- **Server:** Hono HTTP framework on Node.js
- **Database:** PostgreSQL via pg + Drizzle ORM
- **Auth:** better-auth with email/password, first user auto-promoted to admin
- **Routes:** `/api/libraries`, `/api/workflows`, `/api/users`, `/api/backup`

### Node Renderer System

All node types use unified renderers in `src/components/nodes/renderers/unified/`. Visual differences between notations (flowchart, BPMN, ISA88) are driven by `notation-config.ts`.

## Testing

```bash
npm test              # Watch mode
npm run test:run      # Single run
npm run test:coverage # With coverage report
npm run test:e2e      # Playwright E2E tests
```

### Test Structure

- `src/**/__tests__/*.test.ts` — Unit/integration tests (Vitest + jsdom)
- `src/server/routes/__tests__/` — API route tests (Vitest + Node env + PGlite in-memory Postgres)
- `e2e/*.spec.ts` — E2E tests (Playwright + Chromium)

### Writing Tests

- Server route tests use `// @vitest-environment node` directive
- Store tests reset state in `beforeEach` via `useStore.setState({...})`
- IndexedDB warnings in jsdom are expected — not test failures

## Code Style

- Prettier + ESLint enforced via pre-commit hooks (husky + lint-staged)
- Single quotes, no semicolons, trailing commas
- 120 char line width

## Commit Conventions

- `feat:` — New feature
- `fix:` — Bug fix
- `refactor:` — Code restructuring
- `test:` — Adding/updating tests
- `docs:` — Documentation changes
- `chore:` — Build/tooling changes
