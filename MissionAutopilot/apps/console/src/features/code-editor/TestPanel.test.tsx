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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import TestPanel from './TestPanel'

let mockData: unknown

vi.mock('./hooks', () => ({
  useTestCode: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    data: mockData,
  }),
}))

function renderPanel() {
  render(
    <TestPanel
      actionOid="a1"
      state="EXECUTING"
      code="def execute(): pass"
      inputParameters={[]}
      outputParameters={[]}
    />
  )
}

describe('TestPanel', () => {
  beforeEach(() => {
    mockData = undefined
  })

  it('shows the error and the stdout of a failed test run', () => {
    mockData = {
      success: false,
      error_type: 'RUNTIME_ERROR',
      error: 'RuntimeError: x',
      stdout: 'before\n',
      stderr: '',
      execution_time_ms: 1,
    }
    renderPanel()
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText(/before/)).toBeTruthy()
    expect(screen.getByText(/RuntimeError: x/)).toBeTruthy()
    expect(screen.getByText(/RUNTIME_ERROR/)).toBeTruthy()
  })

  it('shows stdout and stderr of a successful test run', () => {
    mockData = {
      success: true,
      outputs: {},
      return_value: true,
      stdout: 'hello out\n',
      stderr: 'hello err\n',
      execution_time_ms: 2,
    }
    renderPanel()
    expect(screen.getByText('Success')).toBeTruthy()
    expect(screen.getByText(/hello out/)).toBeTruthy()
    expect(screen.getByText(/hello err/)).toBeTruthy()
  })
})
