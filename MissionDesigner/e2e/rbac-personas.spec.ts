// Copyright 2026 Dennis L. Brandl
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  test,
  expect,
  request as pwRequest,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { ADMIN_STORAGE_STATE, signIn } from './helpers/session'
import { createUser, createTeam, createLibrary, addMember, setMemberRoles } from './helpers/admin'
import { openWritableDb, seedRootSpec } from './helpers/seed'

/**
 * Design §13 two-user RBAC spec (Slice 7 Phase 2). Two teams (Alpha, Beta) and
 * the four capability personas — viewer / author / approver / publisher — plus a
 * Beta-only user. Proves team-scoped visibility + right-gated lifecycle both in
 * the browser UI (gated affordances) and at the REST layer (403/404/200).
 *
 * Setup is entirely API/DB-driven (no content-authoring UI). The "create" right
 * is probed via the create-gated POST /new-version, so no batch-save is needed.
 */

const API = 'http://localhost:3001'
const ORIGIN = 'http://localhost:5174'
const PW = 'PersonaPass123!'

type StorageState = Awaited<ReturnType<APIRequestContext['storageState']>>

interface Persona {
  email: string
  userId: string
  state: StorageState
}

interface Suite {
  alphaTeamId: string
  betaTeamId: string
  alphaLibId: string
  betaLibId: string
  specs: Record<string, string> // logical key -> spec id
  viewer: Persona
  author: Persona
  approver: Persona
  publisher: Persona
  beta: Persona
}

const S = {} as Suite

/** Create a user, assign its team/roles, then sign it in (fresh ctx) for a storageState. */
async function makePersona(
  adminReq: APIRequestContext,
  email: string,
  assign: (userId: string) => Promise<unknown>,
): Promise<Persona> {
  const { id } = await createUser(adminReq, { email, password: PW, name: email })
  await assign(id)
  const ctx = await pwRequest.newContext()
  try {
    const state = await signIn(ctx, { email, password: PW })
    return { email, userId: id, state }
  } finally {
    await ctx.dispose()
  }
}

/** Run `fn` with a per-persona API request context (own session cookies). */
async function asPersona<T>(state: StorageState, fn: (req: APIRequestContext) => Promise<T>): Promise<T> {
  const req = await pwRequest.newContext({ storageState: state })
  try {
    return await fn(req)
  } finally {
    await req.dispose()
  }
}

/** PATCH a spec's state as the given request context. Returns the raw response. */
function patchState(req: APIRequestContext, specId: string, newState: string, extra: Record<string, unknown> = {}) {
  return req.patch(`${API}/api/v2/specifications/${specId}/state`, {
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    data: { newState, reason: 'e2e rbac', ...extra },
  })
}

/** POST a new version as the given request context. */
function newVersion(req: APIRequestContext, specId: string, version: string) {
  return req.post(`${API}/api/v2/specifications/${specId}/new-version`, {
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    data: { version },
  })
}

/** Open the editor as a persona on the Workflows tab. `browser` comes from the test callback args. Caller closes ctx. */
async function openAs(browser: Browser, state: StorageState): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: state })
  const page = await ctx.newPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const tab = page.getByRole('tab', { name: 'Workflows' })
  await expect(tab).toBeVisible({ timeout: 10_000 })
  await tab.click()
  return { ctx, page }
}

/** Reveal a workflow library's spec rows. Scope the Expand control to the library's own
 *  treeitem row (LibraryItem is role="treeitem") so a multi-library view never trips Playwright
 *  strict mode; idempotent — an already-expanded row exposes "Collapse", not "Expand". */
async function expandTheLibrary(page: Page, libName: string): Promise<void> {
  const row = page.locator('[role="treeitem"]').filter({ has: page.getByText(libName, { exact: true }) })
  await expect(row).toBeVisible({ timeout: 8_000 })
  const expand = row.getByRole('button', { name: 'Expand' })
  if (await expand.isVisible().catch(() => false)) await expand.click()
}

function specRow(page: Page, name: string) {
  return page.locator('[data-testid="spec-tree-row"]').filter({ has: page.getByText(name, { exact: true }) })
}

