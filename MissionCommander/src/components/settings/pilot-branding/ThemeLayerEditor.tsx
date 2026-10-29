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

// Spec 2026-10-09 §9: the Pilot theme editor for ONE layer — the site, or a work center's
// override — over the layers beneath it (`base`, lowest first). Previews, badges and the save
// gate run mission-control-db's resolveTheme/checkContrast on base + draft: the merged theme
// the server re-checks on save and the engine serves. Each field says where its value comes
// from; an empty field inherits and shows the inherited value as its placeholder.
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  resolveTheme, checkContrast, effectiveColors, parseTheme, describeFailure, describeWarning, fontStack,
  PILOT_FONTS, DENSITIES, RADII, DEFAULT_MODES, COLOR_KEYS, COLOR_LABELS, THEME_MODES, MODE_LABELS,
  type PilotTheme, type FontId, type Density, type Radius, type DefaultMode,
} from 'mission-control-db/src/dao/pilot-theme';
import type { BrokenWorkCenter } from 'mission-control-db';
import { apiErrorMessage } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { ColorField } from './ColorField';
import { ThemePreview } from './ThemePreview';
import { ContrastReport } from './ContrastReport';
import { LogoField } from './LogoField';
import {
  withField, withColor, colorProvenance, fieldProvenance, DENSITY_LABELS, RADIUS_LABELS, DEFAULT_MODE_LABELS,
  type BaseLayer,
} from './theme-draft';
import './pilot-fonts.css';

const EMPTY: PilotTheme = { schema: 1 };
const SELECT = 'rounded border bg-background px-2 py-1 text-sm disabled:opacity-60';
const TEXT = 'w-64 rounded border bg-background px-2 py-1 text-sm aria-[invalid=true]:border-destructive disabled:opacity-60';

export interface ThemeLayerEditorProps {
  heading: string;
  intro: string;
  idPrefix: string;
  /** Lower-precedence layers, lowest first (site, root WC, …, parent). Empty for the site. */
  base: readonly BaseLayer[];
  /** Provenance label of a field this layer sets: 'site' or 'this work center'. */
  ownLabel: string;
  resetLabel: string;
  saveLabel: string;
  savedToast: string;
  failedToast: string;
  /** This layer as stored; null while loading (the parent re-keys the editor once loaded). */
  layer: PilotTheme | null;
  loadError: string | null;
  canEdit: boolean;
  onSave(draft: PilotTheme): Promise<{ layer: PilotTheme; broken: BrokenWorkCenter[] }>;
}

