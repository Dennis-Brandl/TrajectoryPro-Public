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
import { Sheet } from './Sheet'
import { SHORTCUT_LIST } from './shortcuts'

// Spec §15: `?` lists the shortcuts.
export function ShortcutsSheet({ onClose }: { onClose(): void }) {
  return (
    <Sheet label="Keyboard shortcuts" onClose={onClose} className="shortcuts-sheet">
      <table className="shortcuts-table">
        <tbody>
          {SHORTCUT_LIST.map((s) => (
            <tr key={s.keys}>
              <th scope="row">
                <kbd>{s.keys}</kbd>
              </th>
              <td>{s.does}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Sheet>
  )
}
