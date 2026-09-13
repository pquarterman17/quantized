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
import { distinguishabilityVerdict, linearToSrgb255, seriesDistinguishability, type Rgb } from "../lib/cvd";
import { PALETTES, type Palette } from "../lib/palettes";

// ---- OKLCH -> sRGB (see header note for provenance) -----------------------

/** OKLCH -> linear sRGB, UNCLAMPED (no gamma re-encode, no gamut clamp). A
 *  saturated OKLCH value can land outside the sRGB gamut (a negative or
 *  >1 component here) — kept as a separate step so the gamut-diagnostic
 *  test below can see the pre-clamp values `oklchToSrgb255` throws away. */
function oklchToLinearSrgb(l: number, c: number, hDeg: number): [number, number, number] {
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
  return [
    3.2409699419045226 * xyz[0] - 1.537383177570094 * xyz[1] - 0.4986107602930034 * xyz[2],
    -0.9692436362808796 * xyz[0] + 1.8759675015077202 * xyz[1] + 0.04155505740717559 * xyz[2],
    0.05563007969699366 * xyz[0] - 0.20397695888897652 * xyz[1] + 1.0569715142428786 * xyz[2],
  ];
}

// Re-encode through `cvd.ts`'s own `linearToSrgb255` (byte-identical sRGB
// transfer function) rather than a second, hand-duplicated copy of it — the
// two are read from the SAME implementation now, so a subtle divergence
// (e.g. the encode-exponent typo `cvd.test.ts` sabotages: `1/2.4` -> `1/2.2`)
// can't affect one and not the other silently.
function oklchToSrgb255(l: number, c: number, hDeg: number): Rgb {
  return oklchToLinearSrgb(l, c, hDeg).map(linearToSrgb255) as unknown as Rgb;
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
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

// ---- Known-answer pins for the OKLCH decoder itself -----------------------
//
// Everything above this point only checks that the decoder produced SOME
// valid-looking sRGB byte triple — a property a badly broken decoder (return
// grey for everything; treat the hue as radians instead of degrees) also
// satisfies. These pins check the decoder is actually RIGHT, against known
// answers independently verified against the CSS Color 4 spec's own
// reference conversion. Without these, the whole file's audit below can
// "fail as expected" for the wrong reason.
describe("oklchToSrgb255 known-answer pins", () => {
  it("decodes achromatic and single-hue reference values to their known hex", () => {
    expect(rgbToHex(oklchToSrgb255(0.5, 0, 0))).toBe("#636363");
    expect(rgbToHex(oklchToSrgb255(0.6, 0.15, 30))).toBe("#ca5747");
    expect(rgbToHex(oklchToSrgb255(0.7, 0.17, 295))).toBe("#a785fc"); // = --series-1, dark theme
  });

  it("decodes the real dark-theme --series-1..8 tokens to their known hex list", () => {
    expect(darkColors.map(rgbToHex)).toEqual([
      "#a785fc",
      "#04c5b5",
      "#eba941",
      "#f44f62",
      "#51c672",
      "#449df0",
      "#f7758a",
      "#d2bd70",
    ]);
  });

  it("decodes the real light-theme --series-1..8 tokens to their known hex list", () => {
    expect(lightColors.map(rgbToHex)).toEqual([
      "#7c54cd",
      "#009084",
      "#c78200",
      "#d7314b",
      "#25984d",
      "#006bcf",
      "#cf3452",
      "#9d8519",
    ]);
  });
});

// ---- Gamut diagnostic (not a regression gate) ------------------------------
//
// OKLCH can express colours outside the sRGB gamut; `oklchToSrgb255` clamps
// per-channel (via `linearToSrgb255`), which is NOT what CSS Color 4 §13.2
// specifies (a user agent gamut-maps by reducing chroma, holding lightness
// and hue). The two differ only for out-of-gamut tokens, of which the real
// stylesheet has exactly three, all in the LIGHT theme (dark theme's 8
// tokens are all in-gamut — checked below too). This is a diagnostic, not a
// bug fixed here: the tokens themselves may be the thing worth revisiting,
// which is why this pins WHICH tokens and by how much rather than papering
// over it with a closer approximation.
//
// Consequence for the headline numbers in the "THE CHECK THAT MATTERS"
// section below: the verdicts (pass/fail per condition) are unaffected, but
// two of the documented light-theme per-condition ΔE figures are
// clamp-dependent and would move under spec-correct gamut mapping (measured
// this review): protan 2.60 -> 2.98, and tritan 4.97 -> 6.14 with its worst
// pair changing from (series-2, series-5) to (series-4, series-7). Treat
// those two light-theme figures as approximate.
describe("OKLCH decoder gamut diagnostic", () => {
  const LIGHT_OKLCH: Array<[number, number, number]> = [
    [0.55, 0.18, 295],
    [0.58, 0.12, 185],
    [0.66, 0.15, 75],
    [0.58, 0.2, 18],
    [0.6, 0.15, 150],
    [0.53, 0.18, 252],
    [0.57, 0.19, 15],
    [0.62, 0.12, 95],
  ];
  const DARK_OKLCH: Array<[number, number, number]> = [
    [0.7, 0.17, 295],
    [0.74, 0.13, 185],
    [0.78, 0.14, 75],
    [0.66, 0.2, 18],
    [0.74, 0.16, 150],
    [0.68, 0.15, 250],
    [0.72, 0.16, 12],
    [0.8, 0.1, 95],
  ];
  const inGamut = (lin: readonly number[]) => lin.every((v) => v >= 0 && v <= 1);

  it("dark theme's tokens are all within the sRGB gamut before clamping", () => {
    for (const [l, c, h] of DARK_OKLCH) {
      expect(inGamut(oklchToLinearSrgb(l, c, h))).toBe(true);
    }
  });

  it("light theme has exactly three out-of-gamut tokens, series-2/3/6, at known unclamped values", () => {
    const unclamped = LIGHT_OKLCH.map(([l, c, h]) => oklchToLinearSrgb(l, c, h));
    const outOfGamut = unclamped.map((lin, i) => (inGamut(lin) ? null : i + 1)).filter((n): n is number => n !== null);
    expect(outOfGamut).toEqual([2, 3, 6]);

    const [s2, s3, s6] = [unclamped[1], unclamped[2], unclamped[5]];
    expect(s2[0]).toBeCloseTo(-0.0316, 3);
    expect(s2[1]).toBeCloseTo(0.2805, 3);
    expect(s3[2]).toBeCloseTo(-0.0151, 3);
    expect(s6[0]).toBeCloseTo(-0.015, 3);
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
//                protan worst = series-3 vs series-8,  ΔE ~2.60 (FAILS) [approximate, see gamut diagnostic below: ~2.98 under spec gamut mapping]
//                deutan worst = series-5 vs series-7,  ΔE ~1.98 (FAILS, global worst)
//                tritan worst = series-2 vs series-5,  ΔE ~4.97 (FAILS) [approximate: ~6.14 under spec gamut mapping, worst pair becomes series-4 vs series-7]
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

  // Floor tests (companions to the `it.fails` audits above, NOT `it.fails`
  // themselves): the audits above only ratchet in ONE direction — an
  // unexpected PASS fails the suite (a real fix must flip `it.fails` back to
  // `it`). Nothing above stops the palette getting WORSE while still
  // failing (e.g. two tokens made identical) — that would still be
  // "1 failed | 1 expected fail", indistinguishable in the test summary from
  // today's baseline. These floors fail loudly the moment the measured worst
  // ΔE drops below today's measured value, in either theme.
  it("dark theme has not regressed below today's measured worst pair (ΔE > 3.2)", () => {
    expect(distinguishabilityVerdict(darkColors, 10).worst.deltaE).toBeGreaterThan(3.2);
  });

  it("light theme has not regressed below today's measured worst pair (ΔE > 1.9)", () => {
    expect(distinguishabilityVerdict(lightColors, 10).worst.deltaE).toBeGreaterThan(1.9);
  });
});

// ---- Shipped palette presets (lib/palettes.ts) -----------------------------
//
// The audit above stops at the design-token DEFAULTS. `lib/palettes.ts`
// overrides the same `--series-1..8` tokens at runtime with four selectable
// presets, two labelled "CB-safe" — the actual remedy a user reaches for.
// They're plain hex (no OKLCH decoding needed) and were entirely outside the
// audit above. Table-driven so every preset is measured, not just the ones
// expected to pass.
//
// `okabe-ito` is the POSITIVE CONTROL for the distinguishability threshold
// (10): it is the one preset in this table that is both externally
// documented as colour-blind-safe AND independently designed (Okabe &
// Ito, 2008) with no knowledge of this repo's threshold. It clearing 10
// comfortably (worst ΔE ~14.9, deutan) is the strongest evidence in this
// suite that 10 is not an arbitrary number tuned to fail the shipped
// default and pass nothing else.
//
// `tol-bright`'s 8th slot used to duplicate the 1st (`#4477AA` twice) —
// literally zero ΔE under EVERY condition including normal vision, not just
// a CVD failure. Paul Tol's "bright" qualitative scheme defines only 7
// colours; there is no official 8th. Fixed here by borrowing `#332288`
// (indigo) from Tol's companion "muted" scheme for a distinct 8th hue,
// rather than reusing `#BBBBBB` (already slot 7) or any other in-list
// colour. Measured: the fix does not just stop the duplicate, the resulting
// 8-colour set clears threshold 10 too (worst ΔE ~13.2, tritan) — a SECOND
// passing CB-safe preset alongside `okabe-ito`.
//
// `tableau10` and `viridis` failing at 10 is RECORDED here, not fixed —
// neither claims to be CB-safe.
const PRESET_EXPECTATIONS: Record<string, boolean> = {
  "okabe-ito": true,
  "tol-bright": true,
  tableau10: false,
  viridis: false,
};

describe("shipped palette presets (lib/palettes.ts) under colour-vision deficiency", () => {
  const presetsWithColors = PALETTES.filter((p): p is Palette & { colors: string[] } => p.colors !== null);

  it("covers every non-default preset lib/palettes.ts actually ships", () => {
    // Guards the table above against a preset being added/renamed without
    // updating PRESET_EXPECTATIONS (a silently-skipped preset audits nothing).
    expect(presetsWithColors.map((p) => p.value).sort()).toEqual(Object.keys(PRESET_EXPECTATIONS).sort());
  });

  for (const preset of presetsWithColors) {
    const expectedOk = PRESET_EXPECTATIONS[preset.value];
    const label = expectedOk ? "PASSES" : "is recorded as FAILING (not fixed)";

    it(`${preset.value} ${label} distinguishabilityVerdict at threshold 10`, () => {
      const colors = preset.colors.slice(0, 8).map(hexToRgb);
      const verdict = distinguishabilityVerdict(colors, 10);
      const detail =
        `${preset.value} worst pair: series-${verdict.worst.i + 1} vs series-${verdict.worst.j + 1} ` +
        `under ${verdict.worst.kind}, deltaE=${verdict.worst.deltaE.toFixed(2)} (threshold 10)`;

      // Catches a literal duplicate hex in the 8-slot cycle (today's
      // pre-fix tol-bright bug: series-1 === series-8, ΔE 0 even under
      // normal vision) regardless of the CVD verdict below.
      const normalWorst = seriesDistinguishability(colors).normal;
      expect(normalWorst.deltaE, `${preset.value} normal-vision worst pair (${detail})`).toBeGreaterThan(0);

      expect(verdict.ok, detail).toBe(expectedOk);
    });
  }
});
