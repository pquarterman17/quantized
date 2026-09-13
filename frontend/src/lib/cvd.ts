// Colour-vision-deficiency (CVD) simulation + perceptual colour distance.
//
// WHY THIS EXISTS: `lib/contrastColor.ts` only ever checks a series colour
// against the plot BACKGROUND (legibility). Nothing in the app checks a
// series colour against OTHER series colours — the actual question a
// colour-blind reader asks ("can I tell curve 3 from curve 6?"). This module
// is that missing check: simulate what a dichromat sees, then measure
// perceptual distance in CIELAB. See PRIMARY_SOFTWARE_AUDIT_PLAN.md P3.3 for
// the audit that found the gap and `styles/seriesPalette.cvd.test.ts` for
// the design-token audit that consumes this module.
//
// Pure, DOM-free, canvas-free (unlike `lib/color.ts`'s `resolveToHex`) so it
// behaves identically in Node/vitest and the browser, and so it can run
// against plain `[r,g,b]` triples without needing a live CSS engine.
//
// SIMULATION MODEL — Machado, G. M., Oliveira, M. M., & Fernandes, L. A. F.
// (2009). "A Physiologically-based Model for Simulation of Color Vision
// Deficiency." IEEE Transactions on Visualization and Computer Graphics,
// 15(6), 1291-1298. doi:10.1109/TVCG.2009.113 — a stage-theory model derived
// from electrophysiological cone-fundamental data, the first to handle
// anomalous trichromacy and dichromacy consistently. `CVD_MATRICES` below
// are the paper's precomputed 100%-severity (full dichromacy) matrices —
// protanopia/deuteranopia/tritanopia — as tabulated in the author's own
// follow-up thesis (Machado, G. M. (2010). "A model for simulation of color
// vision deficiency and a color contrast enhancement technique for
// dichromats", pp. 1-94) and reproduced verbatim by the reference
// `colour-science` library (`colour.blindness.CVD_MATRICES_MACHADO2010`,
// BSD-3-Clause) — cross-checked against that source while porting these in.
// They are DERIVED, PUBLISHED CONSTANTS, not tunable knobs: do not "fix",
// round, or renormalize them to make a test pass (the repo's physics-
// constants convention, CLAUDE.md "Physics constants port verbatim").
//
// The matrices operate on LINEAR RGB (sRGB with the gamma decoded away,
// per IEC 61966-2-1) — cone response is linear in radiance, so applying
// them to gamma-encoded sRGB bytes directly would be physically wrong.
// `simulateCvd` decodes, transforms, and re-encodes.

/** An sRGB colour as [r, g, b] byte values, 0-255 (not necessarily integer
 *  on the way in; `simulateCvd`'s output is rounded). */
export type Rgb = readonly [number, number, number];

export type CvdKind = "protan" | "deutan" | "tritan";

/** sRGB (IEC 61966-2-1) transfer function, decode: gamma-encoded channel
 *  in [0,1] -> linear-light channel. */
function srgbToLinear(channel255: number): number {
  const c = channel255 / 255;
  const sign = c < 0 ? -1 : 1;
  const abs = Math.abs(c);
  return abs <= 0.04045 ? c / 12.92 : sign * Math.pow((abs + 0.055) / 1.055, 2.4);
}

/** sRGB transfer function, encode: linear-light channel -> gamma-encoded
 *  byte in [0,255], clamped (a CVD matrix can produce slightly out-of-gamut
 *  linear values for saturated inputs). */
function linearToSrgb255(linear: number): number {
  const sign = linear < 0 ? -1 : 1;
  const abs = Math.abs(linear);
  const encoded = abs > 0.0031308 ? sign * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055) : 12.92 * linear;
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
}

type Matrix3 = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

// Machado/Oliveira/Fernandes (2009) severity-1.0 dichromacy matrices, linear
// RGB in, linear RGB out. DO NOT "FIX" — see the header note. Row sums are
// ~1.0 by construction (an equal-RGB grey is preserved), with the ~1e-6
// residual coming from the published table's 6-decimal truncation, not a
// transcription error here (verified against `colour-science`'s
// `CVD_MATRICES_MACHADO2010["Protanomaly"/"Deuteranomaly"/"Tritanomaly"][1.0]`).
const CVD_MATRICES: Record<CvdKind, Matrix3> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** Simulate how an sRGB colour appears to a dichromat of the given kind
 *  (full-severity protanopia/deuteranopia/tritanopia). Decodes to linear
 *  RGB, applies the Machado 2009 matrix, re-encodes to sRGB bytes. */
export function simulateCvd(rgb: Rgb, kind: CvdKind): Rgb {
  const lin = rgb.map(srgbToLinear) as [number, number, number];
  const m = CVD_MATRICES[kind];
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = m[i][0] * lin[0] + m[i][1] * lin[1] + m[i][2] * lin[2];
  }
  return out.map(linearToSrgb255) as unknown as Rgb;
}

// ---- CIELAB + CIE76 ΔE ----------------------------------------------------
//
// CIE76 is the plain Euclidean distance in L*a*b* — chosen for SIMPLICITY
// (no chroma/hue weighting terms), not maximal perceptual accuracy.
// CIEDE2000 corrects known CIE76 non-uniformities (it under-weights chroma
// differences at high chroma and over-weights blue-hue differences), which
// would shift absolute ΔE numbers, particularly for saturated colours — but
// it would not flip today's palette verdicts (`seriesPalette.cvd.test.ts`)
// from pass to fail or vice versa: the failing pairs here fail by a wide
// margin (ΔE in the low single digits vs a threshold of 10), well past
// where a weighting correction of that size could matter. If a future,
// closer-to-threshold case needs the tighter metric, upgrade `deltaE` to
// CIEDE2000 rather than re-tuning the threshold.

