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

import type {
  DashboardResponse,
  ServerInfoResponse,
  EnvironmentsResponse,
  EnvironmentSummary,
  EnvironmentDetail,
  DeleteEnvironmentResult,
  UploadResult,
  UploadDiff,
  ActionDetail,
  DeleteActionResult,
  CodeVersionsResponse,
  CodeVersion,
  SaveCodeResult,
  ActivateVersionResult,
  DeleteVersionResult,
  ClearCodeResult,
  CodeTestResult,
  ActiveInstancesResponse,
  ActiveInstance,
  HistoryInstancesResponse,
  HistoryInstance,
  InstanceDetail,
  LogEntriesResponse,
  LogEntry,
  LogEntryDetail,
  LogConfig,
  SettingsResponse,
  SettingItem,
  UpdateSettingResult,
  LogQueryParams,
  ImportCodeResult,
  ImportSnapshotResult,
  ActionPropertySpec,
  PropertyEdit,
} from './types'

import { authedFetch } from './apiKey'
import { downloadAuthed } from './download'

const BASE = '/management/v1'

interface ApiEnvelope<T> {
  data: T
  meta: Record<string, unknown>
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authedFetch(`${BASE}${path}`, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`)
  }
  const json: ApiEnvelope<T> = await res.json()
  return json.data
}

async function apiFetchRaw<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const res = await authedFetch(`${BASE}${path}`, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<ApiEnvelope<T>>
}

export const api = {
  // ---- Server info ----
  // The REST URL this server is reachable at — used by the top bar so the
  // displayed URL is the actual REST endpoint, not the console's own URL.
  serverInfo: (): Promise<ServerInfoResponse> => apiFetch('/server-info'),

  // ---- Dashboard ----
  dashboard: (): Promise<DashboardResponse> => apiFetch('/dashboard'),

  // ---- Upload ----
  upload: async (files: File[]): Promise<UploadResult> => {
    const formData = new FormData()
    for (const file of files) {
      formData.append('files', file)
    }
    // Do NOT set Content-Type — browser sets multipart boundary automatically
    const data = await apiFetch<{ imported: UploadResult['imported']; diff: UploadDiff }>(
      '/upload',
      {
        method: 'POST',
        body: formData,
      }
    )
    return { imported: data.imported, errors: [], diff: data.diff }
  },

  // ---- Environments ----
  environments: async (): Promise<EnvironmentsResponse> => {
    const data = await apiFetch<EnvironmentSummary[]>('/environments')
    return { environments: data }
  },

  environment: (oid: string): Promise<EnvironmentDetail> => apiFetch(`/environments/${oid}`),

  deleteEnvironment: (oid: string): Promise<DeleteEnvironmentResult> =>
    apiFetch(`/environments/${oid}`, { method: 'DELETE' }),

  // ---- Actions ----
  action: (oid: string): Promise<ActionDetail> => apiFetch(`/actions/${oid}`),

  resolveSignatureChange: (oid: string) =>
    apiFetch<{ oid: string; signature_change: null }>(`/actions/${oid}/signature-change`, {
      method: 'DELETE',
    }),

  deleteAction: (oid: string): Promise<DeleteActionResult> =>
    apiFetch(`/actions/${oid}`, { method: 'DELETE' }),

  updateActionTimeout: (oid: string, timeout_seconds: number | null) =>
    apiFetch<{ oid: string; timeout_seconds: number | null }>(`/actions/${oid}/timeout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeout_seconds }),
    }),

  // ---- Action Properties (values only) ----
  updateEnvironmentProperties: (oid: string, edits: PropertyEdit[]) =>
    apiFetch<{ oid: string; action_property_specifications: ActionPropertySpec[] }>(
      `/environments/${oid}/properties`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edits }),
      }
    ),

  updateActionProperties: (oid: string, edits: PropertyEdit[]) =>
    apiFetch<{ oid: string; property_specifications: ActionPropertySpec[] }>(
      `/actions/${oid}/properties`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edits }),
      }
    ),

  // ---- Code Versions ----
  codeVersions: (actionOid: string, state: string): Promise<CodeVersionsResponse> =>
    apiFetch(`/code/${actionOid}/${state}`),

  activeCode: (actionOid: string, state: string): Promise<CodeVersion> =>
    apiFetch(`/code/${actionOid}/${state}/active`),

  codeVersion: (actionOid: string, state: string, versionId: string): Promise<CodeVersion> =>
    apiFetch(`/code/${actionOid}/${state}/${versionId}`),

  saveCode: (
    actionOid: string,
    state: string,
    code: string,
    description?: string
  ): Promise<SaveCodeResult> =>
    apiFetch(`/code/${actionOid}/${state}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_code: code, description }),
    }),

  activateVersion: (
    actionOid: string,
    state: string,
    versionId: string
  ): Promise<ActivateVersionResult> =>
    apiFetch(`/code/${actionOid}/${state}/${versionId}/activate`, { method: 'POST' }),

  deleteVersion: (
    actionOid: string,
    state: string,
    versionId: string
  ): Promise<DeleteVersionResult> =>
    apiFetch(`/code/${actionOid}/${state}/${versionId}`, { method: 'DELETE' }),

  clearCode: (actionOid: string, state: string): Promise<ClearCodeResult> =>
    apiFetch(`/code/${actionOid}/${state}`, { method: 'DELETE' }),

  testCode: (
    actionOid: string,
    state: string,
    code: string,
    inputs: Record<string, string>
  ): Promise<CodeTestResult> =>
    apiFetch(`/code/${actionOid}/${state}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_code: code, test_inputs: inputs }),
    }),

  // ---- Instances ----
  activeInstances: async (): Promise<ActiveInstancesResponse> => {
    const raw = await apiFetchRaw<ActiveInstance[]>('/instances/active')
    return { instances: raw.data, total_count: (raw.meta.total as number) ?? 0 }
  },

  historyInstances: async (params?: LogQueryParams): Promise<HistoryInstancesResponse> => {
    const query = params
      ? '?' + new URLSearchParams(params as Record<string, string>).toString()
      : ''
    const raw = await apiFetchRaw<HistoryInstance[]>(`/instances/history${query}`)
    return { instances: raw.data, total: (raw.meta.total as number) ?? 0 }
  },

  instance: (id: string): Promise<InstanceDetail> => apiFetch(`/instances/${id}`),

  instanceCommand: (id: string, command: string): Promise<void> =>
    apiFetch(`/instances/${id}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    }),

  // Force-delete an instance row regardless of its state. The server kills any
  // active worker, drops the row, and tears down the per-instance SSE bus.
  // Used to clean up instances stuck in ABORTING (or any non-terminal state)
  // that would otherwise block environment deletion.
  deleteInstance: (id: string): Promise<{ deleted: boolean; instance_id: string }> =>
    apiFetch(`/instances/${id}`, { method: 'DELETE' }),

  // ---- Execution Log ----
  logEntries: async (params?: LogQueryParams): Promise<LogEntriesResponse> => {
    const query = params
      ? '?' + new URLSearchParams(params as Record<string, string>).toString()
      : ''
    const raw = await apiFetchRaw<LogEntry[]>(`/log${query}`)
    const meta = raw.meta as {
      page?: number
      page_size?: number
      total_entries?: number
      total_pages?: number
      log_config?: LogConfig
    }
    return {
      entries: raw.data,
      pagination: {
        page: meta.page ?? 1,
        page_size: meta.page_size ?? 50,
        total_entries: meta.total_entries ?? 0,
        total_pages: meta.total_pages ?? 1,
      },
      log_config: meta.log_config ?? { max_entries: 0, current_entries: 0, oldest_entry_at: null },
    }
  },

  logEntry: (id: number): Promise<LogEntryDetail> => apiFetch(`/log/${id}`),

  // ---- Settings ----
  settings: async (): Promise<SettingsResponse> => {
    const data = await apiFetch<SettingItem[]>('/settings')
    return { settings: data }
  },

  updateSetting: (key: string, value: string): Promise<UpdateSettingResult> =>
    apiFetch(`/settings/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    }),

  // ---- Export/Import ----
  exportActionCode: (oid: string): Promise<void> =>
    downloadAuthed(`${BASE}/actions/${oid}/export`, `action-${oid}.json`),

  importActionCode: async (oid: string, file: File): Promise<ImportCodeResult> => {
    const formData = new FormData()
    formData.append('file', file)
    return apiFetch(`/actions/${oid}/import`, {
      method: 'POST',
      body: formData,
    })
  },

  exportEnvironmentBundle: async (oid: string): Promise<Blob> => {
    const res = await authedFetch(`${BASE}/environments/${oid}/export-bundle`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
      throw new Error(err?.error?.message ?? `HTTP ${res.status}`)
    }
    return res.blob()
  },

  exportEnvironmentEnvirX: async (oid: string): Promise<Blob> => {
    const res = await authedFetch(`${BASE}/environments/${oid}/export-envir-x`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(
        (body as { error?: { message?: string } }).error?.message ??
          `Export failed: HTTP ${res.status}`
      )
    }
    return res.blob()
  },

  exportSnapshot: (): Promise<void> =>
    downloadAuthed(`${BASE}/snapshot/export`, 'mission-autopilot.WFsnapshot'),

  importSnapshot: async (file: File): Promise<ImportSnapshotResult> => {
    const formData = new FormData()
    formData.append('file', file)
    return apiFetch(`/snapshot/import?confirm=true`, {
      method: 'POST',
      body: formData,
    })
  },
}
