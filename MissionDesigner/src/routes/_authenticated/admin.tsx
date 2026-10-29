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

import { createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@mission/ui'
import { AccountsTab } from '@/components/admin/AccountsTab'
import { LibraryAdminTab } from '@/components/admin/LibraryAdminTab'
import { DatabaseTab } from '@/components/admin/DatabaseTab'
import { CleanupTab } from '@/components/admin/CleanupTab'
import { TeamsTab } from '@/components/admin/TeamsTab'
import { RolesTab } from '@/components/admin/RolesTab'
import { ESignatureRolesTab } from '@/components/admin/ESignatureRolesTab'
import { useTheme } from '@/hooks/useTheme'

const authenticatedRoute = getRouteApi('/_authenticated')

const TABS = [
  { key: 'accounts', label: 'Accounts' },
  { key: 'teams', label: 'Teams' },
  { key: 'roles', label: 'Roles' },
  { key: 'esignature', label: 'E-Signature Roles' },
  { key: 'action', label: 'Action Libraries' },
  { key: 'environment', label: 'Environment Libraries' },
  { key: 'step', label: 'Step Libraries' },
  { key: 'workflow', label: 'Workflows' },
  { key: 'database', label: 'Database' },
  { key: 'cleanup', label: 'Cleanup' },
] as const

type TabKey = (typeof TABS)[number]['key']

function AdminPage() {
  useTheme()
  const navigate = useNavigate()
  const { user } = authenticatedRoute.useRouteContext()
  const isAdmin = (user as { isAdministrator?: boolean })?.isAdministrator === true
  const [activeTab, setActiveTab] = useState<TabKey>('accounts')

  // Redirect non-admin users
  useEffect(() => {
    if (!isAdmin) {
      navigate({ to: '/' })
    }
  }, [isAdmin, navigate])

  if (!isAdmin) return null

  return (
    <div className="h-full w-full flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top bar */}
      <div className="h-12 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex items-center px-4 gap-3 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/' })}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Administration</h1>
      </div>

      {/* Tab bar */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 flex gap-1 shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
              activeTab === tab.key
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {tab.label}
            {activeTab === tab.key && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">
          {activeTab === 'accounts' && <AccountsTab currentUserId={(user as { id: string }).id} />}
          {activeTab === 'teams' && <TeamsTab />}
          {activeTab === 'roles' && <RolesTab />}
          {activeTab === 'esignature' && <ESignatureRolesTab />}
          {activeTab === 'action' && <LibraryAdminTab entityType="action" />}
          {activeTab === 'environment' && <LibraryAdminTab entityType="environment" />}
          {activeTab === 'step' && <LibraryAdminTab entityType="step" />}
          {activeTab === 'workflow' && <LibraryAdminTab entityType="workflow" />}
          {activeTab === 'database' && <DatabaseTab />}
          {activeTab === 'cleanup' && <CleanupTab />}
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/admin')({
  component: AdminPage,
})
