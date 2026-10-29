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

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/stores/specificationStore/saveScheduler', () => ({ flushNow: vi.fn() }))
vi.mock('@/stores/specificationStore/libraryCrud', () => ({
  flushLibrariesNow: vi.fn().mockResolvedValue(undefined),
  discardLibraryEdits: vi.fn(),
}))

import { flushNow } from '@/stores/specificationStore/saveScheduler'
import { useSpecificationStore } from '@/stores/specificationStore'
import { useWorkflowSessionStore, logoutWhenSaved } from '@/stores/workflowSessionStore'

beforeEach(() => {
  vi.mocked(flushNow).mockReset()
  useSpecificationStore.getState()._reset()
  useWorkflowSessionStore.getState().clearSession()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('workflowSessionStore.handleSave', () => {
  it("the unsaved dialog's Save does not run the pending action when the save fails", async () => {
    vi.mocked(flushNow).mockRejectedValue(new Error('save failed'))
    const pending = vi.fn()
    useWorkflowSessionStore.getState().startSession('root', 'lib')
    useWorkflowSessionStore.getState().requestNavigation(pending)
    await useWorkflowSessionStore.getState().handleSave()
    expect(pending).not.toHaveBeenCalled()
    const s = useWorkflowSessionStore.getState()
    expect(s.editingRootSpecId).toBe('root')
    expect(s.showUnsavedDialog).toBe(true)
  })

  it("the unsaved dialog's Save runs the pending action after a successful save", async () => {
    vi.mocked(flushNow).mockResolvedValue(undefined)
    const pending = vi.fn()
    useWorkflowSessionStore.getState().startSession('root', 'lib')
    useWorkflowSessionStore.getState().requestNavigation(pending)
    await useWorkflowSessionStore.getState().handleSave()
    expect(pending).toHaveBeenCalledTimes(1)
    expect(useWorkflowSessionStore.getState().editingRootSpecId).toBeNull()
  })
})

describe('logoutWhenSaved', () => {
  it('sign-out with a save in flight shows the unsaved dialog', async () => {
    vi.mocked(flushNow).mockResolvedValue(undefined)
    useSpecificationStore.setState((s) => {
      s.savingIds.add('r')
    })
    const performLogout = vi.fn()
    await logoutWhenSaved(performLogout)
    expect(performLogout).not.toHaveBeenCalled()
    const s = useWorkflowSessionStore.getState()
    expect(s.showUnsavedDialog).toBe(true)
    expect(s.pendingAction).toBe(performLogout)
  })

  it('sign-out does not log out when the save fails', async () => {
    vi.mocked(flushNow).mockRejectedValue(new Error('save failed'))
    const performLogout = vi.fn()
    await logoutWhenSaved(performLogout)
    expect(performLogout).not.toHaveBeenCalled()
    expect(useWorkflowSessionStore.getState().showUnsavedDialog).toBe(true)
  })

  it('sign-out logs out when everything is saved', async () => {
    vi.mocked(flushNow).mockResolvedValue(undefined)
    const performLogout = vi.fn()
    await logoutWhenSaved(performLogout)
    expect(performLogout).toHaveBeenCalledTimes(1)
  })
})
