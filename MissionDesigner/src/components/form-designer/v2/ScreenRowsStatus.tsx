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
import { Rows3 } from 'lucide-react'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { screenRowsSource } from '@/lib/form-document/screen-rows'
import { SCREEN_NAME } from './BreakpointTabs'

/**
 * One line under the device tabs on Tablet and Phone: where this screen's rows come from, and,
 * when it has its own, a button that goes back to the rows it would inherit. Nothing on Desktop.
 */
export function ScreenRowsStatus() {
  const bp = useFormDocumentStore((s) => s.activeBreakpoint)
  const document = useFormDocumentStore((s) => s.document)
  const resetScreenRows = useFormDocumentStore((s) => s.resetScreenRows)
  if (bp === 'base') return null
  const source = screenRowsSource(document, bp)
  const own = source === bp
  // Phone goes back to Tablet's rows when Tablet has its own, else to Desktop's.
  const inheritsFrom = bp === 'phone' && screenRowsSource(document, 'tablet') === 'tablet' ? 'tablet' : 'base'
  return (
    <div
      role="status"
      aria-label="Rows on this screen"
      className="bg-background text-muted-foreground border-b border-border"
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', fontSize: 12, minHeight: 30 }}
    >
      <Rows3 size={14} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{own ? "Rows: this screen's own" : `Rows: same as ${SCREEN_NAME[source]}`}</span>
      {own && (
        <button
          type="button"
          onClick={resetScreenRows}
          title={`Show the same rows as ${SCREEN_NAME[inheritsFrom]} on this screen`}
          className="bg-muted text-foreground dark:text-muted-foreground border border-border"
          style={{ fontSize: 12, padding: '2px 10px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          Use {SCREEN_NAME[inheritsFrom]} rows
        </button>
      )}
    </div>
  )
}
