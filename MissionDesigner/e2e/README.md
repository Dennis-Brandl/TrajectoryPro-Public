# E2E Tests

Playwright end-to-end tests for the Mission Designer editor. Tests run against the full stack (Hono API on port 3001 + Vite dev server on port 5174) using a dedicated, disposable database.

## Running

```bash
# All e2e tests
npx playwright test

# Single file
npx playwright test e2e/step-library-workflow.spec.ts --reporter=list

# Single phase of the step-library suite
npx playwright test e2e/step-library-workflow.spec.ts -g "Phase C" --reporter=list

# Headed (visible browser)
npx playwright test e2e/step-library-workflow.spec.ts --headed

# Interactive UI mode
npx playwright test --ui
```

Run from the repo root.

## Requirements

- **A disposable Postgres on `localhost:5433`.** The e2e suite runs against a REAL Postgres (the fidelity gate — not the PGlite used by unit tests) at `postgres://postgres:postgres@localhost:5433/mission_designer_e2e`. Provision one with the bundled compose file (run from the repo root):
  ```bash
  docker compose -f docker-compose.e2e.yml up -d     # start (leave running across runs)
  docker compose -f docker-compose.e2e.yml down      # stop + remove when done
  ```
  Any Postgres reachable at that URL works; the compose helper is just convenience.
- **Run from the repo root.** Playwright boots `npm run dev:all` and `scripts/e2e-reset-db.mjs` relative to the cwd.
- **Ports 3001 (API) / 5174 (Vite).** Pinned in `playwright.config.ts` so the suite never collides with the manual-test container on `:3000`. The browser app runs on 5174 and reaches the API through Vite's `/api` proxy → 3001.
- **Fresh DB per run.** `playwright.config.ts` sets the Postgres `DATABASE_URL` for both the server child and the test-runner process (so `db.ts` reads the same DB the server writes) and `reuseExistingServer: false`. The webServer command runs `scripts/e2e-reset-db.mjs` first — it frees the e2e ports and resets the database with `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`, so every run starts from an empty schema that the app re-bootstraps (tables + triggers) on boot. `e2e/.auth/` is gitignored.
- **No manual dev server needed.** Playwright boots `npm run dev:all` itself (build tokens + help → `scripts/dev-start.mjs`).

## Bootstrap (globalSetup)

An empty DB boots the app to the first-run `/setup` flow. `e2e/global-setup.ts` runs once before all specs and drives that flow over the API:

