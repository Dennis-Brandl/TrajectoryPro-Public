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

// Colour math for the Pilot theme (spec 2026-10-09 §11): WCAG 2.x contrast, CSS
// `color-mix(in oklab, a p%, b)`, and OKLCH hue/chroma for the "resembles a status colour"
// warning. #rrggbb only — the theme format allows nothing else (§7). Pure (no drizzle) so
// Commander's editor and the Pilot's tests can import it. A line-for-line port of
// MissionPilot/src/theme/__tests__/color-math.ts: the Pilot's token tests and this module
// must round a mix to the same hex (MissionPilot theme-parity.test.ts compares them).

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

type Triple = [number, number, number];

function parse(hex: string): Triple {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab(hex: string): Triple {
  const [r0, g0, b0] = parse(hex);
  const r = toLinear(r0);
  const g = toLinear(g0);
  const b = toLinear(b0);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function channel(c: number): string {
  return Math.round(Math.min(1, Math.max(0, fromLinear(c))) * 255).toString(16).padStart(2, '0');
}

function fromOklab(L: number, a: number, b: number): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return '#'
    + channel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
    + channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
    + channel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}

/** `color-mix(in oklab, a <p*100>%, b)` */
export function mixOklab(a: string, b: string, p: number): string {
  const [aL, aA, aB] = toOklab(a);
  const [bL, bA, bB] = toOklab(b);
  return fromOklab(aL * p + bL * (1 - p), aA * p + bA * (1 - p), aB * p + bB * (1 - p));
}

function luminance(hex: string): number {
  const [r, g, b] = parse(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2.x contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** OKLCH lightness, chroma and hue (degrees, [0, 360)). */
export function oklch(hex: string): { l: number; c: number; h: number } {
  const [L, a, b] = toOklab(hex);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { l: L, c: Math.hypot(a, b), h: h < 0 ? h + 360 : h };
}

/** Angle between two hues, the shorter way round (0–180). */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
