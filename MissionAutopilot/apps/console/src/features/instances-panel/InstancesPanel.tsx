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
import { useActiveInstances } from '@/features/instances/hooks'
import { getStateColor } from '@/features/instances/InstancesPage'

export default function InstancesPanel() {
  const { data, isLoading, isError } = useActiveInstances()
  const navigate = useNavigate()

  const instances = data?.instances ?? []

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex-1">
          Instances
        </span>
        {!isLoading && !isError && (
          <span className="text-[10px] text-muted-foreground">{instances.length}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {isLoading && <p className="px-3 py-2 text-xs text-muted-foreground">Loading...</p>}
        {isError && <p className="px-3 py-2 text-xs text-destructive">Failed to load</p>}

        {!isLoading && !isError && instances.length === 0 && (
          <p className="px-3 py-3 text-xs text-muted-foreground">No active instances.</p>
        )}

        {!isLoading &&
          !isError &&
          instances.map((inst) => (
            <button
              key={inst.runtime_action_instance_id}
              type="button"
              onClick={() => void navigate(`/instances/${inst.runtime_action_instance_id}`)}
              className="flex flex-col items-start w-full px-3 py-1 text-xs cursor-pointer hover:bg-muted/50 text-left"
              title={`${inst.action_name} / ${inst.environment_name} — ${inst.state}`}
            >
              <span className="flex items-center gap-1.5 w-full">
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${getStateColor(inst.state)}`}
                />
                <span className="text-foreground truncate flex-1">{inst.action_name}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{inst.state}</span>
              </span>
              <span className="text-[10px] text-muted-foreground truncate w-full pl-3">
                {inst.environment_name}
              </span>
            </button>
          ))}
      </div>
    </div>
  )
}
