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
import { Button, Tabs, TabsList, TabsTrigger, TabsContent } from '@mission/ui'
import { AccountsTab } from '@/components/admin/AccountsTab'
import { LibraryAdminTab } from '@/components/admin/LibraryAdminTab'
import { DatabaseTab } from '@/components/admin/DatabaseTab'
import { CleanupTab } from '@/components/admin/CleanupTab'
import { TeamsTab } from '@/components/admin/TeamsTab'
import { RolesTab } from '@/components/admin/RolesTab'
import { ESignatureRolesTab } from '@/components/admin/ESignatureRolesTab'
import { HeaderTools } from '@/components/shell/HeaderTools'

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

export function AdminPage() {
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
    <div className="h-full w-full flex flex-col bg-side-panel text-foreground">
      <HeaderTools>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => navigate({ to: '/' })}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <h1 className="shrink-0 text-sm font-semibold text-foreground">Administration</h1>
      </HeaderTools>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabKey)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        {/* Tab bar */}
        <TabsList className="h-auto w-full shrink-0 justify-start overflow-x-auto">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Tab content */}
        <TabsContent value={activeTab} className="mt-0 flex-1 overflow-y-auto p-6">
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
        </TabsContent>
      </Tabs>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/admin')({
  component: AdminPage,
})
