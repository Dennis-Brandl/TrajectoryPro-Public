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

// P4.1 boot migration (spec §3.3, decisions §1.2/§1.4): materialize v2 formDocument on
// every form-bearing step across ALL lifecycle states. The v1 formLayouts inside each
// payload stays byte-identical; the report goes to the server log (the converter is pure
// and v1 stays in place, so the full report is re-derivable at any time). updatedAt is
// deliberately untouched. Idempotent via the per-row dataSchemaVersion stamp; the
// app_setting record is the human-readable run summary, not the gate.

import { rawQuery, withTransaction } from './db'
import { CURRENT_DATA_SCHEMA_VERSION } from '@/lib/data-schema-version'
import { convertV1FormLayouts } from '@/lib/form-document/convert-layouts'
import { applyYesNoLabels } from '@/lib/import/transformers'
import type { V1FormLayouts } from '@mission/form-schema'

export async function migrateFormDocuments(): Promise<void> {
  const rows = await rawQuery<{ id: string; name: string; data: string; dataSchemaVersion: number }>(
    `SELECT id, name, data, "dataSchemaVersion" FROM "specification" WHERE "dataSchemaVersion" < $1`,
    [CURRENT_DATA_SCHEMA_VERSION],
  )
  if (rows.length === 0) {
    console.info(`[migration] formDocument v${CURRENT_DATA_SCHEMA_VERSION}: all specs up to date`)
    return
  }

  let specs = 0
  let steps = 0
  let advisories = 0
  let failed = 0

  for (const row of rows) {
    try {
      await withTransaction(async (q) => {
        const parsed = JSON.parse(row.data) as Record<string, unknown>
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('specification.data is not a JSON object')
        }
        let changed = false
        const nodes = Array.isArray(parsed.nodes) ? (parsed.nodes as Array<Record<string, unknown>>) : []
        for (const node of nodes) {
          const nodeData = node.data as Record<string, unknown> | undefined
          if (!nodeData?.formLayouts || nodeData.formDocument) continue
          const { document, report, yesNoLabels } = convertV1FormLayouts(nodeData.formLayouts as V1FormLayouts)
          nodeData.formDocument = document
          changed = true
          steps++
          if (yesNoLabels && node.type === 'yesNoStep') {
            nodeData.uiParameters = applyYesNoLabels(
              nodeData.uiParameters as Parameters<typeof applyYesNoLabels>[0],
              yesNoLabels,
            )
          }
          for (const entry of report.entries) {
            advisories++
            console.info(
              `[migration] spec "${row.name}" (${row.id}) step ${node.id as string}: ${entry.kind} — ${entry.detail}`,
            )
          }
        }
        await q(`UPDATE "specification" SET data = $1, "dataSchemaVersion" = $2 WHERE id = $3`, [
          changed ? JSON.stringify(parsed) : row.data,
          CURRENT_DATA_SCHEMA_VERSION,
          row.id,
        ])
      })
      specs++
    } catch (e) {
      failed++
      console.error(
        `[migration] FAILED spec "${row.name}" (${row.id}) — left at v${row.dataSchemaVersion} for re-attempt:`,
        e instanceof Error ? e.message : e,
      )
    }
  }

  const record = { ranAt: new Date().toISOString(), specs, steps, advisories, failed }
  console.info(
    `[migration] formDocument v${CURRENT_DATA_SCHEMA_VERSION}: ${specs} specs migrated, ${steps} form steps converted, ${advisories} advisories, ${failed} failed`,
  )
  await rawQuery(
    `INSERT INTO "app_setting" (key, value) VALUES ('formDocumentMigrationV4', $1)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify(record)],
  )
}
