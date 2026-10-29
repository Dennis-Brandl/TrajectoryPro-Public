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

// Pilot theme format, schema 1 (spec 2026-10-09 §7). ONE module for Commander (write),
// the engine (read) and tests. Pure — no drizzle — so Commander's editor can run the same
// contrast checks live and the Pilot's tests can pin this file against tokens.css.
// Storage lives in ./pilot-theme-store.ts.
import { HEX_RE, contrast, hueDistance, mixOklab, oklch } from '../lib/color.js';

export const COLOR_KEYS = [
  'brand', 'accent', 'accentFg', 'surface', 'surfaceRaised', 'text', 'textMuted', 'border', 'headerBg', 'headerFg', 'focus',
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export const THEME_MODES = ['light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const DENSITIES = { compact: 0.85, comfortable: 1, touch: 1.2 } as const;
export type Density = keyof typeof DENSITIES;

export const RADII = { none: '0', sm: '.25rem', md: '.5rem', lg: '.75rem' } as const;
export type Radius = keyof typeof RADII;

export const DEFAULT_MODES = ['light', 'dark', 'system'] as const;
export type DefaultMode = (typeof DEFAULT_MODES)[number];

export const LOGO_MIMES = ['image/svg+xml', 'image/png'] as const;
export type LogoMime = (typeof LOGO_MIMES)[number];

/** Spec §10: the curated, self-hosted faces. `family` is the @font-face name in
 *  MissionPilot/src/theme/fonts.css (the Pilot's fonts.test.ts pins the two together). */
export const PILOT_FONTS = {
  system: { label: 'System default', family: null },
  inter: { label: 'Inter', family: 'Inter' },
  'ibm-plex-sans': { label: 'IBM Plex Sans', family: 'IBM Plex Sans' },
  'source-sans-3': { label: 'Source Sans 3', family: 'Source Sans 3' },
  'noto-sans': { label: 'Noto Sans', family: 'Noto Sans' },
  roboto: { label: 'Roboto', family: 'Roboto' },
  'open-sans': { label: 'Open Sans', family: 'Open Sans' },
  'atkinson-hyperlegible': { label: 'Atkinson Hyperlegible', family: 'Atkinson Hyperlegible' },
  barlow: { label: 'Barlow', family: 'Barlow' },
  'fira-sans': { label: 'Fira Sans', family: 'Fira Sans' },
  lato: { label: 'Lato', family: 'Lato' },
} as const;
export type FontId = keyof typeof PILOT_FONTS;

export const FONT_FALLBACK = 'system-ui, "Segoe UI", Roboto, sans-serif';

export function fontStack(id: FontId): string {
  const family: string | null = PILOT_FONTS[id].family;
  return family ? `"${family}", ${FONT_FALLBACK}` : FONT_FALLBACK;
}

export const DEFAULT_APP_TITLE = 'Mission Pilot';

export type ColorSet = Partial<Record<ColorKey, string | null>>;

export interface ThemeLogo { id: string; mime: LogoMime; alt: string }

/** One stored layer (site, or a work-center override in P3). Missing or null = inherit. */
export interface PilotTheme {
  schema: 1;
  appTitle?: string | null;
  font?: FontId | null;
  density?: Density | null;
  radius?: Radius | null;
  defaultMode?: DefaultMode | null;
  logo?: ThemeLogo | false | null;
  logoDark?: ThemeLogo | null;
  wcAccent?: string | null;
  colors?: { light?: ColorSet; dark?: ColorSet };
}

export type ParseResult = { ok: true; theme: PilotTheme } | { ok: false; errors: string[] };

type Check<T> = { value: T } | { error: string };

const TOP_KEYS: readonly string[] = [
  'schema', 'appTitle', 'font', 'density', 'radius', 'defaultMode', 'logo', 'logoDark', 'wcAccent', 'colors',
];
const LOGO_KEYS: readonly string[] = ['id', 'mime', 'alt'];
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
const LOGO_ID_RE = /^sha256:[0-9a-f]{64}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function oneOf<T extends string>(list: readonly T[]): (x: unknown) => Check<T> {
  return (x) => (typeof x === 'string' && (list as readonly string[]).includes(x)
    ? { value: x as T }
    : { error: `must be one of ${list.join(', ')}` });
}

function hexColor(x: unknown): Check<string> {
  return typeof x === 'string' && HEX_RE.test(x) ? { value: x.toLowerCase() } : { error: 'must be a #rrggbb colour' };
}

function appTitle(x: unknown): Check<string> {
  if (typeof x !== 'string') return { error: 'must be text' };
  const t = x.trim();
  if (t.length < 1 || t.length > 40) return { error: 'must be 1–40 characters' };
  if (CONTROL_RE.test(t)) return { error: 'must not contain control characters' };
  return { value: t };
}

/**
 * Spec §7. `strict` (Commander's write): unknown fields are errors and every bad value is
 * reported. Lax (the engine's read): unknown fields are ignored and each bad field is dropped
 * on its own, so it reads as inherit — one bad value never blanks the whole theme.
 */
export function parseTheme(raw: unknown, opts: { strict: boolean }): ParseResult {
  const theme: PilotTheme = { schema: 1 };
  if (!isObject(raw)) return opts.strict ? { ok: false, errors: ['theme must be a JSON object'] } : { ok: true, theme };
  if (raw.schema !== 1) return opts.strict ? { ok: false, errors: ['schema must be 1'] } : { ok: true, theme };

  const errors: string[] = [];
  const fail = (path: string, reason: string): void => {
    if (opts.strict) errors.push(`${path}: ${reason}`);
  };

  for (const key of Object.keys(raw)) if (!TOP_KEYS.includes(key)) fail(key, 'unknown field');

  function logo(path: string, x: unknown, allowFalse: boolean): Check<ThemeLogo | false> {
    if (x === false && allowFalse) return { value: false };
    if (!isObject(x)) return { error: allowFalse ? 'must be a logo, false or null' : 'must be a logo or null' };
    for (const key of Object.keys(x)) if (!LOGO_KEYS.includes(key)) fail(`${path}.${key}`, 'unknown field');
    if (typeof x.id !== 'string' || !LOGO_ID_RE.test(x.id)) return { error: 'id must be sha256:<64 hex>' };
    if (typeof x.mime !== 'string' || !(LOGO_MIMES as readonly string[]).includes(x.mime)) {
      return { error: `mime must be one of ${LOGO_MIMES.join(', ')}` };
    }
    if (typeof x.alt !== 'string' || x.alt.length > 200 || CONTROL_RE.test(x.alt)) {
      return { error: 'alt must be text of at most 200 characters' };
    }
    return { value: { id: x.id, mime: x.mime as LogoMime, alt: x.alt } };
  }

  function take<K extends Exclude<keyof PilotTheme, 'schema' | 'colors'>>(
    key: K, check: (x: unknown) => Check<PilotTheme[K]>,
  ): void {
    if (!isObject(raw) || !hasOwn(raw, key) || raw[key] === undefined) return;
    if (raw[key] === null) {
      theme[key] = null as PilotTheme[K];
      return;
    }
    const r = check(raw[key]);
    if ('error' in r) fail(key, r.error);
    else theme[key] = r.value;
  }

  take('appTitle', appTitle);
  take('font', oneOf(Object.keys(PILOT_FONTS) as FontId[]));
  take('density', oneOf(Object.keys(DENSITIES) as Density[]));
  take('radius', oneOf(Object.keys(RADII) as Radius[]));
  take('defaultMode', oneOf(DEFAULT_MODES));
  take('logo', (x) => logo('logo', x, true));
  take('logoDark', (x) => logo('logoDark', x, false) as Check<ThemeLogo>);
  take('wcAccent', hexColor);

  const colorsRaw = raw.colors;
  if (colorsRaw !== undefined && colorsRaw !== null) {
    if (!isObject(colorsRaw)) {
      fail('colors', 'must be an object');
    } else {
      const colors: NonNullable<PilotTheme['colors']> = {};
      for (const key of Object.keys(colorsRaw)) {
        if (!(THEME_MODES as readonly string[]).includes(key)) fail(`colors.${key}`, 'unknown mode');
      }
      for (const mode of THEME_MODES) {
        const setRaw = colorsRaw[mode];
        if (setRaw === undefined || setRaw === null) continue;
        if (!isObject(setRaw)) {
          fail(`colors.${mode}`, 'must be an object');
          continue;
        }
        const set: ColorSet = {};
        for (const key of Object.keys(setRaw)) {
          const path = `colors.${mode}.${key}`;
          if (!(COLOR_KEYS as readonly string[]).includes(key)) {
            fail(path, 'unknown colour');
            continue;
          }
          const value = setRaw[key];
          if (value === undefined) continue;
          if (value === null) {
            set[key as ColorKey] = null;
            continue;
          }
          const r = hexColor(value);
          if ('error' in r) fail(path, r.error);
          else set[key as ColorKey] = r.value;
        }
        colors[mode] = set;
      }
      theme.colors = colors;
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, theme };
}

/** A stored layer's JSON text → a theme. Never throws: unreadable text reads as nothing set. */
export function readTheme(stored: string | null | undefined): PilotTheme {
  let raw: unknown = null;
  try {
    raw = JSON.parse(stored ?? 'null');
  } catch {
    raw = null;
  }
  const r = parseTheme(raw, { strict: false });
  return r.ok ? r.theme : { schema: 1 };
}

// ── Resolution (spec §8.2) ──

/** The shipped token defaults, mirrored from MissionPilot/src/theme/tokens.css
 *  (MissionPilot theme-parity.test.ts pins every value). `accent` follows `brand`. */
export const DEFAULT_COLORS: Record<ThemeMode, Record<Exclude<ColorKey, 'accent'>, string>> = {
  light: {
    brand: '#1d4ed8', accentFg: '#ffffff', surface: '#f4f6f9', surfaceRaised: '#ffffff', text: '#111827',
    textMuted: '#4b5563', border: '#d0d7e0', headerBg: '#0f1b2d', headerFg: '#ffffff', focus: '#2563eb',
  },
  dark: {
    brand: '#60a5fa', accentFg: '#0b1220', surface: '#0b1220', surfaceRaised: '#131c2e', text: '#e5e9f0',
    textMuted: '#9aa7ba', border: '#2a3548', headerBg: '#070c16', headerFg: '#e5e9f0', focus: '#93c5fd',
  },
};

/** --pilot-border-strong: fixed per mode in tokens.css, checked at 3:1 on surface-raised. */
export const BORDER_STRONG: Record<ThemeMode, string> = { light: '#848e9d', dark: '#5f6e87' };

/** Fixed (F) status and runtime-stripe colours a brand must not be mistaken for (§11). */
export const STATUS_COLORS: Record<ThemeMode, Record<string, string>> = {
  light: {
    alarm: '#b91c1c', warn: '#b45309', ok: '#15803d',
    'instance-1': '#6d28d9', 'instance-2': '#0e7490', 'instance-3': '#be185d',
    'instance-4': '#4d7c0f', 'instance-5': '#9a3412', 'instance-6': '#475569',
  },
  dark: {
    alarm: '#f87171', warn: '#fbbf24', ok: '#4ade80',
    'instance-1': '#a78bfa', 'instance-2': '#22d3ee', 'instance-3': '#f472b6',
    'instance-4': '#a3e635', 'instance-5': '#fb923c', 'instance-6': '#94a3b8',
  },
};

export interface ResolvedTheme {
  appTitle: string;
  font: FontId;
  density: Density;
  radius: Radius;
  defaultMode: DefaultMode;
  logo: ThemeLogo | null;
  logoDark: ThemeLogo | null;
  wcAccent: string | null;
  /** Per mode: a colour a layer set, an automatic foreground, or null = the shipped default stands. */
  colors: Record<ThemeMode, Record<ColorKey, string | null>>;
  /** Keys filled in for contrast rather than set by a layer. */
  auto: Record<ThemeMode, ColorKey[]>;
}

const WHITE = '#ffffff';
const DARK_INK = '#0b1220';

function emptyColors(): Record<ColorKey, string | null> {
  return {
    brand: null, accent: null, accentFg: null, surface: null, surfaceRaised: null, text: null,
    textMuted: null, border: null, headerBg: null, headerFg: null, focus: null,
  };
}

/** Layers lowest precedence first: site, then root work center … this work center (spec §8.2). */
export function resolveTheme(layers: readonly PilotTheme[]): ResolvedTheme {
  const out: ResolvedTheme = {
    appTitle: DEFAULT_APP_TITLE, font: 'inter', density: 'comfortable', radius: 'md', defaultMode: 'light',
    logo: null, logoDark: null, wcAccent: null,
    colors: { light: emptyColors(), dark: emptyColors() },
    auto: { light: [], dark: [] },
  };
  for (const layer of layers) {
    if (layer.appTitle != null) out.appTitle = layer.appTitle;
    if (layer.font != null) out.font = layer.font;
    if (layer.density != null) out.density = layer.density;
    if (layer.radius != null) out.radius = layer.radius;
    if (layer.defaultMode != null) out.defaultMode = layer.defaultMode;
    // A dark logo is a variant of its layer's logo: a layer that sets its own logo (or the
    // shipped mark) drops the dark logo it would otherwise inherit (final review ruling).
    if (layer.logo === false || layer.logo) out.logoDark = null;
    if (layer.logo === false) out.logo = null;
    else if (layer.logo) out.logo = { ...layer.logo };
    if (layer.logoDark) out.logoDark = { ...layer.logoDark };
    if (layer.wcAccent != null) out.wcAccent = layer.wcAccent;
    for (const mode of THEME_MODES) {
      const set = layer.colors?.[mode];
      if (!set) continue;
      for (const key of COLOR_KEYS) {
        const value = set[key];
        if (value != null) out.colors[mode][key] = value;
      }
    }
  }
  for (const mode of THEME_MODES) applyAutoColors(out, mode);
  return out;
}

function bestForeground(bg: string): string {
  return contrast(WHITE, bg) >= contrast(DARK_INK, bg) ? WHITE : DARK_INK;
}

// Ruling (plan P2a Task 3): an automatic colour is computed only when its background is
// themed, so an untouched theme renders exactly today's tokens.css.
function applyAutoColors(t: ResolvedTheme, mode: ThemeMode): void {
  const set = t.colors[mode];
  if (set.accentFg === null && (set.accent !== null || set.brand !== null)) {
    set.accentFg = bestForeground(effectiveColors(t, mode).accent);
    t.auto[mode].push('accentFg');
  }
  if (set.headerFg === null && set.headerBg !== null) {
    set.headerFg = bestForeground(effectiveColors(t, mode).headerBg);
    t.auto[mode].push('headerFg');
  }
  if (set.focus === null) {
    const eff = effectiveColors(t, mode);
    const worst = (c: string): number => Math.min(contrast(c, eff.surfaceRaised), contrast(c, eff.headerBg));
    if (worst(eff.focus) < 3) {
      const candidates = [eff.accent, WHITE, DARK_INK];
      set.focus = candidates.find((c) => worst(c) >= 3)
        ?? candidates.reduce((best, c) => (worst(c) > worst(best) ? c : best));
      t.auto[mode].push('focus');
    }
  }
}

export interface EffectiveColors extends Record<ColorKey, string> {
  headerFgMuted: string;
  borderStrong: string;
  headerAccent: string;
  wcAccent: string;
}

/** Every colour the §11 checks need, as the browser resolves tokens.css with this theme on top. */
export function effectiveColors(t: ResolvedTheme, mode: ThemeMode): EffectiveColors {
  const set = t.colors[mode];
  const def = DEFAULT_COLORS[mode];
  const brand = set.brand ?? def.brand;
  const headerBg = set.headerBg ?? def.headerBg;
  const headerFg = set.headerFg ?? def.headerFg;
  // tokens.css: light --pilot-header-accent is color-mix(in oklab, brand 45%, white); dark is brand.
  const headerAccent = mode === 'light' ? mixOklab(brand, WHITE, 0.45) : brand;
  return {
    brand,
    accent: set.accent ?? brand,
    accentFg: set.accentFg ?? def.accentFg,
    surface: set.surface ?? def.surface,
    surfaceRaised: set.surfaceRaised ?? def.surfaceRaised,
    text: set.text ?? def.text,
    textMuted: set.textMuted ?? def.textMuted,
    border: set.border ?? def.border,
    headerBg,
    headerFg,
    focus: set.focus ?? def.focus,
    headerFgMuted: mixOklab(headerFg, headerBg, 0.68),
    borderStrong: BORDER_STRONG[mode],
    headerAccent,
    wcAccent: t.wcAccent ?? headerAccent,
  };
}

// ── Contrast and safety checks (spec §11) ──

export const CONTRAST_PAIRS: ReadonlyArray<readonly [keyof EffectiveColors, keyof EffectiveColors, number]> = [
  ['text', 'surface', 4.5],
  ['text', 'surfaceRaised', 4.5],
  ['textMuted', 'surfaceRaised', 4.5],
  ['accentFg', 'accent', 4.5],
  ['headerFg', 'headerBg', 4.5],
  ['headerFgMuted', 'headerBg', 4.5],
  ['borderStrong', 'surfaceRaised', 3],
  ['accent', 'surfaceRaised', 3],
  ['focus', 'surfaceRaised', 3],
  ['focus', 'headerBg', 3],
  ['wcAccent', 'headerBg', 3],
];

export interface ContrastFailure {
  mode: ThemeMode;
  fg: keyof EffectiveColors;
  bg: keyof EffectiveColors;
  /** Floored to 2 decimals, so a failing ratio never displays as the minimum. */
  ratio: number;
  min: number;
}

export interface StatusWarning {
  mode: ThemeMode;
  field: 'brand' | 'accent' | 'wcAccent';
  resembles: string;
}

const HUE_WARN_DEGREES = 30;
const MIN_CHROMA = 0.05;

function closestStatus(hex: string, mode: ThemeMode): string | null {
  const c = oklch(hex);
  if (c.c < MIN_CHROMA) return null;
  let best: { name: string; distance: number } | null = null;
  for (const [name, status] of Object.entries(STATUS_COLORS[mode])) {
    const s = oklch(status);
    if (s.c < MIN_CHROMA) continue;
    const distance = hueDistance(c.h, s.h);
    if (distance < HUE_WARN_DEGREES && (best === null || distance < best.distance)) best = { name, distance };
  }
  return best ? best.name : null;
}

/** Every §11 pair for both modes (light first, CONTRAST_PAIRS order) — the editor's badges. */
export interface ContrastRow extends ContrastFailure {
  pass: boolean;
}

export function contrastRows(t: ResolvedTheme): ContrastRow[] {
  const rows: ContrastRow[] = [];
  for (const mode of THEME_MODES) {
    const eff = effectiveColors(t, mode);
    for (const [fg, bg, min] of CONTRAST_PAIRS) {
      const ratio = contrast(eff[fg], eff[bg]);
      rows.push({ mode, fg, bg, ratio: Math.floor(ratio * 100) / 100, min, pass: ratio >= min });
    }
  }
  return rows;
}

/** Run on the FULLY MERGED theme, both modes (spec §11). Failures block a save; warnings advise. */
export function checkContrast(t: ResolvedTheme): { failures: ContrastFailure[]; warnings: StatusWarning[] } {
  const failures: ContrastFailure[] = contrastRows(t)
    .filter((r) => !r.pass)
    .map(({ mode, fg, bg, ratio, min }) => ({ mode, fg, bg, ratio, min }));
  const warnings: StatusWarning[] = [];
  for (const mode of THEME_MODES) {
    const themed: Array<[StatusWarning['field'], string | null]> = [
      ['brand', t.colors[mode].brand], ['accent', t.colors[mode].accent], ['wcAccent', t.wcAccent],
    ];
    for (const [field, value] of themed) {
      if (value === null) continue;
      const resembles = closestStatus(value, mode);
      if (resembles) warnings.push({ mode, field, resembles });
    }
  }
  return { failures, warnings };
}

// ── Labels (Commander's editor and the server's messages share one wording) ──

export const MODE_LABELS: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark' };

export const COLOR_LABELS: Record<keyof EffectiveColors, string> = {
  brand: 'Brand',
  accent: 'Accent',
  accentFg: 'Text on accent',
  surface: 'Page background',
  surfaceRaised: 'Panel background',
  text: 'Text',
  textMuted: 'Muted text',
  border: 'Border',
  headerBg: 'Header background',
  headerFg: 'Header text',
  focus: 'Focus ring',
  headerFgMuted: 'Muted header text',
  borderStrong: 'Strong border',
  headerAccent: 'Header accent',
  wcAccent: 'Work-center accent',
};

export function describeFailure(f: ContrastFailure): string {
  return `${MODE_LABELS[f.mode]} mode: ${COLOR_LABELS[f.fg]} on ${COLOR_LABELS[f.bg]} is ${f.ratio.toFixed(2)}:1 — needs ${f.min}:1`;
}

export function describeWarning(w: StatusWarning): string {
  return `${MODE_LABELS[w.mode]} mode: ${COLOR_LABELS[w.field]} resembles a status colour (${w.resembles})`;
}

// ── CSS and wire payload (spec §6.3, §13) ──

/** Identical to the first statement of MissionPilot/src/theme/tokens.css. The theme <style>
 *  can land in <head> BEFORE the bundle's CSS, and a layer's rank is fixed where its name
 *  first appears: without this statement first, pilot.theme would rank below
 *  pilot.defaults and every theme value would silently lose. */
export const LAYER_ORDER = '@layer pilot.defaults, pilot.theme, pilot.prefs, pilot.components;';

export const COLOR_TOKENS: Record<ColorKey, string> = {
  brand: '--pilot-brand', accent: '--pilot-accent', accentFg: '--pilot-accent-fg', surface: '--pilot-surface',
  surfaceRaised: '--pilot-surface-raised', text: '--pilot-text', textMuted: '--pilot-text-muted',
  border: '--pilot-border', headerBg: '--pilot-header-bg', headerFg: '--pilot-header-fg', focus: '--pilot-focus',
};

const decl = (name: string, value: string): string => `    ${name}: ${value};`;

/** The pilot.theme layer for a resolved theme. Values are parsed enums, fixed font stacks and
 *  #rrggbb colours only — the HEX_RE re-check is belt and braces for the style-injection rule. */
export function themeCss(t: ResolvedTheme): string {
  const root = [
    decl('--pilot-font-family', fontStack(t.font)),
    decl('--pilot-density-k', String(DENSITIES[t.density])),
    decl('--pilot-radius', RADII[t.radius]),
  ];
  if (t.wcAccent !== null && HEX_RE.test(t.wcAccent)) root.push(decl('--pilot-wc-accent', t.wcAccent));
  const blocks = [`  :root {\n${root.join('\n')}\n  }`];
  for (const mode of THEME_MODES) {
    const lines: string[] = [];
    for (const key of COLOR_KEYS) {
      const value = t.colors[mode][key];
      if (value !== null && HEX_RE.test(value)) lines.push(decl(COLOR_TOKENS[key], value));
    }
    if (lines.length > 0) blocks.push(`  :root[data-pilot-mode="${mode}"] {\n${lines.join('\n')}\n  }`);
  }
  return `${LAYER_ORDER}\n@layer pilot.theme {\n${blocks.join('\n')}\n}\n`;
}

/** What GET /api/theme returns and the Pilot caches as pilot:theme:last / pilot:theme:wc:<id>. */
export interface ThemePayload {
  rev: number;
  theme: ResolvedTheme;
  css: string;
  /** The @font-face family to preload (document.fonts.load), or null for the system stack. */
  fontFamily: string | null;
  /** <meta name="theme-color"> per mode: the resolved header background. */
  themeColor: Record<ThemeMode, string>;
  /** Set by the engine (rev + response hash): the Pilot's If-None-Match. Absent = refetch. */
  etag?: string;
}

export function themePayload(rev: number, t: ResolvedTheme): ThemePayload {
  return {
    rev,
    theme: t,
    css: themeCss(t),
    fontFamily: PILOT_FONTS[t.font].family,
    themeColor: { light: effectiveColors(t, 'light').headerBg, dark: effectiveColors(t, 'dark').headerBg },
  };
}

// ── Runtime fallback (spec §11, "site change that breaks a descendant override") ──

const AUTO_FOREGROUNDS: ReadonlySet<string> = new Set(['accentFg', 'headerFg', 'focus']);
/** Derived tokens are fixed by reverting the colour they come from. */
const SOURCE_OF: Partial<Record<keyof EffectiveColors, ColorKey>> = { headerFgMuted: 'headerFg', headerAccent: 'brand' };
/** accent follows brand when unset: reverting accent alone would leave the same colour. */
const ALSO_REVERT: Partial<Record<ColorKey, ColorKey>> = { accent: 'brand' };

const isColorKey = (k: string): k is ColorKey => (COLOR_KEYS as readonly string[]).includes(k);

function dropColor(layer: PilotTheme, mode: ThemeMode, key: ColorKey): PilotTheme {
  const set = layer.colors?.[mode];
  if (!set || set[key] == null) return layer;
  const nextSet: ColorSet = { ...set };
  delete nextSet[key];
  const colors: NonNullable<PilotTheme['colors']> = { ...(layer.colors ?? {}) };
  colors[mode] = nextSet;
  return { ...layer, colors };
}

function dropWcAccent(layer: PilotTheme): PilotTheme {
  if (layer.wcAccent == null) return layer;
  const next: PilotTheme = { ...layer };
  delete next.wcAccent;
  return next;
}

/**
 * Resolves site + work-center overrides (root first) for delivery. A merged theme that fails
 * §11 — because a site or ancestor change broke an override that passed when it was saved —
 * never ships: failing automatic foregrounds go back to automatic, other failing colours the
 * overrides set go back to the site's. The site layer was validated when it was saved, so a
 * foreground the SITE pins that now fails over an override's background is auto-picked too
 * (final review): reverting only the overrides would never fix it and would drop the work
 * center's whole branding.
 */
export function safeResolve(site: PilotTheme, overrides: readonly PilotTheme[]): ResolvedTheme {
  let base = site;
  let layers = [...overrides];
  for (let pass = 0; pass < 4; pass++) {
    const t = resolveTheme([base, ...layers]);
    const { failures } = checkContrast(t);
    if (failures.length === 0) return t;
    for (const f of failures) {
      const fg = SOURCE_OF[f.fg] ?? f.fg;
      const keys: string[] = AUTO_FOREGROUNDS.has(fg) ? [fg] : [fg, SOURCE_OF[f.bg] ?? f.bg];
      for (const k of keys) {
        if (k === 'wcAccent') {
          layers = layers.map(dropWcAccent);
          continue;
        }
        if (!isColorKey(k)) continue; // borderStrong is fixed
        if (AUTO_FOREGROUNDS.has(k)) base = dropColor(base, f.mode, k);
        layers = layers.map((l) => dropColor(l, f.mode, k));
        const also = ALSO_REVERT[k];
        if (also) layers = layers.map((l) => dropColor(l, f.mode, also));
      }
    }
  }
  return resolveTheme([site]);
}
