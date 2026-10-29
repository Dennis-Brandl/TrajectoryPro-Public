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

// Spec 2026-10-09 §9 (R4): a work center's Pilot branding — an override of the site theme
// that passes down to its child work centers. The same editor as Settings → Pilot branding,
// over the site and this work center's ancestors; an empty field inherits.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PilotTheme } from 'mission-control-db/src/dao/pilot-theme';
import { usePrincipalStore } from '@/stores/principalStore';
import { workCenters } from '@/lib/api/work-centers';
import { apiErrorMessage } from '@/lib/api/client';
import type { WorkCenterThemeView } from '@/lib/api/types';
import { ThemeLayerEditor } from '@/components/settings/pilot-branding/ThemeLayerEditor';
import type { BaseLayer } from '@/components/settings/pilot-branding/theme-draft';

const isEmptyLayer = (t: PilotTheme) => Object.keys(t).every((k) => k === 'schema');

export function WorkCenterBrandingTab({ workCenterId }: { workCenterId: string }) {
  const isAdmin = usePrincipalStore((s) => s.principal?.isAdministrator ?? false);
  const [view, setView] = useState<WorkCenterThemeView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setView(null);
    setLoadError(null);
    workCenters.pilotTheme(workCenterId)
      .then((v) => { if (!cancelled) setView(v); })
      .catch((err) => { if (!cancelled) setLoadError(apiErrorMessage(err, 'Failed to load work-center branding')); });
    return () => { cancelled = true; };
  }, [workCenterId]);

  const base = useMemo<readonly BaseLayer[]>(() => (view
    ? [
      { label: 'site', theme: view.site },
      ...view.chain.slice(0, -1).map((l) => ({ label: `inherited from ${l.name}`, theme: l.theme })),
    ]
    : []), [view]);

  const onSave = useCallback(async (draft: PilotTheme) => {
    const v = await workCenters.setPilotTheme(workCenterId, isEmptyLayer(draft) ? null : draft);
    return { layer: v.chain.at(-1)?.theme ?? { schema: 1 }, broken: v.broken ?? [] };
  }, [workCenterId]);

  return (
    <ThemeLayerEditor
      key={view ? `${workCenterId}:${view.rev}` : `${workCenterId}:loading`}
      heading="Work-center branding"
      intro="Overrides the site's Pilot branding for this work center and every work center under it. Leave a field empty to inherit it."
      idPrefix="wc-pilot"
      base={base}
      ownLabel="this work center"
      resetLabel="Clear all overrides"
      saveLabel="Save work-center branding"
      savedToast="Work-center branding saved"
      failedToast="Failed to save work-center branding"
      layer={view ? (view.chain.at(-1)?.theme ?? { schema: 1 }) : null}
      loadError={loadError}
      canEdit={isAdmin}
      onSave={onSave}
    />
  );
}
