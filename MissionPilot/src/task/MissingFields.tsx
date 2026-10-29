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

import { Fragment, useState } from 'react'
import type { MissingItem } from '../screens/missing-fields'

const SHOWN = 3

// Spec §5.4: each missing field is a link that scrolls to and focuses it. A long list
// shows three and a "+N more" (P0 minor: it used to run on as one long line).
export function MissingFields({ items, onJump }: { items: MissingItem[]; onJump(item: MissingItem): void }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, SHOWN)
  const more = items.length - shown.length
  return (
    <p className="task-missing-fields">
      Missing:{' '}
      {shown.map((item, i) => (
        <Fragment key={item.fieldName}>
          {i > 0 && ', '}
          <button type="button" className="link-btn" onClick={() => onJump(item)}>
            {item.label}
          </button>
        </Fragment>
      ))}
      {more > 0 && (
        <>
          {' '}
          <button type="button" className="link-btn" onClick={() => setAll(true)}>
            +{more} more
          </button>
        </>
      )}
    </p>
  )
}
