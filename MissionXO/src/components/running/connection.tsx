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
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';

type Entry = { offline: boolean; lastUpdatedAt: Date | null };
type Report = (id: string, entry: Entry | null) => void;

const ConnectionContext = createContext<{ offline: boolean }>({ offline: false });
const ReportContext = createContext<Report>(() => {});

/** Work-center level: each poller reports under its own id (offline when any reporter is);
 *  New and the detail read the combined state. */
export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const report = useCallback<Report>((id, entry) => {
    setEntries((cur) => {
      const prev = cur[id];
      if (!entry) {
        if (!prev) return cur;
        const { [id]: _drop, ...rest } = cur;
        return rest;
      }
      if (prev && prev.offline === entry.offline && prev.lastUpdatedAt === entry.lastUpdatedAt) return cur;
      return { ...cur, [id]: entry };
    });
  }, []);
  const value = useMemo(() => ({ offline: Object.values(entries).some((e) => e.offline) }), [entries]);
  return (
    <ReportContext.Provider value={report}>
      <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
    </ReportContext.Provider>
  );
}

export function useConnection(): { offline: boolean } {
  return useContext(ConnectionContext);
}

/** A poller's reporter: its entry is removed when the poller unmounts. */
export function useReportConnection(): (offline: boolean, lastUpdatedAt: Date | null) => void {
  const id = useId();
  const report = useContext(ReportContext);
  useEffect(() => () => report(id, null), [id, report]);
  return useCallback((offline, lastUpdatedAt) => report(id, { offline, lastUpdatedAt }), [id, report]);
}
