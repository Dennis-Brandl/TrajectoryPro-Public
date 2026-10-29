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

// Generalized from the M1 useWorkCenterView (spec §7.1): the shared fetch+refresh
// state machine for a single selected resource, parameterized by the fetcher and a
// human error fallback. Consumed by the work-center, user, and role detail panels.
// Invariants preserved verbatim from M1:
//  - monotonic request token: only the latest refresh()/setView may apply state, so a
//    slow superseded response (or a cleared view) is never resurrected by a late fetch;
//  - keep-stale-while-revalidating: an imperative same-id refresh() keeps the current
//    view mounted (loading && !view is the "show spinner" gate), so uncontrolled Tabs
//    survive a refetch; an id change clears the view first, showing the spinner.
export function useResourceView<T>(
  id: string | null,
  fetcher: (id: string) => Promise<T>,
  errorFallback: string,
) {
  const [view, setView] = useState<T | null>(null);
  const [loading, setLoading] = useState(id !== null);
  const [error, setError] = useState<string | null>(null);
  const reqToken = useRef(0);
  // fetcher and errorFallback identity may vary per render (inline arrow / non-literal
  // string at call sites); pin them in refs so refresh()'s identity depends only on
  // `id`, matching M1's [id]-only dependency.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const errorFallbackRef = useRef(errorFallback);
  errorFallbackRef.current = errorFallback;

  const refresh = useCallback(() => {
    const token = ++reqToken.current;
    if (id === null) {
      setView(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetcherRef.current(id)
      .then((v) => { if (token === reqToken.current) setView(v); })
      .catch((err) => {
        if (token !== reqToken.current) return;
        const message = apiErrorMessage(err, errorFallbackRef.current);
        toast.error(message);
        setError(message);
      })
      .finally(() => { if (token === reqToken.current) setLoading(false); });
  }, [id]);

  useEffect(() => {
    setView(null);
    refresh();
  }, [refresh]);

  const setViewSafe = useCallback((v: T) => {
    reqToken.current++;      // invalidate any in-flight refresh
    setView(v);
    setLoading(false);       // that refresh's finally will never run its token branch
    setError(null);          // a successful drop-in supersedes any stale error
  }, []);

  return { view, loading, error, refresh, setView: setViewSafe };
}
