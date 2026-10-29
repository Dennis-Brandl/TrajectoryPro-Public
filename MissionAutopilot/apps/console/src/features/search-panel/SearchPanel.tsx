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

import { useNavigate } from 'react-router'
import { Search } from 'lucide-react'
import { usePanelContext } from '@/layout/PanelContext'
import { useExplorerData } from '@/features/explorer/hooks'

interface ActionMatch {
  actionOid: string
  actionName: string
  envName: string
}

interface StateMatch {
  actionOid: string
  actionName: string
  envName: string
  state: string
}

export default function SearchPanel() {
  const { searchQuery, setSearchQuery } = usePanelContext()
  const { tree } = useExplorerData()
  const navigate = useNavigate()

  const q = searchQuery.trim().toLowerCase()

  const envMatches = q === '' ? [] : tree.filter((e) => e.local_id.toLowerCase().includes(q))

  const actionMatches: ActionMatch[] = []
  const stateMatches: StateMatch[] = []
  if (q !== '') {
    for (const env of tree) {
      for (const action of env.actions) {
        if (action.local_id.toLowerCase().includes(q)) {
          actionMatches.push({
            actionOid: action.oid,
            actionName: action.local_id,
            envName: env.local_id,
          })
        }
        for (const state of action.states_with_code) {
          if (state.toLowerCase().includes(q)) {
            stateMatches.push({
              actionOid: action.oid,
              actionName: action.local_id,
              envName: env.local_id,
              state,
            })
          }
        }
      }
    }
  }

  const totalMatches = envMatches.length + actionMatches.length + stateMatches.length

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Search
        </span>
      </div>

      <div className="px-2 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 px-2 py-1 rounded bg-muted text-xs focus-within:ring-1 focus-within:ring-primary">
          <Search size={12} className="text-muted-foreground shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter environments, actions, states..."
            className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {q === '' && (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            Type to search across environments, actions, and states with code.
          </p>
        )}
        {q !== '' && totalMatches === 0 && (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            No matches for &quot;{searchQuery}&quot;
          </p>
        )}

        {envMatches.length > 0 && (
          <ResultGroup label={`Environments (${envMatches.length})`}>
            {envMatches.map((env) => (
              <ResultRow
                key={`env-${env.oid}`}
                primary={env.local_id}
                onClick={() => void navigate(`/environments/${env.oid}`)}
              />
            ))}
          </ResultGroup>
        )}

        {actionMatches.length > 0 && (
          <ResultGroup label={`Actions (${actionMatches.length})`}>
            {actionMatches.map((m) => (
              <ResultRow
                key={`action-${m.actionOid}`}
                primary={m.actionName}
                secondary={m.envName}
                onClick={() => void navigate(`/actions/${m.actionOid}`)}
              />
            ))}
          </ResultGroup>
        )}

        {stateMatches.length > 0 && (
          <ResultGroup label={`States with code (${stateMatches.length})`}>
            {stateMatches.map((m) => (
              <ResultRow
                key={`state-${m.actionOid}-${m.state}`}
                primary={m.state}
                secondary={`${m.actionName} / ${m.envName}`}
                onClick={() => void navigate(`/actions/${m.actionOid}/code/${m.state}`)}
              />
            ))}
          </ResultGroup>
        )}
      </div>
    </div>
  )
}

function ResultGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border">
      <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium bg-muted/30">
        {label}
      </div>
      {children}
    </div>
  )
}

function ResultRow({
  primary,
  secondary,
  onClick,
}: {
  primary: string
  secondary?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start w-full px-3 py-1 text-xs cursor-pointer hover:bg-muted/50 text-left"
    >
      <span className="text-foreground truncate w-full">{primary}</span>
      {secondary && (
        <span className="text-[10px] text-muted-foreground truncate w-full">{secondary}</span>
      )}
    </button>
  )
}
