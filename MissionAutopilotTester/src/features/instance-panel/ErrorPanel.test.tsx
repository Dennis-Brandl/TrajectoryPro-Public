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

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorPanel } from './ErrorPanel'

describe('ErrorPanel', () => {
  it('renders nothing when all error fields are empty', () => {
    const { container } = render(
      <ErrorPanel terminalError={null} latestError={undefined} latestTraceback={undefined} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows terminalError as a labelled block when set', () => {
    render(
      <ErrorPanel
        terminalError="action timed out"
        latestError={undefined}
        latestTraceback={undefined}
      />
    )
    expect(screen.getByText(/terminal error/i)).toBeInTheDocument()
    expect(screen.getByText('action timed out')).toBeInTheDocument()
  })

  it('shows latest stderr message', () => {
    render(
      <ErrorPanel
        terminalError={null}
        latestError="NameError: x is not defined"
        latestTraceback={undefined}
      />
    )
    expect(screen.getByText(/latest error/i)).toBeInTheDocument()
    expect(screen.getByText('NameError: x is not defined')).toBeInTheDocument()
  })

  it('shows traceback when set', () => {
    render(
      <ErrorPanel
        terminalError={null}
        latestError={undefined}
        latestTraceback={'Traceback (most recent call last):\n  File "x.py"'}
      />
    )
    expect(screen.getAllByText(/traceback/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/File "x\.py"/)).toBeInTheDocument()
  })

  it('renders all three blocks together when all set', () => {
    render(
      <ErrorPanel
        terminalError="failed"
        latestError="boom"
        latestTraceback="Traceback (most recent call last):\nline 1"
      />
    )
    expect(screen.getByText(/terminal error/i)).toBeInTheDocument()
    expect(screen.getByText(/latest error/i)).toBeInTheDocument()
    expect(screen.getAllByText(/traceback/i).length).toBeGreaterThanOrEqual(1)
  })
})