1. `POST /api/auth/sign-up/email` — the first user is auto-promoted to administrator (the `databaseHooks.user.create.after` hook); no direct DB write.
2. `POST /api/v2/admin/role-templates/apply` — seed the role catalog (`role-author` / `role-approver` / `role-publisher` / `role-librarian`); boot no longer seeds roles.
3. `POST /api/v2/admin/teams` — create a default **E2E Team**.
4. `POST /api/v2/admin/setup-complete` — flips `setupComplete` (requires ≥1 admin AND ≥1 team).
5. Persist `e2e/.auth/admin.json` (the admin's storageState) and `e2e/.auth/state.json` (`{ adminUserId, defaultTeamId }`).

Specs reuse the persisted admin session via `browser.newContext({ storageState })` — there is **no UI register/login** (the sign-up route 403s once setup is complete). Additional users are created over `POST /api/v2/admin/users` (admin session; bypasses the sign-up gate). A "viewer" persona is a team member with zero roles.

### Helpers

| Helper                     | Purpose                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `e2e/global-setup.ts`      | One-time `/setup` bootstrap → persisted admin storageState + bootstrap ids                                |
| `e2e/helpers/auth.ts`      | `bootstrapFirstAdmin` (sign-up → auto-promote → sign-in → storageState)                                   |
| `e2e/helpers/admin.ts`     | Typed wrappers over `/api/v2/admin/*` (createUser/createTeam/addMember/setMemberRoles/applyRoleTemplates) |
| `e2e/helpers/session.ts`   | `signIn → storageState`; `loadAdminState` reads the bootstrap output                                      |
| `e2e/helpers/db.ts`        | `pg` Pool on the e2e Postgres DB + query helpers (libraries scoped by `teamId`)                           |
| `e2e/helpers/selectors.ts` | Named selector getters (treeitem-scoped, tabpanel-scoped)                                                 |
| `e2e/helpers/drag.ts`      | Synthetic ReactFlow palette-drag events (custom `application/reactflow` MIME type)                        |
| `e2e/helpers/fixtures.ts`  | Parameter variety matrix, library/workflow name helpers                                                   |

## step-library-workflow.spec.ts

Full-lifecycle suite for Step Libraries and Step Workflows. Creates 3 libraries, 3 workflows per library, 3-deep nested children per workflow, populates parameter variety, runs CRUD, and asserts the Postgres database matches the UI at every write. Libraries are **team-scoped** (`library.teamId`), created in the bootstrap's E2E Team.

**Total: 20 tests, ~3 minutes runtime, sequential (`describe.serial`).**

### Phases

| Phase | Tests | What it verifies                                                                  |
| ----- | ----- | --------------------------------------------------------------------------------- |
| A1    | 1     | Create 3 step libraries (scoped to the team)                                      |
| A2    | 1     | Library detail form save + reload                                                 |
| A3    | 1     | Sub-library with parentLibraryId                                                  |
| B     | 1     | 9 root step workflows across 3 libraries                                          |
| C     | 9     | 3-deep nested children per workflow (root + L1 + L2 + L3)                         |
| D     | 1     | Full parameter variety on 9 roots (inputs, outputs, values, all 5 resource types) |
| E1    | 1     | Rename library                                                                    |
| E2    | 1     | Rename root spec via Properties panel Name field                                  |
| F1    | 1     | Delete a **root** workflow → cascade its whole subtree                            |
| F2    | 1     | Delete a **root** workflow → cascade to its children                              |
| F3    | 1     | Delete library → cascade to its specs                                             |
| G     | 1     | Final DB snapshot with expected counts (16 specs, 3 libraries)                    |

### Key facts (current UI)

- **Authentication** — the suite reuses the admin bootstrapped by `global-setup.ts` (its persisted storageState), and DB assertions scope libraries by `library.teamId` (the bootstrap's E2E Team). No per-run sign-up, no SQL admin-flip, no UI register.
- **Workflow Properties sections are collapsed accordions** (`WorkflowInlineEditor`, `Accordion defaultValue=[]`). The Inputs/Outputs/Values/Resources "Add" buttons live inside `Accordion.Content`, so Phase D expands each section (clicks its header) before editing — see `expandPropertySection`.
- **The explicit Save reads the flow store, which lags the draft by a 300 ms debounce.** After the last parameter edit, Phase D waits for the debounce before clicking Save, so batch-save persists the final entry.
- **Only roots and libraries are deletable.** Nested child specs (depth > 0) have no delete affordance — deleting a sub-workflow's canvas node removes the reference but leaves the child spec orphaned. So F1/F2 delete **roots** via the "Item actions" menu (cascade via `parentSpecificationId ON DELETE CASCADE`), and F3 deletes a library via "Library actions". (F1 previously deleted a nested leaf; that capability was removed from the UI during the teams migration.)
- **`proxy_reference` rows are not written by the client** — proxy links live inline in `spec.data.nodes`.
- **Child workflows have read-only Inputs/Outputs** — parameter population only works on roots from the canvas.
- **Spec names must be unique per `(libraryId, name, version)`** — sibling chains use workflow-name-prefixed child names (e.g. `"WF 1-1 Child L1"` vs `"WF 1-2 Child L1"`).

## rbac-personas.spec.ts

Design-§13 two-user RBAC spec. Verifies that the four capability personas (viewer, author, approver, publisher) and a cross-team user each see exactly the rights the role model grants — both through the browser UI and via the REST API.

**Total: 12 tests, ~25 seconds runtime, sequential (`describe.serial`).**

### Fixture model

`beforeAll` is entirely API/DB-driven — no UI registration, no manual DB writes:

1. Two teams are created: **RBAC Alpha** (holds the test library + five spec rows seeded via `e2e/helpers/seed.ts` `seedRootSpec`) and **RBAC Beta** (a second team with its own library, used to verify cross-team invisibility).
2. Five users are created over `POST /api/v2/admin/users`:
   - **viewer** — Alpha member, zero roles (read-only by absence of any capability role)
   - **author** — Alpha member with `role-author`
   - **approver** — Alpha member with `role-approver`
   - **publisher** — Alpha member with `role-publisher`
   - **betaUser** — Beta member only; never added to Alpha
3. `seedRootSpec` inserts root specs directly into the e2e DB in precise lifecycle states (Draft, InReview, Approved, Effective, Draft-for-admin) so each persona test finds a spec in the exact state it needs — no UI setup steps between tests.
4. The "create" right is probed via `POST /api/v2/specifications/:id/new-version` (the create-gated endpoint); no batch-save is needed.

### Tests

| #   | Test                                                                                                | What it verifies                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | setup: each persona has the expected team + rights via `/api/v2/me`                                 | Sanity — five `GET /api/v2/me` calls confirm memberships and role assignments are correct before UI tests run                             |
| 2   | visibility (UI): each user sees only their own team's library                                       | Browser: viewer and betaUser each navigate to `/`; viewer sees Alpha library, betaUser sees Beta library only                             |
| 3   | visibility (API): non-members get 404; libraries list is team-scoped                                | betaUser `GET /api/v2/specifications/:alphaSpecId` → 404; `GET /api/v2/libraries` returns only Beta                                       |
| 4   | viewer (UI): no Item-actions menu on a spec, no New Library button                                  | Browser (viewer session): the spec row's "Item actions" button (`aria-label`) is absent on the Alpha spec; "New Library" button absent    |
| 5   | viewer (API): can read, cannot edit-transition or create a version                                  | `GET /spec` → 200; `PATCH /state` (edit) → 403; `POST /new-version` → 403                                                                 |
| 6   | author (UI): full Item-actions menu; Change-State offers only edit edges; Draft→InReview succeeds   | Browser (author session): Item-actions visible; Change-State dropdown items match only `edit` transitions; PATCH succeeds, tree refreshes |
| 7   | author (API): new-version allowed (create right); approve transition denied                         | `POST /new-version` → 200; `PATCH /state` (approve) → 403                                                                                 |
| 8   | approver (UI): Change-State offers only Approved; InReview→Approved succeeds; no New Version/Delete | Browser (approver session): dropdown has only "Approved"; transition succeeds; New Version + Delete absent in Item-actions                |
| 9   | approver (API): edit and makeEffective transitions denied                                           | `PATCH /state` (edit) → 403; `PATCH /state` (makeEffective) → 403                                                                         |
| 10  | publisher (UI): Change-State offers Effective/Superseded/Obsolete; Approved→Effective succeeds      | Browser (publisher session): dropdown has publish-side targets; transition succeeds and tree refreshes                                    |
| 11  | publisher (API): approve transition denied                                                          | `PATCH /state` (approve) → 403                                                                                                            |
| 12  | admin (API): sees both teams' specs and can force an illegal transition (D14)                       | Admin `GET /spec` on both Alpha and Beta specs → 200; `PATCH /state` (any→any override) → 200                                             |

### Key facts

- **No UI login per test.** Each persona's `storageState` is captured in `beforeAll` via `signIn` and injected via `browser.newContext({ storageState })`.
- **Spec states are seeded, not driven.** `seedRootSpec` (`e2e/helpers/seed.ts`) writes rows with exact `state` values so tests find the right lifecycle position without UI setup steps between them. Author, approver, and publisher each mutate their own dedicated spec row; no two UI tests touch the same row.
- **Hybrid verification.** UI tests assert gated affordances (presence/absence of "Item actions" menu items and Change-State dropdown targets); API tests assert HTTP status codes (403 forbidden / 404 not-visible / 200 allowed).

### New helpers

| Helper                | Purpose                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `e2e/helpers/seed.ts` | `seedRootSpec(db, libraryId, name, state)` — inserts a root spec row directly into the e2e DB in a given lifecycle state |

## workflow-library.spec.ts

Mirror of the step-library suite against `entityType='workflow'`. **Not yet migrated** to the team model — it still drives the removed Register flow and queries the dropped `library.userId`, so it is non-runnable pending the Phase-3 e2e restoration (same pattern as step-library: storageState auth + `teamId`).
