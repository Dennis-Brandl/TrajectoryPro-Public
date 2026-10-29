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
 * Base error class for all storage-layer errors.
 * Carries a machine-readable `code` in addition to the human-readable message.
 */
export class StorageError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'StorageError'
    this.code = code
    // Restore prototype chain (required when extending built-in Error in TS)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Thrown when a requested record does not exist.
 */
export class NotFoundError extends StorageError {
  readonly entity: string
  readonly id: string

  constructor(entity: string, id: string) {
    super('NOT_FOUND', `${entity} not found: ${id}`)
    this.name = 'NotFoundError'
    this.entity = entity
    this.id = id
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Thrown when a value fails validation constraints.
 */
export class ValidationError extends StorageError {
  readonly field: string

  constructor(field: string, message: string) {
    super('VALIDATION_ERROR', `Validation failed for '${field}': ${message}`)
    this.name = 'ValidationError'
    this.field = field
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
