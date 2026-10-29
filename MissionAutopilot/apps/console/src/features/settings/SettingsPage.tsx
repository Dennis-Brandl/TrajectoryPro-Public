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

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@mission/ui'
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import { Separator } from '@/components/ui/separator'
import { useSettings, useUpdateSetting } from './hooks'
import { SnapshotSection } from './SnapshotSection'
import { useDashboard } from '@/features/dashboard/hooks'
import { formatUptime } from '@/lib/utils'

// Default values per spec
const DEFAULTS: Record<string, string> = {
  log_max_size: '10000',
  python_pool_size: '4',
  execution_timeout_ms: '60000',
  instance_retention_hours: '24',
}

// Keys that should display in seconds (stored as ms in DB)
const MS_TO_SECONDS_KEYS = new Set(['execution_timeout_ms'])

// Human-readable labels
const SETTING_LABELS: Record<string, { label: string; description: string; unit?: string }> = {
  log_max_size: {
    label: 'Max Log Entries',
    description: 'Maximum number of execution log entries to retain',
  },
  python_pool_size: {
    label: 'Python Pool Size',
    description: 'Number of Python worker processes in the pool',
  },
  execution_timeout_ms: {
    label: 'Execution Timeout',
    description: 'Maximum time allowed for code execution per state. 0 = no timeout.',
    unit: 'seconds (0 = disabled)',
  },
  instance_retention_hours: {
    label: 'Instance Retention',
    description: 'How long to keep completed instance records',
    unit: 'hours',
  },
  api_key: {
    label: 'API Key',
    description:
      'Every REST and management API call requires this key (sent as the X-API-Key header). It is read from the .env file and cannot be changed here.',
  },
}

// ---- Section group component ----
function SettingField({
  settingKey,
  value,
  onChange,
  type = 'number',
  hint,
}: {
  settingKey: string
  value: string
  onChange: (key: string, value: string) => void
  type?: string
  hint?: string
}) {
  const meta = SETTING_LABELS[settingKey]
  if (!meta) return null

  return (
    <div className="space-y-1.5">
      <Label htmlFor={settingKey} className="text-sm font-medium">
        {meta.label}
        {meta.unit && (
          <span className="ml-1.5 text-xs text-muted-foreground font-normal">({meta.unit})</span>
        )}
      </Label>
      <Input
        id={settingKey}
        type={type}
        value={value}
        onChange={(e) => onChange(settingKey, e.target.value)}
        className="max-w-xs"
        autoComplete="off"
      />
      <p className="text-xs text-muted-foreground">{hint ?? meta.description}</p>
    </div>
  )
}

export default function SettingsPage() {
  const { data: settingsData, isLoading: settingsLoading, isError: settingsError } = useSettings()
  const { data: dashboardData } = useDashboard()
  const updateSetting = useUpdateSetting()

  // Local form state for each setting key
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  // Initialize form from loaded settings
  useEffect(() => {
    if (settingsData) {
      const values: Record<string, string> = {}
      for (const item of settingsData.settings) {
        if (MS_TO_SECONDS_KEYS.has(item.key)) {
          values[item.key] = String(Math.round(Number(item.value) / 1000))
        } else {
          values[item.key] = item.value
        }
      }
      setFormValues(values)
    }
  }, [settingsData])

  const isDirty = settingsData
    ? settingsData.settings.some((item) => {
        const displayValue = MS_TO_SECONDS_KEYS.has(item.key)
          ? String(Math.round(Number(item.value) / 1000))
          : item.value
        return formValues[item.key] !== displayValue
      })
    : false

  const handleFieldChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }))
    setSaveSuccess(false)
    setSaveError(null)
  }

  const handleSave = async () => {
    if (!settingsData) return
    setSaveError(null)
    setSaveSuccess(false)

    // Find changed fields (compare display values)
    const changedFields = settingsData.settings.filter((item) => {
      const displayValue = MS_TO_SECONDS_KEYS.has(item.key)
        ? String(Math.round(Number(item.value) / 1000))
        : item.value
      return formValues[item.key] !== displayValue
    })

    try {
      for (const item of changedFields) {
        let valueToSend = formValues[item.key] ?? item.value
        if (MS_TO_SECONDS_KEYS.has(item.key)) {
          valueToSend = String(Number(valueToSend) * 1000)
        }
        await updateSetting.mutateAsync({ key: item.key, value: valueToSend })
      }
      setSaveSuccess(true)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings')
    }
  }

  const handleResetToDefaults = async () => {
    setSaveError(null)
    setSaveSuccess(false)
    setConfirmReset(false)

    try {
      for (const [key, value] of Object.entries(DEFAULTS)) {
        await updateSetting.mutateAsync({ key, value })
      }
      setSaveSuccess(true)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to reset settings')
    }
  }

  if (settingsLoading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-foreground">Settings</h2>
        <Card>
          <CardContent className="pt-6 space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-1">
                <div className="h-4 bg-muted rounded animate-pulse w-32" />
                <div className="h-9 bg-muted rounded animate-pulse w-64" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (settingsError) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-foreground">Settings</h2>
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive font-medium">Failed to load settings</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-2xl font-bold text-foreground">Settings</h2>

      {/* Settings Form */}
      <Card>
        <CardHeader>
          <CardTitle>Execution Log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingField
            settingKey="log_max_size"
            value={formValues['log_max_size'] ?? ''}
            onChange={handleFieldChange}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Python Execution</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingField
            settingKey="python_pool_size"
            value={formValues['python_pool_size'] ?? ''}
            onChange={handleFieldChange}
          />
          <Separator />
          <SettingField
            settingKey="execution_timeout_ms"
            value={formValues['execution_timeout_ms'] ?? ''}
            onChange={handleFieldChange}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Instance Retention</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingField
            settingKey="instance_retention_hours"
            value={formValues['instance_retention_hours'] ?? ''}
            onChange={handleFieldChange}
          />
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">{SETTING_LABELS.api_key.label}</Label>
            <p className="text-sm text-foreground">Set in .env (ACTIONS_API_KEY)</p>
            <p className="text-xs text-muted-foreground">{SETTING_LABELS.api_key.description}</p>
          </div>
        </CardContent>
      </Card>

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <Button onClick={() => void handleSave()} disabled={!isDirty || updateSetting.isPending}>
          {updateSetting.isPending ? 'Saving...' : 'Save Changes'}
        </Button>

        {!confirmReset ? (
          <Button variant="outline" onClick={() => setConfirmReset(true)}>
            Reset to Defaults
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Reset all settings to defaults?</span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleResetToDefaults()}
              disabled={updateSetting.isPending}
            >
              Confirm Reset
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>

      {saveSuccess && (
        <p className="text-sm text-green-600 font-medium">Settings saved successfully.</p>
      )}
      {saveError && <p className="text-sm text-destructive">{saveError}</p>}

      {/* Container Snapshot */}
      <SnapshotSection />

      {/* Container Info (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle>Container Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {dashboardData ? (
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  Version
                </p>
                <p className="font-mono text-sm">{dashboardData.container.node_version}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  Uptime
                </p>
                <p className="text-sm">{formatUptime(dashboardData.container.uptime_seconds)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  Started At
                </p>
                <p className="text-sm font-mono text-xs">
                  {new Date(dashboardData.container.started_at).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  Python Pool
                </p>
                <p className="text-sm">
                  {dashboardData.python_pool.idle}/{dashboardData.python_pool.size} workers idle
                </p>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Loading container info...</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
