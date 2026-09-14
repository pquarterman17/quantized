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

// ---- OKLab forward transform + deltaEOK (cvd_review2.md F2/F4) -----------
//
// `oklchToLinearSrgb` only goes OKLCH -> linear sRGB. Checking CSS Color 4
// §13.2's "does the clip pass the JND" step needs the reverse direction:
// linear sRGB -> OKLab, so a CLIPPED colour's OKLab can be compared (via
// deltaEOK, plain Euclidean distance in OKLab — the metric §13.2 itself
// specifies) against the UNCLIPPED origin's OKLab. The origin's own OKLab
// needs no conversion at all: OKLCH IS OKLab in polar form, so it's just
// (L, C·cosH, C·sinH).
//
// Built by inverting the SAME three matrices `oklchToLinearSrgb` already
// applies (OKLab->LMS', LMS->XYZ, XYZ->linear-sRGB), rather than
// re-transcribing an independently-sourced "standard" OKLab matrix from
// elsewhere — that keeps the two directions exact inverses of EACH OTHER
// (round-trip error ~1e-16 on an in-gamut token, asserted below) instead of
// merely both being individually correct to a handful of decimals.
type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

function invert3(m: Mat3): Mat3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const cof = [
    [e * i - f * h, -(d * i - f * g), d * h - e * g],
    [-(b * i - c * h), a * i - c * g, -(a * h - b * g)],
    [b * f - c * e, -(a * f - c * d), a * e - b * d],
  ];
  const det = a * cof[0][0] + b * cof[0][1] + c * cof[0][2];
  return [
    [cof[0][0] / det, cof[1][0] / det, cof[2][0] / det],
    [cof[0][1] / det, cof[1][1] / det, cof[2][1] / det],
    [cof[0][2] / det, cof[1][2] / det, cof[2][2] / det],
  ];
}

function mulVec3([r0, r1, r2]: Mat3, [x, y, z]: [number, number, number]): [number, number, number] {
  return [r0[0] * x + r0[1] * y + r0[2] * z, r1[0] * x + r1[1] * y + r1[2] * z, r2[0] * x + r2[1] * y + r2[2] * z];
}

// The exact matrices `oklchToLinearSrgb` above applies, isolated so they can
// be inverted rather than re-derived.
const OKLAB_TO_LMSPRIME: Mat3 = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
];
const LMS_TO_XYZ: Mat3 = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];
const XYZ_TO_LINSRGB: Mat3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const LMSPRIME_TO_OKLAB = invert3(OKLAB_TO_LMSPRIME);
const XYZ_TO_LMS = invert3(LMS_TO_XYZ);
const LINSRGB_TO_XYZ = invert3(XYZ_TO_LINSRGB);

/** Linear sRGB -> OKLab: the exact inverse of `oklchToLinearSrgb`'s
 *  OKLCH -> linear-sRGB path (see block comment above). */
function linearSrgbToOklab(rgb: readonly [number, number, number]): [number, number, number] {
  const xyz = mulVec3(LINSRGB_TO_XYZ, rgb as [number, number, number]);
  const lms = mulVec3(XYZ_TO_LMS, xyz);
  const lmsPrime = lms.map((v) => Math.cbrt(v)) as [number, number, number];
  return mulVec3(LMSPRIME_TO_OKLAB, lmsPrime);
}

/** OKLCH's own OKLab coordinates — no conversion needed, just polar->rect. */
function oklchToOklab(l: number, c: number, hDeg: number): [number, number, number] {
  const hRad = (hDeg * Math.PI) / 180;
  return [l, c * Math.cos(hRad), c * Math.sin(hRad)];
}

/** Euclidean distance in OKLab — the ΔE metric CSS Color 4 §13.2 itself uses
 *  for its 0.02 JND gate. Distinct from `lib/cvd.ts`'s `deltaE` (CIE76 in
 *  CIELAB, a different space) used for the CVD distinguishability audit
 *  below — the two are not interchangeable and are not compared to each
 *  other anywhere in this file. */
