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

import { Trash2, Plus, Globe } from 'lucide-react'
import { Input } from '@mission/ui'
import { Textarea } from '@mission/ui'
import { Button } from '@mission/ui'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@mission/ui'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import type { ActionServerSpec, ActionServerConnectionType } from '@/types/nodes'

const CONNECTION_TYPES: ActionServerConnectionType[] = ['REST']

export interface ActionServersSectionProps {
  actionServers: ActionServerSpec[]
  onAdd: (server: ActionServerSpec) => void
  onRemove: (id: string) => void
  onUpdate: (id: string, updates: Partial<ActionServerSpec>) => void
  hideHeader?: boolean
}

export function ActionServersSection({
  actionServers,
  onAdd,
  onRemove,
  onUpdate,
  hideHeader = false,
}: ActionServersSectionProps) {
  const handleAdd = () => {
    onAdd({
      id: generateOID(WORKER_INTERNAL),
      name: '',
      uri: '',
      connectionType: 'REST',
    })
  }

  return (
    <div className={hideHeader ? '' : 'border-t border-slate-200 dark:border-slate-700 pt-3'}>
      <div className="flex items-center justify-between mb-2">
        {!hideHeader && <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">Action Servers</h3>}
        <Button variant="outline" size="sm" onClick={handleAdd} className={hideHeader ? 'ml-auto' : ''}>
          <Plus className="h-3 w-3 mr-1" />
          Add Server
        </Button>
      </div>

      <div className="space-y-2">
        {actionServers.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 italic text-center py-2">
            No action servers registered.
          </p>
        ) : (
          actionServers.map((server) => (
            <div
              key={server.id}
              className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-1.5 bg-green-100 dark:bg-green-900/30 rounded shrink-0">
                    <Globe className="h-4 w-4 text-green-600" />
                  </div>
                  <Input
                    value={server.name}
                    onChange={(e) => onUpdate(server.id, { name: e.target.value })}
                    className="h-7 text-sm font-medium w-56"
                    placeholder="Server name"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(server.id)}
                  className="h-8 w-8 p-0 text-slate-400 dark:text-slate-500 hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="pl-10 space-y-2">
                <Input
                  value={server.uri}
                  onChange={(e) => onUpdate(server.id, { uri: e.target.value })}
                  className="h-7 text-sm"
                  placeholder="https://server-address:port/api"
                />
                <Input
                  value={server.apiKey || ''}
                  onChange={(e) => onUpdate(server.id, { apiKey: e.target.value || undefined })}
                  className="h-7 text-sm font-mono"
                  placeholder="API key (optional)"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Textarea
                  value={server.description || ''}
                  onChange={(e) => onUpdate(server.id, { description: e.target.value || undefined })}
                  className="text-sm min-h-[4.5rem] resize-y overflow-y-auto"
                  rows={3}
                  placeholder="Description (optional)"
                />
                <div className="flex items-center gap-2">
                  <Select
                    value={server.connectionType}
                    onValueChange={(value: ActionServerConnectionType) =>
                      onUpdate(server.id, { connectionType: value })
                    }
                  >
                    <SelectTrigger className="w-32 h-7 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONNECTION_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
