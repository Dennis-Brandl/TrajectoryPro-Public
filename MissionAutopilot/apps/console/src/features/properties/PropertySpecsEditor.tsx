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

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button, Input } from '@mission/ui'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ActionPropertySpec, PropertyEdit } from '@/lib/types'

interface Props {
  specs: ActionPropertySpec[]
  /** Called with ONLY the entries whose value differs from `specs`. */
  onSave: (edits: PropertyEdit[]) => Promise<unknown>
  isSaving: boolean
  error: Error | null
  title?: string
}

const draftKey = (property: string, entry: string) => `${property}\0${entry}`

/**
 * Action Properties card with an inline value editor. Used for both the
 * environment-level set (Environment page) and an action's own set (Action
 * page) — the two differ only in which mutation the page passes as `onSave`.
 *
 * Values only: names, entries and properties are Designer's to add or remove.
 */
export function PropertySpecsEditor({
  specs,
  onSave,
  isSaving,
  error,
  title = 'Action Properties',
}: Props) {
  const [editing, setEditing] = useState(false)
  // Draft values keyed by (property, entry); absent = unchanged from `specs`.
  const [draft, setDraft] = useState<Map<string, string>>(new Map())

  const edits: PropertyEdit[] = []
  for (const spec of specs) {
    for (const entry of spec.entries) {
      const value = draft.get(draftKey(spec.name, entry.name))
      if (value !== undefined && value !== entry.value) {
        edits.push({ property: spec.name, entry: entry.name, value })
      }
    }
  }

  function startEditing() {
    setDraft(new Map())
    setEditing(true)
  }

  function cancel() {
    setDraft(new Map())
    setEditing(false)
  }

  async function save() {
    if (edits.length === 0) return
    try {
      await onSave(edits)
      setDraft(new Map())
      setEditing(false)
    } catch {
      // The page-level mutation surfaces the failure through `error`;
      // stay in edit mode so the operator can correct and retry.
    }
  }

  if (specs.length === 0) {
    return (
      <Card className="py-2 gap-1">
        <CardHeader className="pb-0 px-3">
          <CardTitle className="text-sm">{title}</CardTitle>
        </CardHeader>
        <CardContent className="px-3">
          <p className="text-muted-foreground text-xs text-center py-2">No action properties</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="py-2 gap-1">
      <CardHeader className="pb-0 px-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm">{title}</CardTitle>
        {!editing && (
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={startEditing}>
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="px-3 space-y-2">
        {specs.map((spec) => (
          <div key={spec.name}>
            <p className="font-medium text-xs mb-0.5">{spec.name}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-7">Property</TableHead>
                  <TableHead className="h-7">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spec.entries.map((entry) => {
                  const key = draftKey(spec.name, entry.name)
                  const draftValue = draft.get(key) ?? entry.value
                  return (
                    <TableRow key={entry.name}>
                      <TableCell className="font-medium text-xs py-1 align-middle">
                        {entry.name}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground py-1">
                        {editing ? (
                          <Input
                            aria-label={`${spec.name} ${entry.name}`}
                            className="h-7 text-xs"
                            value={draftValue}
                            disabled={isSaving}
                            onChange={(e) => {
                              const next = new Map(draft)
                              next.set(key, e.target.value)
                              setDraft(next)
                            }}
                          />
                        ) : (
                          entry.value
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ))}

        {editing && (
          <div className="space-y-1 pt-1">
            {error && <p className="text-xs text-destructive">{error.message}</p>}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => void save()}
                disabled={isSaving || edits.length === 0}
              >
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={cancel}
                disabled={isSaving}
              >
                Cancel
              </Button>
              {edits.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {edits.length} change{edits.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