export function ThemeLayerEditor(p: ThemeLayerEditorProps) {
  const [draft, setDraft] = useState<PilotTheme>(p.layer ?? EMPTY);
  const [titleText, setTitleText] = useState(p.layer?.appTitle ?? '');
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  // Bumped on save and reset: remounts the colour fields so no stale text survives.
  const [generation, setGeneration] = useState(0);
  const [saving, setSaving] = useState(false);
  const [broken, setBroken] = useState<BrokenWorkCenter[]>([]);

  const adopt = (layer: PilotTheme) => {
    setDraft(layer);
    setTitleText(layer.appTitle ?? '');
    setInvalid({});
    setGeneration((g) => g + 1);
  };

  const baseThemes = useMemo(() => p.base.map((b) => b.theme), [p.base]);
  const inherited = useMemo(() => resolveTheme(baseThemes), [baseThemes]);
  const resolved = useMemo(() => resolveTheme([...baseThemes, draft]), [baseThemes, draft]);
  const checks = useMemo(() => checkContrast(resolved), [resolved]);
  // A failure the layers beneath already have (a later site change broke an ancestor) is
  // named but does not block this layer's save — the server applies the same rule.
  const inheritedKeys = useMemo(
    () => new Set(checkContrast(inherited).failures.map((f) => `${f.mode}-${f.fg}-${f.bg}`)),
    [inherited],
  );
  const ownFailures = checks.failures.filter((f) => !inheritedKeys.has(`${f.mode}-${f.fg}-${f.bg}`));
  const inheritedFailures = p.base.length === 0 ? [] : checks.failures.filter((f) => inheritedKeys.has(`${f.mode}-${f.fg}-${f.bg}`));
  const onValidity = useCallback((id: string, valid: boolean) => {
    setInvalid((m) => (m[id] === !valid ? m : { ...m, [id]: !valid }));
  }, []);

  const editable = p.canEdit && p.layer !== null;
  const invalidCount = Object.values(invalid).filter(Boolean).length;
  const blocked = ownFailures.length > 0 || invalidCount > 0;
  const fallbackWord = p.base.length === 0 ? 'Default' : 'Inherited';
  const id = (s: string) => `${p.idPrefix}-${s}`;
  const fieldProv = (field: Parameters<typeof fieldProvenance>[1]) => fieldProvenance(draft, field, p.base, p.ownLabel);
  // resolveTheme: a layer that sets its own logo drops the dark logo it would inherit, so
  // that inherited dark logo is no longer what applies here.
  const darkFollowsOwnLogo = draft.logo != null && draft.logoDark == null && inherited.logoDark !== null;

  const onTitle = (text: string) => {
    setTitleText(text);
    if (text.trim() === '') {
      onValidity('appTitle', true);
      setDraft((d) => withField(d, 'appTitle', null));
      return;
    }
    const r = parseTheme({ schema: 1, appTitle: text }, { strict: true });
    onValidity('appTitle', r.ok);
    if (r.ok && r.theme.appTitle) {
      const title = r.theme.appTitle;
      setDraft((d) => withField(d, 'appTitle', title));
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await p.onSave(draft);
      adopt(r.layer);
      setBroken(r.broken);
      toast.success(p.savedToast);
    } catch (err) {
      toast.error(apiErrorMessage(err, p.failedToast));
    } finally {
      setSaving(false);
    }
  };

  const light = effectiveColors(resolved, 'light');

  return (
    <section aria-labelledby={id('heading')} className="max-w-6xl border-t p-6">
      <h2 id={id('heading')} className="text-lg font-semibold">{p.heading}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{p.intro}</p>
      {!p.canEdit && <p className="mt-2 text-sm text-muted-foreground">Requires an administrator</p>}
      {p.loadError && <p role="alert" className="mt-4 text-sm text-destructive">{p.loadError}</p>}

      <div key={generation} className="mt-4 grid gap-6 xl:grid-cols-[auto_minmax(18rem,1fr)]">
        <div className="space-y-4">
          <div className="grid grid-cols-[9rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
            <label htmlFor={id('app-title')}>App title</label>
            <span className="flex items-center gap-2">
              <input
                id={id('app-title')}
                value={titleText}
                placeholder={inherited.appTitle}
                aria-describedby={`${id('app-title')}-provenance`}
                aria-invalid={invalid.appTitle ? true : undefined}
                disabled={!editable}
                onChange={(e) => onTitle(e.target.value)}
                className={TEXT}
              />
              <span id={`${id('app-title')}-provenance`} className="text-xs text-muted-foreground">{fieldProv('appTitle')}</span>
              {invalid.appTitle && <span className="text-xs text-destructive">1–40 characters, no control characters</span>}
            </span>

            <label htmlFor={id('font')}>Font</label>
            <span className="flex items-center gap-2">
              <select
                id={id('font')}
                value={draft.font ?? ''}
                aria-describedby={`${id('font')}-provenance`}
                disabled={!editable}
                style={{ fontFamily: fontStack(resolved.font) }}
                onChange={(e) => setDraft((d) => withField(d, 'font', e.target.value === '' ? null : (e.target.value as FontId)))}
                className={SELECT}
              >
                <option value="">{fallbackWord} ({PILOT_FONTS[inherited.font].label})</option>
                {(Object.keys(PILOT_FONTS) as FontId[]).map((f) => (
                  <option key={f} value={f} style={{ fontFamily: fontStack(f) }}>{PILOT_FONTS[f].label}</option>
                ))}
              </select>
              <span id={`${id('font')}-provenance`} className="text-xs text-muted-foreground">{fieldProv('font')}</span>
            </span>

            <label htmlFor={id('density')}>Density</label>
            <span className="flex items-center gap-2">
              <select
                id={id('density')}
                value={draft.density ?? ''}
                aria-describedby={`${id('density')}-provenance`}
                disabled={!editable}
                onChange={(e) => setDraft((d) => withField(d, 'density', e.target.value === '' ? null : (e.target.value as Density)))}
                className={SELECT}
              >
                <option value="">{fallbackWord} ({DENSITY_LABELS[inherited.density]})</option>
                {(Object.keys(DENSITIES) as Density[]).map((v) => <option key={v} value={v}>{DENSITY_LABELS[v]}</option>)}
              </select>
              <span id={`${id('density')}-provenance`} className="text-xs text-muted-foreground">{fieldProv('density')}</span>
            </span>

            <label htmlFor={id('radius')}>Corner radius</label>
            <span className="flex items-center gap-2">
              <select
                id={id('radius')}
                value={draft.radius ?? ''}
                aria-describedby={`${id('radius')}-provenance`}
                disabled={!editable}
                onChange={(e) => setDraft((d) => withField(d, 'radius', e.target.value === '' ? null : (e.target.value as Radius)))}
                className={SELECT}
              >
                <option value="">{fallbackWord} ({RADIUS_LABELS[inherited.radius]})</option>
                {(Object.keys(RADII) as Radius[]).map((v) => <option key={v} value={v}>{RADIUS_LABELS[v]}</option>)}
              </select>
              <span id={`${id('radius')}-provenance`} className="text-xs text-muted-foreground">{fieldProv('radius')}</span>
            </span>

            <label htmlFor={id('default-mode')}>Default mode</label>
            <span className="flex items-center gap-2">
              <select
                id={id('default-mode')}
                value={draft.defaultMode ?? ''}
                aria-describedby={`${id('default-mode')}-provenance`}
                disabled={!editable}
                onChange={(e) => setDraft((d) => withField(d, 'defaultMode', e.target.value === '' ? null : (e.target.value as DefaultMode)))}
                className={SELECT}
              >
                <option value="">{fallbackWord} ({DEFAULT_MODE_LABELS[inherited.defaultMode]})</option>
                {DEFAULT_MODES.map((v) => <option key={v} value={v}>{DEFAULT_MODE_LABELS[v]}</option>)}
              </select>
              <span id={`${id('default-mode')}-provenance`} className="text-xs text-muted-foreground">{fieldProv('defaultMode')}</span>
            </span>

            <span>Logo</span>
            <LogoField
              id={id('logo')}
              label="Logo"
              value={draft.logo ?? null}
              inherited={inherited.logo}
              noneText="Mission Pilot mark"
              provenance={fieldProv('logo')}
              disabled={!editable}
              allowMark={p.base.length > 0}
              onChange={(v) => setDraft((d) => withField(d, 'logo', v))}
            />

            <span>Dark logo</span>
            <LogoField
              id={id('logo-dark')}
              label="Dark logo"
              value={draft.logoDark ?? null}
              inherited={darkFollowsOwnLogo ? null : inherited.logoDark}
              noneText="Same as the logo"
              provenance={darkFollowsOwnLogo ? p.ownLabel : fieldProv('logoDark')}
              disabled={!editable}
              allowMark={false}
              onChange={(v) => setDraft((d) => withField(d, 'logoDark', v === false ? null : v))}
            />

            <span>Work-center accent</span>
            <ColorField
              id={id('wc-accent')}
              label="Work-center accent"
              value={draft.wcAccent ?? null}
              effective={light.wcAccent}
              provenance={fieldProv('wcAccent')}
              disabled={!editable}
              onChange={(v) => setDraft((d) => withField(d, 'wcAccent', v))}
              onValidity={onValidity}
            />
          </div>

          <table className="text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pr-3 font-medium">Colour</th>
                {THEME_MODES.map((mode) => <th key={mode} className="pr-3 font-medium">{MODE_LABELS[mode]}</th>)}
              </tr>
            </thead>
            <tbody>
              {COLOR_KEYS.map((key) => (
                <tr key={key}>
                  <td className="pr-3">{COLOR_LABELS[key]}</td>
                  {THEME_MODES.map((mode) => (
                    <td key={mode} className="py-1 pr-3">
                      <ColorField
                        id={id(`${mode}-${key}`)}
                        label={`${MODE_LABELS[mode]} ${COLOR_LABELS[key]}`}
                        value={draft.colors?.[mode]?.[key] ?? null}
                        effective={effectiveColors(resolved, mode)[key]}
                        provenance={colorProvenance(draft, resolved, mode, key, p.base, p.ownLabel)}
                        disabled={!editable}
                        onChange={(v) => setDraft((d) => withColor(d, mode, key, v))}
                        onValidity={onValidity}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3">
          {THEME_MODES.map((mode) => <ThemePreview key={mode} theme={resolved} mode={mode} />)}
        </div>
      </div>

      <div className="mt-6">
        <ContrastReport theme={resolved} />
      </div>

      {ownFailures.length > 0 && (
        <div role="alert" className="mt-4 rounded border border-destructive p-3 text-sm">
          <p className="font-medium">Save is disabled until these pass:</p>
          <ul className="list-disc pl-5">
            {ownFailures.map((f) => <li key={`${f.mode}-${f.fg}-${f.bg}`}>{describeFailure(f)}</li>)}
          </ul>
        </div>
      )}
      {inheritedFailures.length > 0 && (
        <section aria-label="Inherited contrast problems" className="mt-4 rounded border border-amber-600 p-3 text-sm">
          <p className="font-medium">
            The branding this work center inherits fails these checks; fix them where they are set. Its Pilots use
            readable fallback colours meanwhile:
          </p>
          <ul className="list-disc pl-5">
            {inheritedFailures.map((f) => <li key={`${f.mode}-${f.fg}-${f.bg}`}>{describeFailure(f)}</li>)}
          </ul>
        </section>
      )}
      {checks.warnings.length > 0 && (
        <ul aria-label="Warnings" className="mt-4 space-y-1 text-sm text-amber-700 dark:text-amber-400">
          {checks.warnings.map((w) => <li key={`${w.mode}-${w.field}`}>⚠ {describeWarning(w)}</li>)}
        </ul>
      )}
      {broken.length > 0 && (
        <section aria-label="Work centers needing attention" className="mt-4 rounded border border-amber-600 p-3 text-sm">
          <p className="font-medium">
            Saved. These work centers&apos; own branding now fails the contrast checks; their Pilots use readable
            fallback colours until it is fixed:
          </p>
          <ul className="list-disc pl-5">
            {broken.map((b) => <li key={b.id}>{b.name}: {b.failures.join('; ')}</li>)}
          </ul>
        </section>
      )}

      <div className="mt-4 flex gap-2">
        <Button type="button" size="sm" disabled={!editable || saving || blocked} onClick={save}>
          {p.saveLabel}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!editable} onClick={() => adopt(EMPTY)}>
          {p.resetLabel}
        </Button>
      </div>
    </section>
  );
}
