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

import { schedules } from '@/lib/api/schedules';

/** Fetches the Master with its change history, builds the PDF, and saves it. jsPDF loads on the
 *  first export, not with the main bundle. Throws on failure; callers toast. */
export async function downloadMasterSchedulePdf(masterId: string, loginName: string): Promise<string> {
  const [record, pdf] = await Promise.all([schedules.record(masterId), import('./master-schedule-pdf')]);
  const model = pdf.buildMasterScheduleModel(record, { now: new Date(), loginName });
  const name = pdf.masterSchedulePdfName(record);
  pdf.renderMasterSchedulePdf(model).save(name);
  return name;
}
