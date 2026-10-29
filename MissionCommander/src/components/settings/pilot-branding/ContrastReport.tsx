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

// Spec 2026-10-09 §9/§11: a badge for every contrast pair, both modes — the same rows the
// server's save gate checks (contrastRows/checkContrast in mission-control-db).
import {
  contrastRows, COLOR_LABELS, MODE_LABELS, THEME_MODES, type ResolvedTheme,
} from 'mission-control-db/src/dao/pilot-theme';

export function ContrastReport({ theme }: { theme: ResolvedTheme }) {
  const rows = contrastRows(theme);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {THEME_MODES.map((mode) => (
        <table key={mode} aria-label={`${MODE_LABELS[mode]} contrast`} className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="font-medium">{MODE_LABELS[mode]}</th>
              <th className="font-medium">Ratio</th>
              <th className="font-medium">Minimum</th>
              <th className="font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.filter((r) => r.mode === mode).map((r) => (
              <tr key={`${r.fg}-${r.bg}`}>
                <td>{COLOR_LABELS[r.fg]} on {COLOR_LABELS[r.bg]}</td>
                <td className="font-mono">{r.ratio.toFixed(2)}:1</td>
                <td>needs {r.min}:1</td>
                <td>
                  <span className={r.pass ? 'font-medium text-green-700 dark:text-green-400' : 'font-medium text-destructive'}>
                    {r.pass ? 'Pass' : 'Fail'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
