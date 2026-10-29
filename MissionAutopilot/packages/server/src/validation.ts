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

// ============================================================
// Strict request body validation — rejects unknown fields
// ============================================================

export interface FieldSpec {
  required?: boolean
  type?: 'string' | 'number' | 'array' | 'object'
}

type ValidationResult =
  | { valid: true; data: Record<string, unknown> }
  | { valid: false; message: string }

/**
 * Validate a request body against a schema.
 *
 * Rules:
 *  - Body must be a non-null, non-array object
 *  - Unknown fields (not in schema) are rejected immediately
 *  - Required fields must be present
 *  - Present fields must match their declared type
 */
export function validateBody(body: unknown, schema: Record<string, FieldSpec>): ValidationResult {
  // Must be a plain object
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, message: 'Request body must be a JSON object' }
  }

  const bodyObj = body as Record<string, unknown>

  // Reject unknown keys
  for (const key of Object.keys(bodyObj)) {
    if (!(key in schema)) {
      return { valid: false, message: `Unknown field: ${key}` }
    }
  }

  // Check required fields and type validity
  for (const [key, spec] of Object.entries(schema)) {
    const value = bodyObj[key]
    const isPresent = key in bodyObj && value !== undefined

    if (spec.required && !isPresent) {
      return { valid: false, message: `Missing required field: ${key}` }
    }

    if (isPresent && spec.type) {
      const typeError = checkType(key, value, spec.type)
      if (typeError) {
        return { valid: false, message: typeError }
      }
    }
  }

  return { valid: true, data: bodyObj }
}

function checkType(key: string, value: unknown, type: FieldSpec['type']): string | null {
  switch (type) {
    case 'array':
      if (!Array.isArray(value)) {
        return `Field '${key}' must be an array`
      }
      break
    case 'object':
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return `Field '${key}' must be an object`
      }
      break
    case 'string':
      if (typeof value !== 'string') {
        return `Field '${key}' must be a string`
      }
      break
    case 'number':
      if (typeof value !== 'number') {
        return `Field '${key}' must be a number`
      }
      break
  }
  return null
}
