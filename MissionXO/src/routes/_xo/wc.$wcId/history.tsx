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
import { createFileRoute, Outlet, useParams } from '@tanstack/react-router';
import { HistoryView } from '~/components/history/HistoryView';

export const Route = createFileRoute('/_xo/wc/$wcId/history')({
  component: HistoryRoute,
});

function HistoryRoute() {
  const { historyId } = useParams({ strict: false }) as { historyId?: string };
  return <HistoryView selectedId={historyId} detail={historyId ? <Outlet /> : <EmptyDetail />} />;
}

function EmptyDetail() {
  return <div className="p-6 text-muted-foreground">Select a record to see its detail.</div>;
}
