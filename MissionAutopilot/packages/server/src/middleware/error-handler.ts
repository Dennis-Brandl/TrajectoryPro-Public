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

import type { ErrorRequestHandler } from 'express'
import { EngineError, InvalidStateTransitionError } from '@mission/autopilot-engine'
import { NotFoundError, ValidationError } from '@mission/autopilot-storage'
import { ZipLimitError } from '../lib/safe-zip.js'

// ============================================================
// HTTP status mapping for engine error codes
// ============================================================

const ENGINE_ERROR_STATUS_MAP: Record<string, number> = {
  ACTION_NOT_FOUND: 404,
  INSTANCE_NOT_FOUND: 404,
  INVALID_STATE_TRANSITION: 409,
  PARAMETER_VALIDATION_FAILED: 400,
  EXECUTION_ERROR: 500,
  PROPERTY_WRITE_ERROR: 500,
  INVALID_COMMAND: 422,
}

// ============================================================
// Express 4-argument error handler
// ============================================================

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // next is required as 4th param so Express recognises this as an error handler
  void next

  // InvalidStateTransitionError (subclass of EngineError) — must be checked first
  if (err instanceof InvalidStateTransitionError) {
    return void res.status(409).json({
      error: {
        code: err.code,
        message: err.message,
        details: {
          current_state: err.currentState,
          command: err.command,
        },
      },
    })
  }

  // Generic EngineError
  if (err instanceof EngineError) {
    const status = ENGINE_ERROR_STATUS_MAP[err.code] ?? 500
    return void res.status(status).json({
      error: {
        code: err.code,
        message: err.message,
        details: {},
      },
    })
  }

  // Storage NotFoundError
  if (err instanceof NotFoundError) {
    return void res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: err.message,
        details: {},
      },
    })
  }

  // Storage ValidationError
  if (err instanceof ValidationError) {
    return void res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.message,
        details: {},
      },
    })
  }

  // Zip-bomb / archive-too-large guard
  if (err instanceof ZipLimitError) {
    return void res.status(400).json({
      error: {
        code: 'ARCHIVE_TOO_LARGE',
        message: err.message,
        details: {},
      },
    })
  }

  // Unknown error — log and return generic 500
  console.error('Unhandled error:', err)
  return void res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: {},
    },
  })
}