test.describe.serial('Teams/RBAC personas (design §13)', () => {
  test.beforeAll(async () => {
    const adminReq = await pwRequest.newContext({ storageState: ADMIN_STORAGE_STATE })
    try {
      // Two teams (separate from global-setup's "E2E Team" for isolation).
      S.alphaTeamId = (await createTeam(adminReq, { name: 'RBAC Alpha' })).id
      S.betaTeamId = (await createTeam(adminReq, { name: 'RBAC Beta' })).id

      // One workflow library per team (admin holds library.create everywhere).
      S.alphaLibId = (
        await createLibrary(adminReq, { name: 'Alpha WF Lib', entityType: 'workflow', teamId: S.alphaTeamId })
      ).id
      S.betaLibId = (
        await createLibrary(adminReq, { name: 'Beta WF Lib', entityType: 'workflow', teamId: S.betaTeamId })
      ).id

      // Personas. setMemberRoles auto-creates membership; viewer = membership w/ no roles.
      S.viewer = await makePersona(adminReq, 'rbac-viewer@e2e.test', (uid) => addMember(adminReq, S.alphaTeamId, uid))
      S.author = await makePersona(adminReq, 'rbac-author@e2e.test', (uid) =>
        setMemberRoles(adminReq, S.alphaTeamId, uid, ['role-author']),
      )
      S.approver = await makePersona(adminReq, 'rbac-approver@e2e.test', (uid) =>
        setMemberRoles(adminReq, S.alphaTeamId, uid, ['role-approver']),
      )
      S.publisher = await makePersona(adminReq, 'rbac-publisher@e2e.test', (uid) =>
        setMemberRoles(adminReq, S.alphaTeamId, uid, ['role-publisher']),
      )
      S.beta = await makePersona(adminReq, 'rbac-beta@e2e.test', (uid) =>
        setMemberRoles(adminReq, S.betaTeamId, uid, ['role-author']),
      )
    } finally {
      await adminReq.dispose()
    }

    // Seed root specs in precise states (direct DB).
    const db = openWritableDb()
    try {
      S.specs = {
        draft: await seedRootSpec(db, { libraryId: S.alphaLibId, name: 'WF-Draft', state: 'Draft' }), // shared negative-probe board (never mutated)
        approvedRO: await seedRootSpec(db, { libraryId: S.alphaLibId, name: 'WF-ApprovedRO', state: 'Approved' }), // makeEffective negative probes (never mutated)
        author: await seedRootSpec(db, { libraryId: S.alphaLibId, name: 'WF-Author', state: 'Draft' }), // author UI edit + new-version
        approver: await seedRootSpec(db, { libraryId: S.alphaLibId, name: 'WF-Approver', state: 'InReview' }), // approver UI approve
        publisher: await seedRootSpec(db, { libraryId: S.alphaLibId, name: 'WF-Publisher', state: 'Approved' }), // publisher UI makeEffective
        adminForce: await seedRootSpec(db, { libraryId: S.alphaLibId, name: 'WF-AdminForce', state: 'Draft' }), // admin illegal-edge override
        beta: await seedRootSpec(db, { libraryId: S.betaLibId, name: 'WF-Beta', state: 'Draft' }), // cross-team
      }
    } finally {
      await db.end()
    }
  })

  test('setup: each persona has the expected team + rights via /api/v2/me', async () => {
    const me = (state: StorageState) =>
      asPersona(state, async (req) => (await req.get(`${API}/api/v2/me`, { headers: { Origin: ORIGIN } })).json())

    const viewer = await me(S.viewer.state)
    expect(viewer.memberships).toContain(S.alphaTeamId)
    expect(viewer.rightsByTeam[S.alphaTeamId] ?? []).toEqual([]) // zero roles
    expect(viewer.isAdministrator).toBe(false)

    const author = await me(S.author.state)
    expect(author.rightsByTeam[S.alphaTeamId]).toEqual(
      expect.arrayContaining(['workflow:create', 'workflow:edit', 'workflow:delete']),
    )
    expect(author.rightsByTeam[S.alphaTeamId]).not.toContain('workflow:approve')

    const approver = await me(S.approver.state)
    expect(approver.rightsByTeam[S.alphaTeamId]).toEqual(expect.arrayContaining(['workflow:approve']))
    expect(approver.rightsByTeam[S.alphaTeamId]).not.toContain('workflow:makeEffective')

    const publisher = await me(S.publisher.state)
    expect(publisher.rightsByTeam[S.alphaTeamId]).toEqual(expect.arrayContaining(['workflow:makeEffective']))
    expect(publisher.rightsByTeam[S.alphaTeamId]).not.toContain('workflow:approve')

    const beta = await me(S.beta.state)
    expect(beta.memberships).toContain(S.betaTeamId)
    expect(beta.memberships).not.toContain(S.alphaTeamId)
  })

  test("visibility (UI): each user sees only their own team's library", async ({ browser }) => {
    const beta = await openAs(browser, S.beta.state)
    try {
      await expect(beta.page.getByText('Beta WF Lib', { exact: true })).toBeVisible({ timeout: 8_000 })
      await expect(beta.page.getByText('Alpha WF Lib', { exact: true })).toHaveCount(0)
    } finally {
      await beta.ctx.close()
    }

    const viewer = await openAs(browser, S.viewer.state)
    try {
      await expect(viewer.page.getByText('Alpha WF Lib', { exact: true })).toBeVisible({ timeout: 8_000 })
      await expect(viewer.page.getByText('Beta WF Lib', { exact: true })).toHaveCount(0)
    } finally {
      await viewer.ctx.close()
    }
  })

  test('visibility (API): non-members get 404; libraries list is team-scoped', async () => {
    // Alpha viewer cannot see the Beta library or its spec.
    await asPersona(S.viewer.state, async (req) => {
      expect(
        (await req.get(`${API}/api/v2/specifications/${S.specs.beta}`, { headers: { Origin: ORIGIN } })).status(),
      ).toBe(404)
      expect(
        (
          await req.get(`${API}/api/v2/libraries/${S.betaLibId}/specifications`, { headers: { Origin: ORIGIN } })
        ).status(),
      ).toBe(404)
      const libs = await (
        await req.get(`${API}/api/v2/libraries?entityType=workflow`, { headers: { Origin: ORIGIN } })
      ).json()
      const ids = (libs.libraries as Array<{ id: string }>).map((l) => l.id)
      expect(ids).toContain(S.alphaLibId)
      expect(ids).not.toContain(S.betaLibId)
    })
    // Beta user cannot see the Alpha spec.
    await asPersona(S.beta.state, async (req) => {
      expect(
        (await req.get(`${API}/api/v2/specifications/${S.specs.draft}`, { headers: { Origin: ORIGIN } })).status(),
      ).toBe(404)
    })
  })

  test('viewer (UI): no Item-actions menu on a spec, no New Library button', async ({ browser }) => {
    const v = await openAs(browser, S.viewer.state)
    try {
      await expandTheLibrary(v.page, 'Alpha WF Lib')
      const row = specRow(v.page, 'WF-Draft')
      await expect(row).toBeVisible({ timeout: 8_000 })
      await row.hover()
      await expect(row.getByRole('button', { name: 'Item actions' })).toHaveCount(0)
      await expect(v.page.getByRole('button', { name: 'New Library' })).toHaveCount(0)
    } finally {
      await v.ctx.close()
    }
  })

  test('viewer (API): can read, cannot edit-transition or create a version', async () => {
    await asPersona(S.viewer.state, async (req) => {
      // visible (200) — proves the 403s below are right-denials, not visibility 404s
      expect(
        (await req.get(`${API}/api/v2/specifications/${S.specs.draft}`, { headers: { Origin: ORIGIN } })).status(),
      ).toBe(200)
      // legal edit edge (Draft→InReview) but no edit right → 403
      expect((await patchState(req, S.specs.draft, 'InReview')).status()).toBe(403)
      // new-version requires the create right → 403
      expect((await newVersion(req, S.specs.draft, '2.0.0')).status()).toBe(403)
    })
  })

  test('author (UI): full Item-actions menu; Change-State offers only edit edges; Draft→InReview succeeds', async ({
    browser,
  }) => {
    const a = await openAs(browser, S.author.state)
    try {
      await expandTheLibrary(a.page, 'Alpha WF Lib')
      const row = specRow(a.page, 'WF-Author')
      await expect(row).toBeVisible({ timeout: 8_000 })
      await row.hover()
      await row.getByRole('button', { name: 'Item actions' }).click()
      // author holds create + delete → these items present
      await expect(a.page.getByRole('menuitem', { name: 'Change State…' })).toBeVisible()
      await expect(a.page.getByRole('menuitem', { name: 'Create New Version…' })).toBeVisible()
      await expect(a.page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
      await a.page.getByRole('menuitem', { name: 'Change State…' }).click()

      // Change-State dialog: dropdown offers edit edges (InTest, InReview) but NOT Approved (no approve right).
      const dialog = a.page.getByRole('dialog')
      await expect(dialog.getByText('Change State — WF-Author', { exact: false })).toBeVisible()
      await dialog.locator('#new-state').click()
      await expect(a.page.getByRole('option', { name: 'InReview' })).toBeVisible()
      await expect(a.page.getByRole('option', { name: 'InTest' })).toBeVisible()
      await expect(a.page.getByRole('option', { name: 'Approved' })).toHaveCount(0)
      await a.page.getByRole('option', { name: 'InReview' }).click()

      await dialog.locator('#reason').fill('ready for review')
      await dialog.getByRole('button', { name: 'Save' }).click()
      await expect(a.page.getByText('State changed to InReview')).toBeVisible({ timeout: 8_000 })
    } finally {
      await a.ctx.close()
    }
  })

  test('author (API): new-version allowed (create right); approve transition denied', async () => {
    await asPersona(S.author.state, async (req) => {
      // create right → new-version 200 (clones WF-Author, now InReview, to a Draft 2.0.0)
      expect((await newVersion(req, S.specs.author, '2.0.0')).status()).toBe(200)
      // legal approve edge (Draft→Approved on the never-mutated board) but no approve right → 403
      expect((await patchState(req, S.specs.draft, 'Approved')).status()).toBe(403)
    })
  })

  test('approver (UI): Change-State offers only Approved; InReview→Approved succeeds; no New Version/Delete', async ({
    browser,
  }) => {
    const a = await openAs(browser, S.approver.state)
    try {
      await expandTheLibrary(a.page, 'Alpha WF Lib')
      const row = specRow(a.page, 'WF-Approver')
      await expect(row).toBeVisible({ timeout: 8_000 })
      await row.hover()
      await row.getByRole('button', { name: 'Item actions' }).click()
      await expect(a.page.getByRole('menuitem', { name: 'Change State…' })).toBeVisible()
      await expect(a.page.getByRole('menuitem', { name: 'Create New Version…' })).toHaveCount(0)
      await expect(a.page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0)
      await a.page.getByRole('menuitem', { name: 'Change State…' }).click()

      const dialog = a.page.getByRole('dialog')
      await dialog.locator('#new-state').click()
      await expect(a.page.getByRole('option', { name: 'Approved' })).toBeVisible()
      await expect(a.page.getByRole('option', { name: 'InTest' })).toHaveCount(0) // edit edge filtered (no edit right)
      await a.page.getByRole('option', { name: 'Approved' }).click()
      await dialog.locator('#reason').fill('approving')
      await dialog.getByRole('button', { name: 'Save' }).click()
      await expect(a.page.getByText('State changed to Approved')).toBeVisible({ timeout: 8_000 })
    } finally {
      await a.ctx.close()
    }
  })

  test('approver (API): edit and makeEffective transitions denied', async () => {
    await asPersona(S.approver.state, async (req) => {
      // legal edit edge (Draft→InReview) but no edit right → 403
      expect((await patchState(req, S.specs.draft, 'InReview')).status()).toBe(403)
      // legal makeEffective edge (Approved→Effective on the read-only Approved spec) but no makeEffective right → 403
      expect((await patchState(req, S.specs.approvedRO, 'Effective', { effectiveFrom: Date.now() })).status()).toBe(403)
    })
  })

  test('publisher (UI): Change-State offers Effective/Superseded/Obsolete; Approved→Effective succeeds', async ({
    browser,
  }) => {
    const p = await openAs(browser, S.publisher.state)
    try {
      await expandTheLibrary(p.page, 'Alpha WF Lib')
      const row = specRow(p.page, 'WF-Publisher')
      await expect(row).toBeVisible({ timeout: 8_000 })
      await row.hover()
      await row.getByRole('button', { name: 'Item actions' }).click()
      await p.page.getByRole('menuitem', { name: 'Change State…' }).click()

      const dialog = p.page.getByRole('dialog')
      await dialog.locator('#new-state').click()
      await expect(p.page.getByRole('option', { name: 'Effective' })).toBeVisible()
      await expect(p.page.getByRole('option', { name: 'Superseded' })).toBeVisible()
      await expect(p.page.getByRole('option', { name: 'Obsolete' })).toBeVisible()
      // Exactly the three makeEffective targets — no edit/approve edge leaks into a publisher's dropdown.
      await expect(p.page.getByRole('option')).toHaveCount(3)
      await p.page.getByRole('option', { name: 'Effective' }).click()
      // Effective reveals the date input (defaults to today) — leave as-is.
      await expect(dialog.locator('#effective-date')).toBeVisible()
      await dialog.locator('#reason').fill('publishing')
      await dialog.getByRole('button', { name: 'Save' }).click()
      await expect(p.page.getByText('State changed to Effective')).toBeVisible({ timeout: 8_000 })
    } finally {
      await p.ctx.close()
    }
  })

  test('publisher (API): approve transition denied', async () => {
    await asPersona(S.publisher.state, async (req) => {
      // legal approve edge (Draft→Approved) but no approve right → 403
      expect((await patchState(req, S.specs.draft, 'Approved')).status()).toBe(403)
    })
  })

  test("admin (API): sees both teams' specs and can force an illegal transition (D14)", async () => {
    const adminReq = await pwRequest.newContext({ storageState: ADMIN_STORAGE_STATE })
    try {
      // Admin is a member of neither RBAC team yet sees both (isAdministrator).
      expect(
        (await adminReq.get(`${API}/api/v2/specifications/${S.specs.beta}`, { headers: { Origin: ORIGIN } })).status(),
      ).toBe(200)
      expect(
        (await adminReq.get(`${API}/api/v2/specifications/${S.specs.draft}`, { headers: { Origin: ORIGIN } })).status(),
      ).toBe(200)

      // Draft→Effective is ILLEGAL for members (409) but admin overrides → 200, lands Effective.
      const res = await patchState(adminReq, S.specs.adminForce, 'Effective', { effectiveFrom: Date.now() })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.spec.state).toBe('Effective')
    } finally {
      await adminReq.dispose()
    }
  })
})
