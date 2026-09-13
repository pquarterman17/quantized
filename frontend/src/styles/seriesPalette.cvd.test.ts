// P3.3 accessibility audit — THE CHECK THAT MATTERS (PRIMARY_SOFTWARE_AUDIT_PLAN.md
// ~3459). `lib/contrastColor.ts` only ever checks a series colour against the plot
// BACKGROUND. This file is the missing series-vs-SERIES check: it decodes the
// actual `--series-1..8` design tokens (both themes) from the real stylesheet and
// runs them through `lib/cvd.ts`'s colour-vision-deficiency simulation.
//
// `plans/design/DESIGN_GUIDE.md` calls the palette "color-blind-aware" — a claim
// about palette CHOICE (the hues were picked with CVD confusion lines in mind).
// This test is the first thing that actually MEASURES it, on the tokens as
// shipped, not on a hand-picked demo swatch.
//
// Reads `styles/colors.css` as text (same technique as `reducedMotion.test.ts`)
// rather than rendering the app, so it exercises the real source of truth.
//
// WHY THIS DOESN'T REUSE `lib/color.ts`'s `resolveToHex`: that resolver paints a
// 1x1 canvas and reads the pixel back — exact in a real browser, but the `canvas`
// package this repo's tests run on (`node_modules/canvas`, a Cairo binding) does
// NOT implement CSS Color 4 `oklch()` parsing. Verified directly: setting
// `ctx.fillStyle = "oklch(0.7 0.17 295)"` after priming it to `"#000"` leaves
// `fillStyle` at `"#000000"` — the setter silently no-ops on a value it can't
// parse (per the CSS-value-setter spec: invalid assignments are ignored) instead
// of throwing, so a canvas-based decode of these OKLCH tokens under THIS test
// runner would silently and wrongly report every series colour as black. That
// would be worse than not testing at all. `oklchToSrgb255` below is a small,
// pure, canvas-free OKLCH decoder instead, transcribed from the CSS Color 4
// specification's own reference conversion code (a browser-oklch()-compatible
// implementation, not an approximation): OKLab<->LMS coefficients from Björn
// Ottosson's OKLab derivation, XYZ<->linear-sRGB from the standard IEC 61966-2-1
// primaries matrix (both reproduced verbatim in
// https://github.com/w3c/csswg-drafts/blob/main/css-color-4/conversions.js).
// This is CSS-token decoding, not CVD science, which is why it lives beside this
// test rather than inside `lib/cvd.ts` (kept to CVD simulation + colour distance).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDrawColor } from "../lib/contrastColor";
import { distinguishabilityVerdict, type Rgb } from "../lib/cvd";

// ---- OKLCH -> sRGB (see header note for provenance) -----------------------

function srgbEncode(linear: number): number {
  const sign = linear < 0 ? -1 : 1;
  const abs = Math.abs(linear);
  const encoded = abs > 0.0031308 ? sign * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055) : 12.92 * linear;
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
}

function oklchToSrgb255(l: number, c: number, hDeg: number): Rgb {
  const hRad = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);
  // OKLab -> (nonlinear) LMS. Coefficients: Björn Ottosson, "A perceptual
  // color space for image processing" (2020), as tabulated by the CSS
  // Color 4 spec's reference implementation.
  const lms = [
    l + 0.3963377773761749 * a + 0.2158037573099136 * b,
    l - 0.1055613458156586 * a - 0.0638541728258133 * b,
    l - 0.0894841775298119 * a - 1.2914855480194092 * b,
  ].map((v) => v ** 3);
  // LMS -> CIE XYZ (D65).
  const xyz = [
    1.2268798758459243 * lms[0] - 0.5578149944602171 * lms[1] + 0.2813910456659647 * lms[2],
    -0.0405757452148008 * lms[0] + 1.112286803280317 * lms[1] - 0.0717110580655164 * lms[2],
    -0.0763729366746601 * lms[0] - 0.4214933324022432 * lms[1] + 1.5869240198367816 * lms[2],
  ];
  // XYZ -> linear sRGB (IEC 61966-2-1 primaries matrix).
  const lin = [
    3.2409699419045226 * xyz[0] - 1.537383177570094 * xyz[1] - 0.4986107602930034 * xyz[2],
    -0.9692436362808796 * xyz[0] + 1.8759675015077202 * xyz[1] + 0.04155505740717559 * xyz[2],
    0.05563007969699366 * xyz[0] - 0.20397695888897652 * xyz[1] + 1.0569715142428786 * xyz[2],
  ];
  return lin.map(srgbEncode) as unknown as Rgb;
}

