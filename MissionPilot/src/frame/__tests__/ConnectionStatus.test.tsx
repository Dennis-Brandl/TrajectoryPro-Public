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

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ConnectionStatus } from '../ConnectionStatus'

afterEach(cleanup)

const at = new Date(2026, 9, 9, 10, 42)

describe('ConnectionStatus (spec §5.1: icon + word + "synced HH:MM")', () => {
  it('online with live data: Online · synced HH:MM, in the ok style', () => {
    const { container } = render(<ConnectionStatus online stale={false} syncedAt={at} />)
    expect(container.textContent).toBe('●Online · synced 10:42')
    expect(container.firstElementChild!.className).toBe('conn conn-ok')
  })

  it('offline: Offline · last synced HH:MM, in the warn style', () => {
    const { container } = render(<ConnectionStatus online={false} stale={false} syncedAt={at} />)
    expect(container.textContent).toBe('○Offline · last synced 10:42')
    expect(container.firstElementChild!.className).toBe('conn conn-warn')
  })

  it('online but the engine is unreachable: Reconnecting… · last synced HH:MM, in the warn style (final review)', () => {
    const { container } = render(<ConnectionStatus online stale={false} unreachable syncedAt={at} />)
    expect(container.textContent).toBe('○Reconnecting… · last synced 10:42')
    expect(container.firstElementChild!.className).toBe('conn conn-warn')
  })

  it('before the first live fetch: Connecting…', () => {
    const { container } = render(<ConnectionStatus online stale syncedAt={null} />)
    expect(container.textContent).toBe('◌Connecting…')
    expect(container.firstElementChild!.className).toBe('conn conn-wait')
  })
})
