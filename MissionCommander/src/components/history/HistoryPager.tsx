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
import { Button } from '@/components/ui/button';

/** Shared Prev / "Page X of Y" / Next footer (ticket 4a) — extracted from HistoryTab and
 *  HistoryPage, which both carried the identical block. Hidden entirely when there is nothing
 *  to page through (pageCount <= 1). The empty-page snap-back effect that can itself trigger a
 *  page change stays local to each surface (3 lines apiece) — not worth abstracting further. */
export function HistoryPager({ page, pageCount, onPage }: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-sm">
      <Button type="button" variant="ghost" size="sm" disabled={page <= 1}
        onClick={() => onPage(page - 1)}>Prev</Button>
      <span className="text-muted-foreground">Page {page} of {pageCount}</span>
      <Button type="button" variant="ghost" size="sm" disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}