function rgbToHex([r, g, b]: Rgb): string {
  const h = (v: number) => v.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

// ---- Pull the real --series-1..8 tokens out of the real stylesheet --------

const css = readFileSync(join(__dirname, "colors.css"), "utf8");

/** Body of the first at-rule/selector block whose header contains `head`
 *  (same brace-walking technique as `reducedMotion.test.ts`). */
function blockAfter(source: string, head: string): string {
  const i = source.indexOf(head);
  if (i < 0) return "";
  const start = source.indexOf("{", i);
  let depth = 0;
  for (let j = start; j < source.length; j++) {
    if (source[j] === "{") depth++;
    else if (source[j] === "}") {
      depth--;
      if (depth === 0) return source.slice(start + 1, j);
    }
  }
  return "";
}

const SERIES_TOKEN = /--series-(\d+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g;

/** The 8 `--series-N` colours declared directly in `block`, in N order.
 *  Throws if the block doesn't declare exactly series-1..8 — a silent
 *  shorter/reordered list would make the audit below meaningless. */
function seriesColorsIn(block: string, blockName: string): Rgb[] {
  const found = new Map<number, Rgb>();
  for (const m of block.matchAll(SERIES_TOKEN)) {
    const n = Number(m[1]);
    found.set(n, oklchToSrgb255(Number(m[2]), Number(m[3]), Number(m[4])));
  }
  const missing = Array.from({ length: 8 }, (_, i) => i + 1).filter((n) => !found.has(n));
  if (missing.length > 0) {
    throw new Error(`${blockName}: missing --series-${missing.join(", --series-")} (found ${found.size}/8)`);
  }
  return Array.from({ length: 8 }, (_, i) => found.get(i + 1) as Rgb);
}

// First occurrence of each selector text is the BASE theme block (`:root,
// [data-theme="dark"] { ... }` and `[data-theme="light"] { ... }`) — the
// per-accent-scheme blocks further down only override `--series-1` and are
// deliberately out of scope here (see the plan note this test's failures
// are recorded against: auditing all 5 accent x 2 theme combinations is a
// combinatorial follow-up, not this slice).
const darkColors = seriesColorsIn(blockAfter(css, '[data-theme="dark"]'), '[data-theme="dark"]');
const lightColors = seriesColorsIn(blockAfter(css, '[data-theme="light"]'), '[data-theme="light"]');

describe("series palette tokens decode as expected", () => {
  it("finds exactly 8 valid sRGB colours per theme", () => {
    for (const colors of [darkColors, lightColors]) {
      expect(colors).toHaveLength(8);
      for (const [r, g, b] of colors) {
        for (const v of [r, g, b]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});

describe("series-vs-background legibility (regression guard)", () => {
  // Reuses the EXISTING contrastColor.ts check rather than duplicating its
  // luminance math: resolveDrawColor only substitutes a colour that fails
  // the series-vs-background contrast floor, so an unchanged round-trip
  // means every series colour is still legible against its own theme's
  // plot background — the invariant P3.3 already covers, kept unregressed.
  it("every dark-theme series colour is legible against the dark axes background", () => {
    for (const [i, rgb] of darkColors.entries()) {
      const hex = rgbToHex(rgb);
      expect(resolveDrawColor(hex, true), `series-${i + 1} (${hex}) on dark bg`).toBe(hex);
    }
  });

  it("every light-theme series colour is legible against the light axes background", () => {
    for (const [i, rgb] of lightColors.entries()) {
      const hex = rgbToHex(rgb);
      expect(resolveDrawColor(hex, false), `series-${i + 1} (${hex}) on light bg`).toBe(hex);
    }
  });
});

// ---- THE CHECK THAT MATTERS: series-vs-series distinguishability under CVD ----
//
// Measured (see commit body for the full per-simulation breakdown):
//   dark theme:  normal worst = series-4 vs series-7, ΔE ~19.18 (passes 10)
//                protan worst = series-5 vs series-8,  ΔE ~3.27 (FAILS)
//                deutan worst = series-1 vs series-6,  ΔE ~3.23 (FAILS, global worst)
//                tritan worst = series-2 vs series-5,  ΔE ~5.75 (FAILS)
//   light theme: normal worst = series-4 vs series-7, ΔE ~6.62  (FAILS)
//                protan worst = series-3 vs series-8,  ΔE ~2.60 (FAILS)
//                deutan worst = series-5 vs series-7,  ΔE ~1.98 (FAILS, global worst)
//                tritan worst = series-2 vs series-5,  ΔE ~4.97 (FAILS)
//
// The palette is design-owned (plans/design/DESIGN_GUIDE.md): this test does
// NOT change the palette and does NOT loosen the threshold to force a pass.
// It stays a documented, expected failure (`it.fails`) — an OPEN owner
// decision is recorded in PRIMARY_SOFTWARE_AUDIT_PLAN.md's P3.3 entry. If a
// future palette change makes one of these unexpectedly PASS, `it.fails`
// itself fails the suite, which is the intended ratchet: a genuine fix must
// be accompanied by flipping `it.fails` back to `it` here, not silently
// absorbed.
describe("series-vs-series distinguishability under colour-vision deficiency", () => {
  it.fails("dark theme's 8-series palette is distinguishable (min ΔE >= 10) under every simulation — OPEN, see PRIMARY_SOFTWARE_AUDIT_PLAN.md P3.3", () => {
    const verdict = distinguishabilityVerdict(darkColors, 10);
    expect(
      verdict.ok,
      `dark theme worst pair: series-${verdict.worst.i + 1} vs series-${verdict.worst.j + 1} ` +
        `under ${verdict.worst.kind}, deltaE=${verdict.worst.deltaE.toFixed(2)} (threshold 10)`,
    ).toBe(true);
  });

  it.fails("light theme's 8-series palette is distinguishable (min ΔE >= 10) under every simulation — OPEN, see PRIMARY_SOFTWARE_AUDIT_PLAN.md P3.3", () => {
    const verdict = distinguishabilityVerdict(lightColors, 10);
    expect(
      verdict.ok,
      `light theme worst pair: series-${verdict.worst.i + 1} vs series-${verdict.worst.j + 1} ` +
        `under ${verdict.worst.kind}, deltaE=${verdict.worst.deltaE.toFixed(2)} (threshold 10)`,
    ).toBe(true);
  });
});
