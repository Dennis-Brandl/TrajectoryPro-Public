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

import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@mission/ui';
import { apiErrorMessage } from '@/lib/api/client';
import { runtimeHistory } from '@/lib/api/runtime-history';
import type { ScheduleHistoryDetail } from '@/lib/api/types';
import { ScheduleHistoryRecord, passTitle } from '@/components/history/ScheduleHistoryRecord';
import { useWorkCenter } from '~/components/shell/WorkCenterShell';
import { useSplitView } from '~/components/running/useSplitView';

/** A completed schedule pass. A run's label opens its own History record. */
export function SchedulePassDetail({ passId }: { passId: string }) {
  const wc = useWorkCenter();
  const navigate = useNavigate();
  const split = useSplitView();
  const [pass, setPass] = useState<ScheduleHistoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setPass(null); setError(null);
    runtimeHistory.passDetail(passId).then(
      (p) => { if (live) setPass(p); },
      (err) => { if (live) setError(apiErrorMessage(err, 'Could not load the record')); },
    );
    return () => { live = false; };
  }, [passId]);

  return (
    <div className="space-y-3 p-4">
      {!split && (
        <Button variant="ghost" className="min-h-11" onClick={() => { void navigate({ to: '/wc/$wcId/history', params: { wcId: wc.id } }); }}>
          <ArrowLeft className="size-4" /> Back
        </Button>
      )}
      {!pass && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {pass && (
        <>
          <h2 className="text-base font-semibold">{passTitle(pass)}</h2>
          <ScheduleHistoryRecord pass={pass} renderLabel={(w) => (w.historyId
            ? (
              <Link to="/wc/$wcId/history/$historyId" params={{ wcId: wc.id, historyId: w.historyId }}
                className="inline-flex min-h-9 items-center underline-offset-2 hover:underline">{w.runtimeLabel}</Link>
            )
            : w.runtimeLabel)} />
        </>
      )}
    </div>
  );
}
