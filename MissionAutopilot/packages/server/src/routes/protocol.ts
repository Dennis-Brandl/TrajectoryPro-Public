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

import { Router } from 'express'
import type { InstanceManager } from '@mission/autopilot-engine'
import type {
  ActionRepository,
  EnvironmentRepository,
  InstanceRepository,
  SettingsRepository,
  Instance,
} from '@mission/autopilot-storage'
import type { SseManager } from '../sse-manager.js'
import { formatSseEvent } from '../sse-utils.js'
import { validateBody } from '../validation.js'

// ============================================================
// Response shape helper
// ============================================================

// ============================================================
// Parameter-spec normalization (REST-02)
// ============================================================
//
// Stored `input_parameter_specifications` / `output_parameter_specifications`
// have heterogeneous shapes inherited from Trajectory MD's evolving data model:
//   - canonical (DataModelSpec.md): { id, default_value, value_type, json_schema?, description? }
//   - legacy:                       { name, data_type, default_value }
//   - property-typed:               { id, oid, default_value, description, entries }
//
// The REST protocol (RESTProtocolSpec.md § 2.2) requires a single canonical
// wire shape: { name, description?, default_value?, json_schema? }. This
// helper maps any of the stored shapes onto that contract so workflow clients
// (the tester, Trajectory Mobile, etc.) see a stable surface.

interface NormalizedParameterSpec {
  name: string
  description?: string
  default_value?: string
  json_schema?: string | null
}

function normalizeParameterSpec(raw: unknown): NormalizedParameterSpec {
  if (raw === null || typeof raw !== 'object') {
    return { name: '<invalid>' }
  }
  const p = raw as Record<string, unknown>

  const name =
    typeof p.id === 'string' && p.id.length > 0
      ? p.id
      : typeof p.name === 'string' && p.name.length > 0
        ? p.name
        : '<unnamed>'

  const result: NormalizedParameterSpec = { name }
  if (typeof p.description === 'string') result.description = p.description
  if (typeof p.default_value === 'string') result.default_value = p.default_value
  if (p.json_schema === null || typeof p.json_schema === 'string') {
    result.json_schema = p.json_schema
  }
  return result
}

function formatInstanceResponse(instance: Instance) {
  const history = instance.state_history as Array<{ state: string; timestamp: string }>
  const current = history[history.length - 1]
  const previous = history.length >= 2 ? history[history.length - 2] : null

  return {
    instance_id: instance.runtime_action_instance_id,
    action_oid: instance.action_oid,
    environment_oid: instance.environment_oid,
    workflow_instance_id: instance.workflow_instance_id,
    step_instance_id: instance.step_instance_id,
    step_oid: instance.step_oid,
    visibility: instance.visibility,
    state: {
      current: instance.state,
      previous: previous?.state ?? null,
      entered_at: current?.timestamp ?? instance.created_at,
    },
    inputs: instance.input_parameters,
    outputs: instance.output_parameters,
    created_at: instance.created_at,
    started_at: instance.started_at,
    completed_at: instance.completed_at,
    error: instance.error,
  }
}

// ============================================================
// Protocol router factory
// ============================================================

/**
 * createProtocolRouter — Express Router with all /trajectory/v1/ endpoints.
 *
 * Endpoints:
 *   GET  /health                       — REST-01
 *   GET  /capabilities                 — REST-02
 *   POST /actions/:action_oid/invoke   — REST-03
 *   GET  /instances/:id                — REST-04
 *   GET  /instances                    — REST-08
 *   DELETE /instances/:id              — REST-09
 *   GET  /properties                   — REST-10
 *   GET  /properties/:id               — REST-11
 *   GET  /properties/:id/events        — REST-12 (SSE stream)
 */
