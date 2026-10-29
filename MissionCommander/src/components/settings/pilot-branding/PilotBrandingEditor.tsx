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

// Spec 2026-10-09 §9: Settings → Pilot branding, the site layer. Administrators edit; everyone
// with settings:read sees it read-only (§8.3). The editor itself is ThemeLayerEditor, shared
// with the work-center Branding tab; the site has no layer beneath it.
import { useCallback, useEffect, useState } from 'react';
import type { PilotTheme } from 'mission-control-db/src/dao/pilot-theme';
import { useHasRight, usePrincipalStore } from '@/stores/principalStore';
import { systemSettings } from '@/lib/api/system-settings';
import { apiErrorMessage } from '@/lib/api/client';
import { ThemeLayerEditor } from './ThemeLayerEditor';
import type { BaseLayer } from './theme-draft';

const NO_BASE: readonly BaseLayer[] = [];

export function PilotBrandingEditor() {
  const canRead = useHasRight('settings:read');
  const isAdmin = usePrincipalStore((s) => s.principal?.isAdministrator ?? false);
  const [site, setSite] = useState<PilotTheme | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    systemSettings.get()
      .then((d) => { if (!cancelled) setSite(d.pilotTheme?.site ?? { schema: 1 }); })
      .catch((err) => { if (!cancelled) setLoadError(apiErrorMessage(err, 'Failed to load Pilot branding')); });
    return () => { cancelled = true; };
  }, [canRead]);

  const onSave = useCallback(async (draft: PilotTheme) => {
    const d = await systemSettings.update({ pilotTheme: draft });
    return { layer: d.pilotTheme?.site ?? draft, broken: d.pilotThemeBrokenWorkCenters ?? [] };
  }, []);

  if (!canRead) return null;
  return (
    <ThemeLayerEditor
      key={site ? 'loaded' : 'loading'}
      heading="Pilot branding"
      intro="How Mission Pilot looks on every operator screen. An operator's own light/dark and text size still apply."
      idPrefix="pilot"
      base={NO_BASE}
      ownLabel="site"
      resetLabel="Reset all to defaults"
      saveLabel="Save Pilot branding"
      savedToast="Pilot branding saved"
      failedToast="Failed to save Pilot branding"
      layer={site}
      loadError={loadError}
      canEdit={isAdmin}
      onSave={onSave}
    />
  );
}
