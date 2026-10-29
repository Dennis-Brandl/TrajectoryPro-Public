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
import type { SseManager, SseEvent } from '../sse-manager.js'
import { formatSseEvent } from '../sse-utils.js'
import { validateBody } from '../validation.js'

// ============================================================
// Constants
// ============================================================

const VALID_COMMANDS = new Set(['PAUSE', 'RESUME', 'HOLD', 'UNHOLD', 'ABORT', 'STOP', 'CLEAR'])

// ============================================================
// Commands router factory
// ============================================================

/**
 * createCommandsRouter — Express Router with command and SSE streaming endpoints.
 *
 * Endpoints:
 *   POST /instances/:id/command   — REST-05: send state command to instance
 *   GET  /instances/:id/events    — REST-06/07: SSE event stream with Last-Event-ID reconnection
 */
export function createCommandsRouter(manager: InstanceManager, sseManager: SseManager): Router {
  const router = Router()

  // --------------------------------------------------------
  // REST-05: POST /instances/:id/command
  // --------------------------------------------------------
  router.post('/instances/:id/command', async (req, res, next) => {
    const instanceId = req.params.id as string
    // Validate body — only 'command' field allowed
    const validationResult = validateBody(req.body, {
      command: { required: true, type: 'string' },
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

    const { command } = validationResult.data as { command: string }

    // Validate the command value itself
    if (!VALID_COMMANDS.has(command)) {
      res.status(422).json({
        error: {
          code: 'INVALID_COMMAND',
          message: `Unknown command: ${command}`,
          details: { command },
        },
      })
      return
    }

    try {
      // Check instance exists
      const instance = await manager.getInstance(instanceId)
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

      await manager.sendCommand(instanceId, command)

      res.status(200).json({
        data: {
          instance_id: instanceId,
          command,
          accepted: true,
        },
        meta: {},
      })
    } catch (err) {
      next(err)
    }
  })

  // --------------------------------------------------------
  // REST-06/07: GET /instances/:id/events (SSE)
  // --------------------------------------------------------
  router.get('/instances/:id/events', async (req, res, next) => {
    try {
      const instanceId = req.params.id as string

      // Check instance exists
      const instance = await manager.getInstance(instanceId)
      if (!instance) {
        return void res.status(404).json({
          error: {
            code: 'INSTANCE_NOT_FOUND',
            message: 'Instance not found',
            details: {},
          },
        })
      }

      // Set SSE headers and flush immediately
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.flushHeaders()

      // Replay missed events from ring buffer if Last-Event-ID provided. Default
      // to -1 (not 0) with a NaN guard: a first connect has no Last-Event-ID
      // header, and defaulting to 0 would skip the first buffered event (id 0).
      const lastEventIdHeader = req.headers['last-event-id']
      const lastEventId = lastEventIdHeader ? Number(lastEventIdHeader) : -1
      if (!Number.isNaN(lastEventId)) {
        for (const event of sseManager.getEventsSince(instanceId, lastEventId)) {
          if (!res.writableEnded) {
            res.write(formatSseEvent(event))
          }
        }
      }

      // Subscribe to new events. onDestroy ends the response when the bus is
      // torn down (SseManager.destroyInstanceBus / shutdown) so a client that
      // never disconnects doesn't leave the response hanging open.
      const unsubscribe = sseManager.subscribe(
        instanceId,
        (event: SseEvent) => {
          if (!res.writableEnded) {
            res.write(formatSseEvent(event))
          }
        },
        () => {
          if (!res.writableEnded) res.end()
        }
      )

      // Clean up on client disconnect
      req.on('close', () => {
        unsubscribe()
      })
    } catch (err) {
      next(err)
    }
  })

  return router
}
