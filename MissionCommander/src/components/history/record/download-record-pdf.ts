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

import type { RuntimeHistoryDetail } from '../../../lib/api/types';

// Builds the runtime record PDF and saves it in the browser. The PDF modules (and jsPDF behind
// them) load on the first call, not with the main bundle. Throws on failure; callers toast.
export async function downloadRecordPdf(detail: RuntimeHistoryDetail, loginName: string): Promise<void> {
  const [{ buildRecordModel, pdfFileName }, { renderRecordPdf }] = await Promise.all([
    import('./record-model'), import('./record-pdf'),
  ]);
  const model = buildRecordModel(detail, {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    now: new Date(),
    loginName,
  });
  renderRecordPdf(model).doc.save(pdfFileName(detail));
}
