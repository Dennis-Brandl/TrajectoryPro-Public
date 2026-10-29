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

// Audit item 3: zod schemas for the optional step-config fields that
// transformWorkflowSpec used to reach with blind double-casts
// ((step as unknown as Record<string, unknown>).script_config as {...}).
// Shapes mirror the runtime package format (src/lib/packageFormat/export-types.ts).
// Parsing is deliberately TOLERANT of extra fields (loose objects) — the closed
// part is the TYPES of the fields the importer actually consumes.

import { z, type ZodType } from 'zod'

export const scriptConfigSchema = z.looseObject({
  language: z.string().optional(),
  source: z.string().optional(),
  repeat: z
    .looseObject({
      cycle_seconds: z.number().optional(),
      time_limit_seconds: z.number().optional(),
      on_time_limit: z.string().optional(),
    })
    .optional(),
})

export const gateConfigSchema = z.looseObject({
  cycle_seconds: z.number().optional(),
  language: z.string().optional(),
  source: z.string().optional(),
  control_previous_action: z.boolean().optional(),
  mode: z.string().optional(),
  delay_seconds: z.number().optional(),
  action_property_bindings: z
    .array(
      z.looseObject({
        parameter_id: z.string(),
        environment_oid: z.string().optional(),
        environment_name: z.string().optional(),
        property: z.string(),
      }),
    )
    .optional(),
})

export const select1ConfigSchema = z.looseObject({
  input_name: z.string().optional(),
  input_value_type: z.enum(['literal', 'property']).optional(),
  options: z
    .array(
      z.looseObject({
        id: z.string(),
        label: z.string(),
        // Operator stays an open string here — the editor narrows it to
        // Select1Operator at use, same as the pre-zod behavior.
        operator: z.string(),
        value: z.string(),
        value_type: z.enum(['literal', 'property']),
        is_default: z.boolean(),
      }),
    )
    .optional(),
})

export const actionVisibilitySchema = z.enum(['opaque', 'observable'])

export const actionProxyConfigSchema = z.looseObject({
  action_oid: z.string(),
  environment_oid: z.string(),
  timeout_ms: z.number().optional(),
  action_name: z.string().optional(),
  environment_name: z.string().optional(),
})

/**
 * Parse an OPTIONAL step-config field: absent → undefined; valid → typed value;
 * invalid → undefined + a warning naming the step and field (the old behavior
 * was to let the malformed value flow through a cast, or drop it silently).
 */
export function parseOptionalStepConfig<T>(
  schema: ZodType<T>,
  raw: unknown,
  field: string,
  stepOid: string,
  warnings: string[],
): T | undefined {
  if (raw === undefined || raw === null) return undefined
  const result = schema.safeParse(raw)
  if (result.success) return result.data
  const first = result.error.issues[0]
  const at = first && first.path.length > 0 ? ` at ${first.path.join('.')}` : ''
  warnings.push(`Step ${stepOid}: invalid ${field} ignored (${first?.message ?? 'shape mismatch'}${at})`)
  return undefined
}
