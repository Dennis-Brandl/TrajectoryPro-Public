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

import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface HeaderToolsContextValue {
  slot: HTMLElement | null
  setSlot: (el: HTMLElement | null) => void
}

const HeaderToolsContext = createContext<HeaderToolsContextValue>({ slot: null, setSlot: () => {} })

/** Holds the header's tools slot so a page can put its controls there. */
export function HeaderToolsProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  return <HeaderToolsContext.Provider value={{ slot, setSlot }}>{children}</HeaderToolsContext.Provider>
}

/** Rendered inside the header's tools area; the target of HeaderTools. */
export function HeaderToolsSlot({ start }: { start?: ReactNode }) {
  const { setSlot } = useContext(HeaderToolsContext)
  return (
    <>
      {start}
      <div ref={setSlot} data-testid="header-tools" className="flex min-w-0 flex-1 items-center gap-2" />
    </>
  )
}

/** Puts its children into the app header's tools slot. */
export function HeaderTools({ children }: { children: ReactNode }) {
  const { slot } = useContext(HeaderToolsContext)
  return slot ? createPortal(children, slot) : null
}