export function createProtocolRouter(
  manager: InstanceManager,
  actionRepo: ActionRepository,
  instanceRepo: InstanceRepository,
  _settingsRepo: SettingsRepository,
  sseManager: SseManager,
  environmentRepo: EnvironmentRepository
): Router {
  // _settingsRepo reserved for plan 05-02 (expose_traceback)
  void _settingsRepo

  const router = Router()

  // --------------------------------------------------------
  // REST-01: GET /health
  // --------------------------------------------------------
  router.get('/health', (_req, res) => {
    res.status(200).json({
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        pool: manager.poolStatus,
      },
      meta: {},
    })
  })

  // --------------------------------------------------------
  // REST-02: GET /capabilities
  // --------------------------------------------------------
  router.get('/capabilities', async (_req, res, next) => {
    try {
      const envs = await environmentRepo.findAll()
      const allActions = await actionRepo.findAll()

      const data = envs.map((env) => {
        const actions = allActions.filter((a) => a.environment_oid === env.oid)
        return {
          environment_oid: env.oid,
          environment_name: env.local_id,
          environment_state: env.state ?? 'Draft',
          action_properties: (
            env.action_property_specifications as Array<Record<string, unknown>>
          ).map((p) => ({
            name: p.name,
            oid: p.oid,
            description: p.description,
            entries: (p.entries as unknown[]) ?? [],
          })),
          actions: actions.map((action) => ({
            action_oid: action.oid,
            action_name: action.local_id,
            action_state: action.state ?? 'Draft',
            local_id: action.local_id,
            version: action.version,
            description: action.description,
            visibility: action.action_visibility,
            input_parameters: (action.input_parameter_specifications as unknown[]).map(
              normalizeParameterSpec
            ),
            output_parameters: (action.output_parameter_specifications as unknown[]).map(
              normalizeParameterSpec
            ),
            supported_commands:
              action.action_visibility === 'observable'
                ? ['PAUSE', 'RESUME', 'HOLD', 'UNHOLD', 'ABORT', 'STOP', 'CLEAR']
                : ['ABORT'],
          })),
        }
      })

      res.status(200).json({
        data: { environments: data },
        meta: {
          total_environments: data.length,
          total_actions: data.reduce((n, e) => n + e.actions.length, 0),
        },
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // REST-03: POST /actions/:action_oid/invoke
  // --------------------------------------------------------
  router.post('/actions/:action_oid/invoke', async (req, res, next) => {
    const validationResult = validateBody(req.body, {
      environment_oid: { required: true, type: 'string' },
      workflow_instance_id: { required: true, type: 'string' },
      step_instance_id: { required: true, type: 'string' },
      step_oid: { required: true, type: 'string' },
      input_parameters: { required: true, type: 'array' },
      timeout_ms: { required: false, type: 'number' },
      // Test/dev affordance — see InvokeRequest in @mission/autopilot-engine.
      action_property_overrides: { required: false, type: 'object' },
    })

    if (!validationResult.valid) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: validationResult.message,
          details: {},
        },
      })
      return
    }

    const body = validationResult.data

    try {
      const result = await manager.invoke({
        action_oid: req.params.action_oid,
        workflow_instance_id: body.workflow_instance_id as string,
        step_instance_id: body.step_instance_id as string,
        step_oid: body.step_oid as string,
        input_parameters: body.input_parameters as Array<{ name: string; value: string }>,
        ...(body.timeout_ms !== undefined && { timeout_ms: body.timeout_ms as number }),
        ...(body.action_property_overrides !== undefined && {
          action_property_overrides: body.action_property_overrides as Record<
            string,
            Record<string, string>
          >,
        }),
      })

      res.status(201).json({
        data: {
          instance_id: result.runtime_action_instance_id,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // REST-04: GET /instances/:id
  // --------------------------------------------------------
  router.get('/instances/:id', async (req, res, next) => {
    try {
      const instance = await manager.getInstance(req.params.id)

      if (!instance) {
        res.status(404).json({
          error: {
            code: 'INSTANCE_NOT_FOUND',
            message: 'Instance not found',
            details: {},
          },
        })
        return
      }

      res.status(200).json({
        data: formatInstanceResponse(instance),
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // REST-08: GET /instances
  // --------------------------------------------------------
  router.get('/instances', async (req, res, next) => {
    try {
      const { workflow_instance_id, status, action_oid } = req.query as Record<string, string>

      let instances: Instance[]

      if (workflow_instance_id) {
        instances = await instanceRepo.findByWorkflow(workflow_instance_id)
        // Secondary filter by action_oid if both provided
        if (action_oid) {
          instances = instances.filter((i) => i.action_oid === action_oid)
        }
      } else if (action_oid) {
        instances = await instanceRepo.findByAction(action_oid)
      } else if (status === 'active') {
        instances = await instanceRepo.findActive()
      } else if (status) {
        instances = await instanceRepo.findByStatus(status)
      } else {
        instances = await instanceRepo.findAll(100)
      }

      const data = instances.map(formatInstanceResponse)

      res.status(200).json({
        data,
        meta: { total: data.length },
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // REST-10: GET /properties — list property specs across all envs
  // --------------------------------------------------------
  router.get('/properties', async (_req, res, next) => {
    try {
      const envs = await environmentRepo.findAll()
      const data = envs.map((env) => ({
        environment_oid: env.oid,
        environment_name: env.local_id,
        properties: (env.action_property_specifications as Array<Record<string, unknown>>).map(
          (p) => ({
            name: p.name,
            oid: p.oid,
            description: p.description,
            entries: (p.entries as unknown[]) ?? [],
          })
        ),
      }))
      res.status(200).json({
        data: { environments: data },
        meta: {
          total_environments: data.length,
          total_properties: data.reduce((n, e) => n + e.properties.length, 0),
        },
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // REST-11: GET /properties/:id — single property by outer name
  // --------------------------------------------------------
  router.get('/properties/:id', async (req, res, next) => {
    try {
      const propertyName = req.params.id
      const envOidFilter = (req.query.environment_oid as string | undefined) ?? undefined
      const envs = await environmentRepo.findAll()
      const matches: Array<{
        env: (typeof envs)[number]
        spec: Record<string, unknown>
      }> = []
      for (const env of envs) {
        if (envOidFilter && env.oid !== envOidFilter) continue
        const spec = (env.action_property_specifications as Array<Record<string, unknown>>).find(
          (p) => p.name === propertyName
        )
        if (spec) matches.push({ env, spec })
      }
      if (matches.length === 0) {
        res.status(404).json({
          error: {
            code: 'PROPERTY_NOT_FOUND',
            message: `Property '${propertyName}' not found`,
            details: {},
          },
        })
        return
      }
      if (matches.length > 1) {
        res.status(409).json({
          error: {
            code: 'AMBIGUOUS_PROPERTY',
            message: `Property '${propertyName}' found in ${matches.length} environments`,
            details: { environment_oids: matches.map((m) => m.env.oid) },
          },
        })
        return
      }
      const { env, spec } = matches[0]
      res.status(200).json({
        data: {
          environment_oid: env.oid,
          environment_name: env.local_id,
          name: spec.name,
          oid: spec.oid,
          description: spec.description,
          entries: (spec.entries as unknown[]) ?? [],
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // REST-12: GET /properties/:id/events (SSE)
  // --------------------------------------------------------
  router.get('/properties/:id/events', async (req, res, next) => {
    try {
      const propertyName = req.params.id
      const envOidFilter = (req.query.environment_oid as string | undefined) ?? undefined

      // Resolve target env
      const envs = await environmentRepo.findAll()
      const matches: Array<(typeof envs)[number]> = []
      for (const env of envs) {
        if (envOidFilter && env.oid !== envOidFilter) continue
        const spec = (env.action_property_specifications as Array<Record<string, unknown>>).find(
          (p) => p.name === propertyName
        )
        if (spec) matches.push(env)
      }
      if (matches.length === 0) {
        res.status(404).json({
          error: {
            code: 'PROPERTY_NOT_FOUND',
            message: `Property '${propertyName}' not found`,
            details: {},
          },
        })
        return
      }
      if (matches.length > 1) {
        res.status(409).json({
          error: {
            code: 'AMBIGUOUS_PROPERTY',
            message: `Property '${propertyName}' found in ${matches.length} environments`,
            details: { environment_oids: matches.map((e) => e.oid) },
          },
        })
        return
      }
      const env = matches[0]

      // Set SSE headers and flush immediately
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.flushHeaders()

      // Replay buffered events if Last-Event-ID present
      const lastEventIdHeader = req.headers['last-event-id']
      const lastEventId = lastEventIdHeader ? Number(lastEventIdHeader) : -1
      if (!Number.isNaN(lastEventId) && lastEventId >= 0) {
        for (const ev of sseManager.getPropertyEventsSince(env.oid, propertyName, lastEventId)) {
          if (!res.writableEnded) {
            res.write(formatSseEvent(ev))
          }
        }
      }

      // Subscribe live. onDestroy ends the response when the property bus is
      // torn down (SseManager.destroyPropertyBuses / shutdown) so a client
      // that never disconnects doesn't leave the response hanging open.
      const unsub = sseManager.subscribeProperty(
        env.oid,
        propertyName,
        (ev) => {
          if (!res.writableEnded) {
            res.write(formatSseEvent(ev))
          }
        },
        () => {
          if (!res.writableEnded) res.end()
        }
      )

      req.on('close', unsub)
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // REST-09: DELETE /instances/:id
  // --------------------------------------------------------
  router.delete('/instances/:id', async (req, res, next) => {
    try {
      const instance = await manager.getInstance(req.params.id)

      if (!instance) {
        res.status(404).json({
          error: {
            code: 'INSTANCE_NOT_FOUND',
            message: 'Instance not found',
            details: {},
          },
        })
        return
      }

      await manager.cancelInstance(req.params.id)

      res.status(200).json({
        data: {
          instance_id: req.params.id,
          cancelled: true,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  return router
}