function deltaEOK(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
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
    expect(rgbToHex(oklchToSrgb255(1, 0, 0))).toBe("#ffffff"); // achromatic max-lightness edge (weak: clamps either way)
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
// per-channel (via `linearToSrgb255`). CSS Color 4 §13.2's actual gamut-
// mapping algorithm is more elaborate: clip the origin colour into the
// destination gamut, and if `deltaEOK(clip(origin), origin)` — Euclidean
// distance in OKLab, the metric §13.2 itself uses — is under the algorithm's
// own 0.02 "just noticeable difference" threshold, return that clip
// UNCHANGED; only past that JND does §13.2 fall back to a chroma-reduction
// binary search that holds lightness and hue fixed. (cvd_review2.md F2: an
// earlier version of this comment claimed the naive clamp was NOT what
// §13.2 specifies and that two headline figures below would move under
// spec-correct mapping — backwards. §13.2's own JND short-circuit is what
// applies here, not its binary-search fallback.)
//
// Measured below (`deltaEOK(clip, origin)`): series-2 = 0.0179, series-3 =
// 0.0111, series-6 = 0.0111 — all three clear the 0.02 JND (series-2 with
// the least room), so §13.2 returns the clip unchanged for every one of
// them. The naive per-channel clamp this file's decoder uses IS
// spec-equivalent here: the decoded hex list is identical either way, and
// NEITHER the pass/fail verdicts NOR the headline per-condition ΔE figures
// in "THE CHECK THAT MATTERS" below move. This is still a diagnostic, not a
// bug fixed here — the TOKENS themselves (not the decode) are the thing
// arguably worth revisiting, which is why this pins WHICH tokens and by how
// much rather than papering over it with a closer approximation.
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

    // All 9 unclamped components of the 3 out-of-gamut tokens (round 1 only
    // pinned 4 of the 9 — cvd_review2.md nit 2 — so a decoder bug touching
    // an unpinned component, e.g. s2[2] or s3[0], could pass silently).
    const [s2, s3, s6] = [unclamped[1], unclamped[2], unclamped[5]];
    expect(s2[0]).toBeCloseTo(-0.0316, 3);
    expect(s2[1]).toBeCloseTo(0.2805, 3);
    expect(s2[2]).toBeCloseTo(0.2291, 3);
    expect(s3[0]).toBeCloseTo(0.5681, 3);
    expect(s3[1]).toBeCloseTo(0.2228, 3);
    expect(s3[2]).toBeCloseTo(-0.0151, 3);
    expect(s6[0]).toBeCloseTo(-0.015, 3);
    expect(s6[1]).toBeCloseTo(0.1466, 3);
    expect(s6[2]).toBeCloseTo(0.6226, 3);
  });

  // cvd_review2.md F4: LIGHT_OKLCH/DARK_OKLCH above are literal copies of
  // colors.css's tokens, not parsed from it like darkColors/lightColors are
  // — so an edit to colors.css alone (leaving these literals stale) could
  // silently audit a palette the app no longer ships. This is the guard:
  // decode both literal lists through the same `oklchToSrgb255` the rest of
  // the file uses and require them to match the PARSED tokens exactly.
  it("LIGHT_OKLCH/DARK_OKLCH literals match the --series-1..8 tokens actually declared in colors.css", () => {
    expect(LIGHT_OKLCH.map(([l, c, h]) => rgbToHex(oklchToSrgb255(l, c, h)))).toEqual(lightColors.map(rgbToHex));
    expect(DARK_OKLCH.map(([l, c, h]) => rgbToHex(oklchToSrgb255(l, c, h)))).toEqual(darkColors.map(rgbToHex));
  });

  // cvd_review2.md F2: the JND check the block comment above describes,
  // made real. `linearSrgbToOklab` is the exact matrix inverse of
  // `oklchToLinearSrgb` (inverting the SAME three matrices it applies,
  // rather than re-transcribing an independently-sourced OKLab matrix) so
  // the two directions are numerically consistent with each other, not just
  // each independently correct to a handful of decimals.
  it("all three out-of-gamut light tokens clip within CSS Color 4 §13.2's 0.02 JND — the naive clamp is spec-equivalent here", () => {
    // Round-trip sanity on an in-gamut token: forward(inverse(x)) ~= x.
    const [l0, c0, h0] = LIGHT_OKLCH[0]; // series-1, in-gamut
    const roundTripped = linearSrgbToOklab(oklchToLinearSrgb(l0, c0, h0));
    expect(deltaEOK(roundTripped, oklchToOklab(l0, c0, h0))).toBeLessThan(1e-9);

    const JND = 0.02;
    const clipDeltaEOK = ([l, c, h]: [number, number, number]): number => {
      const clippedLin = oklchToLinearSrgb(l, c, h).map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
      return deltaEOK(linearSrgbToOklab(clippedLin), oklchToOklab(l, c, h));
    };
    const [s2, s3, s6] = [clipDeltaEOK(LIGHT_OKLCH[1]), clipDeltaEOK(LIGHT_OKLCH[2]), clipDeltaEOK(LIGHT_OKLCH[5])];
    expect(s2).toBeCloseTo(0.0179, 3);
    expect(s3).toBeCloseTo(0.0111, 3);
    expect(s6).toBeCloseTo(0.0111, 3);
    for (const d of [s2, s3, s6]) expect(d).toBeLessThan(JND);
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

  // cvd_review2.md F1: the SAME contrast-substitution risk applies to
  // `lib/palettes.ts`'s runtime PRESETS, not just the default theme tokens
  // checked above — `applyPalette` (palettes.ts) writes literal hex onto the
  // very `--series-N` custom properties `resolveDrawColor` reads at render
  // time (`uplotOpts.ts`), so a preset colour that fails MIN_CONTRAST on
  // dark is silently redrawn in the ink token while the legend (which does
  // not contrast-check — `PlotLegend.tsx`) still shows the declared hue.
  // That is exactly the bug this commit found and fixed in tol-bright's old
  // `#332288` 8th slot (contrast 1.54). Ratchet: every preset's declared hex
  // must either round-trip through `resolveDrawColor` unchanged, or be a
  // pre-existing, explicitly recorded substitution below — reverting
  // tol-bright's fix, or any other NEW substitution, fails this test.
  const DARK_LEGIBILITY_SUBSTITUTIONS: Record<string, number[]> = {
    "okabe-ito": [],
    "tol-bright": [],
    tableau10: [],
    // #482878 (slot 1) measures 1.65 contrast on the dark canvas, < the 2.2
    // floor — pre-existing, out of scope for this preset audit, RECORDED
    // here rather than fixed (see the "worst ΔE" note on the presets block
    // below for why that distinction matters).
    viridis: [0],
  };

  it("covers every non-default preset (guards the substitution table above against a silently-skipped preset)", () => {
    const withColors = PALETTES.filter((p): p is Palette & { colors: string[] } => p.colors !== null);
    expect(withColors.map((p) => p.value).sort()).toEqual(Object.keys(DARK_LEGIBILITY_SUBSTITUTIONS).sort());
  });

  it("every preset's declared hex is either legible on the dark canvas unchanged, or a recorded pre-existing substitution", () => {
    for (const preset of PALETTES) {
      if (!preset.colors) continue;
      const expectedSubstituted = new Set(DARK_LEGIBILITY_SUBSTITUTIONS[preset.value] ?? []);
      preset.colors.forEach((hex, i) => {
        const resolved = resolveDrawColor(hex, true);
        if (expectedSubstituted.has(i)) {
          expect(resolved, `${preset.value} series-${i + 1} (${hex}) expected to already be substituted on dark`).not.toBe(
            hex,
          );
        } else {
          expect(resolved, `${preset.value} series-${i + 1} (${hex}) on dark bg`).toBe(hex);
        }
      });
    }
  });

  // LIGHT-canvas twin of the dark ratchet above (2026-09-14). Same rationale:
  // `applyPalette` writes the SAME literal hex onto `--series-N` regardless of
  // which canvas background is in effect, and a per-window override
  // (`PlotBg`) can pin a window to the LIGHT axes background independent of
  // the app's global theme — so a preset colour illegible on light is just as
  // real a bug as one illegible on dark, and was previously unratcheted.
  //
  // MEASURED (via `resolveDrawColor(hex, false)` against the shipped presets
  // in `lib/palettes.ts`, contrast floor 2.2 — see `lib/contrastColor.ts`):
  //   okabe-ito:  slot 0 #E69F00 = 2.12, slot 1 #56B4E9 = 2.18,
  //               slot 3 #F0E442 = 1.25, slot 7 #BBBBBB = 1.81
  //   tol-bright: slot 3 #CCBB44 = 1.84, slot 4 #66CCEE = 1.73,
  //               slot 6 #BBBBBB = 1.81
  //   tableau10:  slot 3 #76B7B2 = 2.16, slot 5 #EDC948 = 1.52,
  //               slot 7 #FF9DA7 = 1.86
  //   viridis:    slot 6 #6DCD59 = 1.88, slot 7 #FDE725 = 1.19
  // All pre-existing (none of these presets' declared hex was changed by this
  // commit) and none newly introduced — recorded, not fixed, same as the
  // dark-canvas `viridis` slot 0 entry above. Matches the counts already
  // noted in the "Shipped palette presets" header comment below (4/3/3/2).
  const LIGHT_LEGIBILITY_SUBSTITUTIONS: Record<string, number[]> = {
    "okabe-ito": [0, 1, 3, 7],
    "tol-bright": [3, 4, 6],
    tableau10: [3, 5, 7],
    viridis: [6, 7],
  };

  it("covers every non-default preset (guards the light substitution table above against a silently-skipped preset)", () => {
    const withColors = PALETTES.filter((p): p is Palette & { colors: string[] } => p.colors !== null);
    expect(withColors.map((p) => p.value).sort()).toEqual(Object.keys(LIGHT_LEGIBILITY_SUBSTITUTIONS).sort());
  });

  it("every preset's declared hex is either legible on the light canvas unchanged, or a recorded pre-existing substitution", () => {
    for (const preset of PALETTES) {
      if (!preset.colors) continue;
      const expectedSubstituted = new Set(LIGHT_LEGIBILITY_SUBSTITUTIONS[preset.value] ?? []);
      preset.colors.forEach((hex, i) => {
        const resolved = resolveDrawColor(hex, false);
        if (expectedSubstituted.has(i)) {
          expect(
            resolved,
            `${preset.value} series-${i + 1} (${hex}) expected to already be substituted on light`,
          ).not.toBe(hex);
        } else {
          expect(resolved, `${preset.value} series-${i + 1} (${hex}) on light bg`).toBe(hex);
        }
      });
    }
  });

  // Sabotage guard: pins the two substitution tables above verbatim so a
  // silent addition (or removal) of an index on EITHER canvas — not caught by
  // the per-preset ratchets above, which only compare against whatever the
  // table currently says — fails loudly here instead of quietly widening (or
  // narrowing) what counts as "pre-existing".
  it("the recorded dark/light substitution lists are exactly today's documented sets (no silent growth)", () => {
    expect(DARK_LEGIBILITY_SUBSTITUTIONS).toEqual({
      "okabe-ito": [],
      "tol-bright": [],
      tableau10: [],
      viridis: [0],
    });
    expect(LIGHT_LEGIBILITY_SUBSTITUTIONS).toEqual({
      "okabe-ito": [0, 1, 3, 7],
      "tol-bright": [3, 4, 6],
      tableau10: [3, 5, 7],
      viridis: [6, 7],
    });
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
// (The light-theme protan/tritan figures above are exact, not approximate:
// the gamut diagnostic above measures that CSS Color 4 §13.2's own mapping
// returns the same clamped colours this decoder does for all three
// out-of-gamut light tokens, so nothing here would move under spec-correct
// gamut mapping — see that block's comment for the numbers.)
//
// The DEFAULT THEME TOKENS are design-owned (plans/design/DESIGN_GUIDE.md):
// this test does NOT change those tokens and does NOT loosen the threshold
// to force a pass. It stays a documented, expected failure (`it.fails`) — an
// OPEN owner decision is recorded in PRIMARY_SOFTWARE_AUDIT_PLAN.md's P3.3
// entry. If a future token change makes one of these unexpectedly PASS,
// `it.fails` itself fails the suite, which is the intended ratchet: a
// genuine fix must be accompanied by flipping `it.fails` back to `it` here,
// not silently absorbed. (This does NOT extend to `lib/palettes.ts`'s
// runtime PRESETS below — the tol-bright preset's 8th slot IS a hex changed
// by this same commit, on the design owner's behalf, to close a legibility
// bug; see PRIMARY_SOFTWARE_AUDIT_PLAN.md's P3.3 owner box.)
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
  //
  // Margins are thin by design (dark 3.227488 vs 3.2 = 0.9%; light 1.978157
  // vs 1.9 = 4.1%) — fine as a FLOOR (its job is to catch REGRESSION, not to
  // hold a comfortable buffer), but expect one of these to fail the first
  // time an unrelated token nudge shifts the worst pair by a few thousandths
  // — that is the floor doing its job, not a flake to chase.
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
// colours; there is no official 8th. First fix attempt borrowed `#332288`
// (indigo) from Tol's companion "muted" scheme — cvd_review2.md F1 caught
// that THIS repo's own dark-canvas legibility floor (`lib/contrastColor.ts`,
// MIN_CONTRAST 2.2) rejects it (measured contrast 1.54), so it would never
// actually render as the audited indigo — the legend and canvas would
// disagree. Slot 8 is `#999933` (Tol-muted olive) instead: contrast 6.21 on
// dark / 2.85 on light (both clear 2.2, see the legibility ratchet above),
// and — measured again after the swap — the distinguishability verdict is
// UNCHANGED: the global worst pair is still tritan (series-1, series-3),
// ΔE 13.20, because that pair never involves slot 8 either way. `#BBBBBB`
// isn't reused since it's already slot 7. This hex was picked to close a
// legibility bug, not ratified by the design owner — named in
// PRIMARY_SOFTWARE_AUDIT_PLAN.md's P3.3 owner box for that.
//
// `tableau10` and `viridis` failing at 10 is RECORDED here, not fixed —
// neither claims to be CB-safe.
//
// One honesty note (cvd_review2.md nit 5): every verdict below is measured
// on the DECLARED hex list, not on any actually-rendered plot. On the LIGHT
// canvas override specifically, `resolveDrawColor` already substitutes 3 of
// tol-bright's 8 declared colours, 4 of okabe-ito's, 3 of tableau10's, and 2
// of viridis's (pre-existing, out of scope for this slice — the dark-canvas
// case is covered by the ratchet in the describe block above). "Worst ΔE" is
// therefore a property of the PALETTE AS SPECIFIED, not a guarantee about
// what a light-mode viewer's eye actually receives.
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
