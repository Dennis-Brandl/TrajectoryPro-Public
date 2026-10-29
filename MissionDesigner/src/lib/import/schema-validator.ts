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

import Ajv, { type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import managedElementSchema from '@/lib/schemas/managed-element.json'
import formDocumentSchema from '@/lib/schemas/form-document.json'
import actionLibrarySchema from '@/lib/schemas/master-action-library.json'
import environmentLibrarySchema from '@/lib/schemas/master-environment-library.json'
import stepLibrarySchema from '@/lib/schemas/master-workflow-step-library.json'
import workflowLibrarySchema from '@/lib/schemas/master-workflow-library.json'
import type {
  MasterActionLibrary,
  MasterEnvironmentLibrary,
  MasterWorkflowStepLibrary,
  MasterWorkflowLibrary,
  MasterWorkflowSpecification,
} from '@/lib/packageFormat/export-types'

// =============================================================================
// AJV Instance Setup
// =============================================================================

/**
 * AJV instance configured for Trajectory schema validation.
 * allErrors: true ensures all validation errors are reported, not just the first.
 */
const ajv = new Ajv({ allErrors: true })

// Add format validators (uuid, date-time, etc.)
addFormats(ajv)

// Add base schema as a reference for $ref resolution
ajv.addSchema(managedElementSchema, 'managed-element.json')

// Registered under its $id (https://trajectorypro.io/schemas/form-document.json) so the
// workflow schema's relative $ref "form-document.json" resolves against its own $id base.
ajv.addSchema(formDocumentSchema)

// Compile validators for each library type
const validateActionLibrarySchema = ajv.compile(actionLibrarySchema)
const validateEnvironmentLibrarySchema = ajv.compile(environmentLibrarySchema)
const validateStepLibrarySchema = ajv.compile(stepLibrarySchema)
const validateWorkflowLibrarySchema = ajv.compile(workflowLibrarySchema)

// =============================================================================
// Validation Result Types
// =============================================================================

/**
 * Successful validation result with typed data.
 */
export interface ValidationSuccess<T> {
  success: true
  data: T
}

/**
 * Failed validation result with error messages.
 */
export interface ValidationFailure {
  success: false
  errors: string[]
}

/**
 * Union type for validation results.
 */
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure

// =============================================================================
// Generic Validation Helper
// =============================================================================

/**
 * Validates data against a compiled AJV schema.
 * @param data - The data to validate
 * @param validate - The compiled AJV validation function
 * @returns Validation result with typed data on success or error messages on failure
 */
export function validateWithSchema<T>(data: unknown, validate: ValidateFunction): ValidationResult<T> {
  const valid = validate(data)

  if (valid) {
    return {
      success: true,
      data: data as T,
    }
  }

  // Format error messages from AJV errors
  const errors = validate.errors?.map((err) => {
    const path = err.instancePath || '/'
    const message = err.message || 'Unknown validation error'
    return `${path}: ${message}`
  }) ?? ['Unknown validation error']

  return {
    success: false,
    errors,
  }
}

// =============================================================================
// Type-Specific Validators
// =============================================================================

/**
 * Validates data as a Master Action Library.
 * @param data - The data to validate
 * @returns Validation result with MasterActionLibrary on success
 */
export function validateActionLibrary(data: unknown): ValidationResult<MasterActionLibrary> {
  return validateWithSchema<MasterActionLibrary>(data, validateActionLibrarySchema)
}

/**
 * Validates data as a Master Environment Library.
 * @param data - The data to validate
 * @returns Validation result with MasterEnvironmentLibrary on success
 */
export function validateEnvironmentLibrary(data: unknown): ValidationResult<MasterEnvironmentLibrary> {
  return validateWithSchema<MasterEnvironmentLibrary>(data, validateEnvironmentLibrarySchema)
}

/**
 * Validates data as a Master Workflow Step Library.
 * @param data - The data to validate
 * @returns Validation result with MasterWorkflowStepLibrary on success
 */
export function validateStepLibrary(data: unknown): ValidationResult<MasterWorkflowStepLibrary> {
  return validateWithSchema<MasterWorkflowStepLibrary>(data, validateStepLibrarySchema)
}

/**
 * Validates data as a Master Workflow Library.
 * @param data - The data to validate
 * @returns Validation result with MasterWorkflowLibrary on success
 */
export function validateWorkflowLibrary(data: unknown): ValidationResult<MasterWorkflowLibrary> {
  return validateWithSchema<MasterWorkflowLibrary>(data, validateWorkflowLibrarySchema)
}

/**
 * Validates data as a Master Workflow Specification (single workflow).
 * Uses the workflow library schema's workflow_specifications item schema.
 * @param data - The data to validate
 * @returns Validation result with MasterWorkflowSpecification on success
 */
export function validateWorkflowSpecification(data: unknown): ValidationResult<MasterWorkflowSpecification> {
  // For individual workflow specs, we check required fields manually
  // since the schema is for the library container
  if (typeof data !== 'object' || data === null) {
    return {
      success: false,
      errors: ['Data must be an object'],
    }
  }

  const obj = data as Record<string, unknown>

  // Check required fields for a workflow specification
  const requiredFields = ['local_id', 'oid', 'version', 'last_modified_date', 'steps', 'connections']
  const missingFields = requiredFields.filter((field) => !(field in obj))

  if (missingFields.length > 0) {
    return {
      success: false,
      errors: missingFields.map((field) => `Missing required field: ${field}`),
    }
  }

  // Check steps is an array
  if (!Array.isArray(obj.steps)) {
    return {
      success: false,
      errors: ['steps must be an array'],
    }
  }

  // Check connections is an array
  if (!Array.isArray(obj.connections)) {
    return {
      success: false,
      errors: ['connections must be an array'],
    }
  }

  return {
    success: true,
    data: data as MasterWorkflowSpecification,
  }
}
