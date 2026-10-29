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

/** useResourceView's polling sibling (phase 6, spec §6): same monotonic-token +
 *  keep-stale-while-revalidating invariants, plus an interval that refetches while mounted.
 *  Differences, both deliberate: the key is an opaque composite (wcId:filter:page), and a
 *  BACKGROUND tick's failure is silent — the stale view stays, no toast, no error state; only
 *  the first load of a key surfaces errors. Ticks are skipped while document.hidden. Any
 *  later SUCCESS (foreground or background) clears a stale error left by an earlier failed
 *  load — an error must never outlive the failure that set it once fresher data has landed.
 *  `stale` mirrors that same silent-failure path as a boolean a consumer can render on: true
 *  only after a BACKGROUND tick's fetch rejects, reset to false on any success or on a
 *  foreground load's start (foreground failures use `error` instead and never touch `stale`). */
export function usePolledView<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  errorFallback: string,
  intervalMs: number,
) {
  const [view, setView] = useState<T | null>(null);
  const [loading, setLoading] = useState(key !== null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const reqToken = useRef(0);
  const hasLoaded = useRef(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const errorFallbackRef = useRef(errorFallback);
  errorFallbackRef.current = errorFallback;

  const load = useCallback((background: boolean) => {
    const token = ++reqToken.current;
    if (key === null) { setView(null); setError(null); setStale(false); setLoading(false); return; }
    if (!background) { setLoading(true); setError(null); setStale(false); }
    fetcherRef.current()
      .then((v) => { if (token === reqToken.current) { setView(v); setError(null); setStale(false); hasLoaded.current = true; } })
      .catch((err) => {
        if (token !== reqToken.current) return; // a superseded request's outcome never lands
        if (background) { setStale(true); return; } // background failures are silent (no toast/error), just flip `stale`
        const message = apiErrorMessage(err, errorFallbackRef.current);
        toast.error(message);
        setError(message);
      })
      // The CURRENT request clears loading whether it ran in the foreground or the background:
      // a tick can supersede a slow first load, and then only the tick may clear it.
      .finally(() => { if (token === reqToken.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    setView(null);
    hasLoaded.current = false;
    load(false);
    if (key === null) return;
    const timer = setInterval(() => { if (!document.hidden) load(true); }, intervalMs);
    return () => clearInterval(timer);
  }, [key, intervalMs, load]);

  const refresh = useCallback(() => load(hasLoaded.current), [load]);
  return { view, loading, error, stale, refresh };
}
