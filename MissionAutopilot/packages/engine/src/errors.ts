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

/**
 * Base error class for all engine-layer errors.
 * Carries a machine-readable `code` in addition to the human-readable message.
 */
export class EngineError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    // Restore prototype chain (required when extending built-in Error in TS)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Thrown when a state command is not valid for the instance's current state.
 * Maps to HTTP 409 INVALID_STATE_TRANSITION.
 */
export class InvalidStateTransitionError extends EngineError {
  readonly currentState: string
  readonly command: string

  constructor(currentState: string, command: string) {
    super(
      'INVALID_STATE_TRANSITION',
      `Command '${command}' is not valid in state '${currentState}'`
    )
    this.name = 'InvalidStateTransitionError'
    this.currentState = currentState
    this.command = command
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Thrown when the Python sidecar reports a property write failure.
 * EngineError code: 'PROPERTY_WRITE_ERROR'. Maps to HTTP 500 in the error handler.
 * Raised by PythonWorkerPool when SidecarResponse.error_type === 'PROPERTY_WRITE_ERROR'.
 */
export class PropertyWriteError extends EngineError {
  constructor(message: string) {
    super('PROPERTY_WRITE_ERROR', message)
    this.name = 'PropertyWriteError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Thrown when Python code execution fails (runtime error, timeout, worker crash, etc.).
 * The errorType field carries one of: SYNTAX_ERROR, RUNTIME_ERROR, TIMEOUT, WORKER_CRASH.
 */
export class ExecutionError extends EngineError {
  readonly errorType?: string

  constructor(message: string, cause?: Error, errorType?: string) {
    super('EXECUTION_ERROR', message)
    this.name = 'ExecutionError'
    this.errorType = errorType
    if (cause) {
      this.cause = cause
    }
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