// sRGB (D65) -> linear -> CIE XYZ, IEC 61966-2-1 matrix.
function rgbToXyz(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(srgbToLinear);
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  return [x, y, z];
}

// CIE standard D65 white point (2 degree observer), matching the sRGB
// primaries' own reference white (Bruce Lindbloom's reference values).
const D65_XN = 0.9504559270516716;
const D65_YN = 1.0;
const D65_ZN = 1.0890577507598784;

function labF(t: number): number {
  const delta = 6 / 29;
  return t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
}

/** sRGB -> CIE L*a*b* (D65). */
function rgbToLab(rgb: Rgb): [number, number, number] {
  const [x, y, z] = rgbToXyz(rgb);
  const fx = labF(x / D65_XN);
  const fy = labF(y / D65_YN);
  const fz = labF(z / D65_ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference (Euclidean distance in L*a*b*) between two sRGB
 *  colours. 0 for identical colours; black-vs-white is ~100. */
export function deltaE(rgbA: Rgb, rgbB: Rgb): number {
  const [l1, a1, b1] = rgbToLab(rgbA);
  const [l2, a2, b2] = rgbToLab(rgbB);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

/** The worst (minimum) pairwise ΔE across a list of colours, plus which
 *  pair it was. `i`/`j` are -1 with `deltaE: Infinity` for a list of fewer
 *  than 2 colours (vacuously fully distinguishable — nothing to confuse). */
export interface WorstPair {
  deltaE: number;
  i: number;
  j: number;
}

function worstPairwise(colors: readonly Rgb[]): WorstPair {
  let worst: WorstPair = { deltaE: Infinity, i: -1, j: -1 };
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const d = deltaE(colors[i], colors[j]);
      if (d < worst.deltaE) worst = { deltaE: d, i, j };
    }
  }
  return worst;
}

/** Series-vs-series distinguishability of a colour list under normal vision
 *  and under each of the three dichromacy simulations: the MIN pairwise ΔE
 *  (the closest, hardest-to-tell-apart pair) plus that pair's indices, for
 *  each of the four viewing conditions. A categorical palette is only as
 *  distinguishable as its worst pair, under its worst-case viewer. */
export interface SeriesDistinguishability {
  normal: WorstPair;
  protan: WorstPair;
  deutan: WorstPair;
  tritan: WorstPair;
}

export function seriesDistinguishability(colors: readonly Rgb[]): SeriesDistinguishability {
  return {
    normal: worstPairwise(colors),
    protan: worstPairwise(colors.map((c) => simulateCvd(c, "protan"))),
    deutan: worstPairwise(colors.map((c) => simulateCvd(c, "deutan"))),
    tritan: worstPairwise(colors.map((c) => simulateCvd(c, "tritan"))),
  };
}

// A CIE76 ΔE of ~2.3 is the commonly-cited "just noticeable difference"
// under ideal side-by-side viewing conditions (Mahy, Van Eycken & Oosterlinck,
// 1994, "Evaluation of uniform color spaces developed after the adoption of
// CIELAB and CIELUV", Color Research & Application 19(2), 105-121 — the
// figure widely reproduced as "1 JND ~ 2.3 dE76"). That is a bare-detection
// threshold for two swatches viewed side by side with time to compare; it is
// NOT a reasonable bar for "can a reader tell these two plotted line series
// apart at a glance" — thin strokes, brief glances, and simultaneous (not
// side-by-side-with-a-divider) viewing all raise the practical bar. Several
// qualitative-palette design references (e.g. the R `colorspace` package's
// palette-design guidance) recommend target separations closer to an order
// of magnitude above the raw JND for categorical palette entries. This
// module's default therefore requires ΔE >= 10 — comfortably above the JND
// floor, and the threshold used by `seriesPalette.cvd.test.ts`'s audit.
export const DEFAULT_DISTINGUISHABILITY_THRESHOLD = 10;

export interface DistinguishabilityVerdict {
  ok: boolean;
  worst: { kind: "normal" | CvdKind; i: number; j: number; deltaE: number };
}

/** Pass/fail verdict: is every viewing condition's worst pair at least
 *  `threshold` ΔE apart? `worst` names whichever of the four conditions
 *  (normal vision, or one CVD simulation) has the smallest such ΔE — the
 *  binding constraint for the whole palette. */
export function distinguishabilityVerdict(
  colors: readonly Rgb[],
  threshold: number = DEFAULT_DISTINGUISHABILITY_THRESHOLD,
): DistinguishabilityVerdict {
  const d = seriesDistinguishability(colors);
  const conditions: Array<["normal" | CvdKind, WorstPair]> = [
    ["normal", d.normal],
    ["protan", d.protan],
    ["deutan", d.deutan],
    ["tritan", d.tritan],
  ];
  let worst = conditions[0];
  for (const c of conditions) {
    if (c[1].deltaE < worst[1].deltaE) worst = c;
  }
  return {
    ok: worst[1].deltaE >= threshold,
    worst: { kind: worst[0], i: worst[1].i, j: worst[1].j, deltaE: worst[1].deltaE },
  };
}
