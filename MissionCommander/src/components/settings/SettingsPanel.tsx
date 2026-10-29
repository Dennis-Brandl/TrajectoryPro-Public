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
//
// System-wide settings (spec 2026-08-20). Copy is exact spec copy — do not reword.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useHasRight, usePrincipalStore } from '@/stores/principalStore';
import { systemSettings } from '@/lib/api/system-settings';
import { apiErrorMessage } from '@/lib/api/client';
import type { ActionMatchingMode, ActionServerTrust } from '@/lib/api/types';
import { normalizeActionServerOrigin } from '@/lib/action-server-origin';
import { Button } from '@/components/ui/button';
import { RequiresTooltip } from '@/components/shared/RequiresTooltip';

const parseLines = (text: string): { ok: true; origins: string[] } | { ok: false; message: string } => {
  const origins: string[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const parsed = normalizeActionServerOrigin(line);
    if (!parsed.ok) return { ok: false, message: `Line ${i + 1}: ${parsed.reason}` };
    origins.push(parsed.origin);
  }
  return { ok: true, origins };
};

export function SettingsPanel() {
  const canEdit = useHasRight('settings:edit');
  const isAdmin = usePrincipalStore((s) => s.principal?.isAdministrator ?? false);
  const [mode, setMode] = useState<ActionMatchingMode>('loose');
  const [trust, setTrust] = useState<ActionServerTrust>('strict');
  const [allowlistText, setAllowlistText] = useState('');
  const [lineError, setLineError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    systemSettings.get()
      .then((d) => {
        if (!cancelled) {
          setMode(d.actionMatching);
          setTrust(d.actionServerTrust);
          setAllowlistText(d.actionServerAllowlist.join('\n'));
          setLoaded(true);
        }
      })
      .catch((err) => { if (!cancelled) setLoadError(apiErrorMessage(err, 'Failed to load settings')); });
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    const parsed = parseLines(allowlistText);
    if (!parsed.ok) {
      setLineError(parsed.message);
      return;
    }
    setLineError(null);
    setSaving(true);
    try {
      const patch = isAdmin
        ? { actionMatching: mode, actionServerTrust: trust, actionServerAllowlist: parsed.origins }
        : { actionMatching: mode };
      await systemSettings.update(patch);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-xl font-semibold">Settings</h1>
      {loadError && <p role="alert" className="mt-4 text-sm text-destructive">{loadError}</p>}
      <fieldset role="radiogroup" aria-label="Action matching" className="mt-4 space-y-3" disabled={!loaded}>
        <legend className="font-medium">Action matching</legend>
        <label className="flex gap-2 items-start">
          <input type="radio" name="action-matching" checked={mode === 'loose'} onChange={() => setMode('loose')} />
          <span><b>Loose (default)</b><br />
            Actions and their input parameters are matched by name against the environment action container. Extra actions and parameters on the container are allowed. OIDs are ignored.</span>
        </label>
        <label className="flex gap-2 items-start">
          <input type="radio" name="action-matching" checked={mode === 'strict'} onChange={() => setMode('strict')} />
          <span><b>Strict</b><br />
            Actions are matched by OID. The container must hold the exact action OIDs the workflow references.</span>
        </label>
      </fieldset>
      <fieldset role="radiogroup" aria-label="Action server trust" className="mt-6 space-y-3" disabled={!loaded || !isAdmin}>
        <legend className="font-medium">Action server trust</legend>
        {!isAdmin && <p className="text-sm text-muted-foreground">Requires an administrator</p>}
        <label className="flex gap-2 items-start">
          <input type="radio" name="action-server-trust" checked={trust === 'strict'} onChange={() => setTrust('strict')} />
          <span><b>Strict (default)</b><br />
            The engine only contacts action servers whose origin is in the list below. An empty list refuses every action server.</span>
        </label>
        <label className="flex gap-2 items-start">
          <input type="radio" name="action-server-trust" checked={trust === 'loose'} onChange={() => setTrust('loose')} />
          <span><b>Loose</b><br />
            The engine contacts any http(s) action server without checking the list. Use only for testing or in a controlled network.</span>
        </label>
        {trust === 'loose' && (
          <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">⚠ Loose disables the engine's protection against action-server addresses that point at arbitrary hosts.</p>
        )}
      </fieldset>
      <div className="mt-4 space-y-1">
        <label className="font-medium" htmlFor="allowed-action-servers">Allowed action servers</label>
        <textarea id="allowed-action-servers" aria-label="Allowed action servers" rows={4}
          className="w-full rounded border bg-background p-2 font-mono text-sm"
          placeholder="http://mission-autopilot-server:3002" value={allowlistText}
          onChange={(e) => { setAllowlistText(e.target.value); setLineError(null); }} disabled={!loaded || !isAdmin} />
        {lineError && <p className="text-sm text-destructive">{lineError}</p>}
        <p className="text-sm text-muted-foreground">One origin per line, scheme + host + port, no path. In the Docker fleet the Mission Autopilot server is reachable by the engine at <code>http://mission-autopilot-server:3002</code> (copy it from the Mission Autopilot console top bar, "Mission Commander address").</p>
      </div>
      <RequiresTooltip reason={!canEdit ? 'Requires settings:edit' : !loaded ? 'Settings have not loaded' : undefined}>
        <Button type="button" size="sm" className="mt-4" disabled={!canEdit || saving || !loaded}
          title={!canEdit ? 'Requires settings:edit' : !loaded ? 'Settings have not loaded' : undefined} onClick={save}>
          Save
        </Button>
      </RequiresTooltip>
    </div>
  );
}
