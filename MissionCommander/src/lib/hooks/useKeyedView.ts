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
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api/client';

/** useResourceView's keep-stale sibling (p7 sweep, ticket 5): a KEY change keeps the previous
 *  view mounted while the new fetch is in flight (loading=true signals it), instead of
 *  blanking to a spinner — built for filterable/paginated lists where unmounting the filter
 *  bar on every commit loses input focus. refresh() always refetches the current key (no
 *  same-key detection needed). Errors keep the stale view too; only `error` + a toast signal. */
export function useKeyedView<T>(key: string | null, fetcher: () => Promise<T>, errorFallback: string) {
  const [view, setView] = useState<T | null>(null);
  const [loading, setLoading] = useState(key !== null);
  const [error, setError] = useState<string | null>(null);
  const reqToken = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const fallbackRef = useRef(errorFallback);
  fallbackRef.current = errorFallback;

  const refresh = useCallback(() => {
    const token = ++reqToken.current;
    if (key === null) { setView(null); setError(null); setLoading(false); return; }
    setLoading(true);
    fetcherRef.current()
      .then((v) => { if (token === reqToken.current) { setView(v); setError(null); } })
      .catch((err) => {
        if (token !== reqToken.current) return;
        const message = apiErrorMessage(err, fallbackRef.current);
        toast.error(message);
        setError(message);
      })
      .finally(() => { if (token === reqToken.current) setLoading(false); });
  }, [key]);

  useEffect(() => { refresh(); }, [refresh]);
  return { view, loading, error, refresh };
}
