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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@mission/ui';
import { runtimeHistory } from '@/lib/api/runtime-history';
import { apiErrorMessage } from '@/lib/api/client';
import type { RuntimeHistoryDetail } from '@/lib/api/types';
import { buildRecordModel } from '@/components/history/record/record-model';
import { downloadRecordPdf } from '@/components/history/record/download-record-pdf';
import { useLayout } from '~/lib/layout';
import { useMeStore } from '~/stores/meStore';
import { useWorkCenter } from '~/components/shell/WorkCenterShell';
import { useSplitView } from '~/components/running/useSplitView';
import { RecordView } from './RecordView';

export function HistoryDetail({ historyId }: { historyId: string }) {
  const wc = useWorkCenter();
  const navigate = useNavigate();
  const layout = useLayout();
  const split = useSplitView();
  const loginName = useMeStore((s) => s.me?.loginName ?? '');
  const [detail, setDetail] = useState<RuntimeHistoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let live = true;
    setDetail(null); setError(null);
    runtimeHistory.detail(historyId)
      .then((d) => { if (live) setDetail(d); })
      .catch((err) => { if (live) setError(apiErrorMessage(err, 'Could not load the record')); });
    return () => { live = false; };
  }, [historyId]);

  const download = async () => {
    if (inFlight.current || !detail) return;
    inFlight.current = true;
    setBusy(true);
    try { await downloadRecordPdf(detail, loginName); }
    catch { toast.error('Could not create the PDF'); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const model = useMemo(() => detail && buildRecordModel(detail, {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, now: new Date(), loginName,
  }), [detail, loginName]);
  return (
    <div className="p-4">
      {!split && (
        <Button variant="ghost" className="mb-3 min-h-11" onClick={() => { void navigate({ to: '/wc/$wcId/history', params: { wcId: wc.id } }); }}>
          <ArrowLeft className="size-4" /> Back
        </Button>
      )}
      {!detail && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {model && (
        <>
          <Button className="mb-3 min-h-11" disabled={busy} onClick={() => { void download(); }}>
            <Download className="size-4" /> Download PDF
          </Button>
          <RecordView model={model} layout={layout} />
        </>
      )}
    </div>
  );
}
