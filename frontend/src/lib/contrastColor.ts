// Luminance-aware contrast substitution for literal (non-token) stroke/fill
// colours — the fix for "black lines on dark mode": Origin's default line
// colour is literal black, and a black stroke is invisible against our
// (always-dark-by-default) plot canvas; symmetrically, a literal white
// stroke is invisible against a LIGHT plot canvas (the per-window "graph
// page" override — see `lib/plotview.ts`'s `PlotBg`). Render-time only:
// callers never mutate a stored `SeriesStyle`/`RefLine`/`Annotation` colour,
// so light mode keeps a TRUE black line and a later theme/background switch
// re-resolves live (see `uplotOpts.ts`'s callers).
//
// An achromatic colour (black/white/grey) is swapped for the caller's ink
// token: researchers expect "the black curve" to stay black-ish/grey (just
// inverted for legibility). A chromatic colour keeps its hue and is only
// darkened (lightened on a dark canvas) until it reaches the threshold.
//
// Deliberately does NOT depend on canvas (unlike `lib/color.ts`'s
// `resolveToHex`, which paints a 1x1 canvas to resolve OKLCH design tokens)
// so this module behaves identically in jsdom unit tests and the real
// browser — it only needs to parse the literal colour forms instrument data
// actually carries (hex/rgb/hsl/a handful of basic names), not the full CSS
// colour grammar (design tokens are already resolved to concrete colours by
// the caller via `cssVar` before reaching here).

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX4 = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX8 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_FN =
  /^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i;
const HSL_FN =
  /^hsla?\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i;

/** CSS named colours plausible as a literal instrument/Origin line colour:
 *  achromatic + the CSS Level-1 basic keywords + a few commonly-authored
 *  extended greys. Not exhaustive by design — an unrecognized name falls
 *  through to "unparseable" (passthrough, never throws); design tokens are
 *  already resolved to hex/oklch/rgb by the caller before reaching here. */
const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  silver: [192, 192, 192],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  darkgray: [169, 169, 169],
  darkgrey: [169, 169, 169],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  red: [255, 0, 0],
  maroon: [128, 0, 0],
  green: [0, 128, 0],
  lime: [0, 255, 0],
  blue: [0, 0, 255],
  navy: [0, 0, 128],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  aqua: [0, 255, 255],
  magenta: [255, 0, 255],
  fuchsia: [255, 0, 255],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  brown: [165, 42, 42],
};

function pctOr255(v: string): number {
  return v.endsWith("%") ? (parseFloat(v) / 100) * 255 : parseFloat(v);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Parse a CSS colour string into [r,g,b] bytes (0-255), or null when this
 *  (deliberately narrow) parser doesn't recognize the form — an OKLCH/LAB/
 *  color-mix() token, an unlisted named colour, or plain garbage. Callers
 *  treat null as "can't evaluate, leave it alone" (see `resolveDrawColor`). */
export function parseColor(input: string): [number, number, number] | null {
  const c = input.trim();
  if (!c) return null;
  let m = HEX8.exec(c) || HEX6.exec(c);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  m = HEX4.exec(c) || HEX3.exec(c);
  if (m) return [parseInt(m[1] + m[1], 16), parseInt(m[2] + m[2], 16), parseInt(m[3] + m[3], 16)];
  m = RGB_FN.exec(c);
  if (m) return [pctOr255(m[1]), pctOr255(m[2]), pctOr255(m[3])];
  m = HSL_FN.exec(c);
  if (m) return hslToRgb(parseFloat(m[1]), parseFloat(m[2]) / 100, parseFloat(m[3]) / 100);
  const named = NAMED[c.toLowerCase()];
  return named ?? null;
}

/** WCAG relative luminance (0 = black, 1 = white) of an sRGB byte triple. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = Math.min(1, Math.max(0, v / 255));
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Canonical reference luminances for the two plot-background modes this
// resolver is ever asked about. NOT computed live from `--axes-bg` /
// `--axes-bg-light` (an OKLCH token this module deliberately can't parse) —
// the caller already knows which mode it's rendering (the window's
// EFFECTIVE background; see `PlotBg` in `lib/plotview.ts`), so a fixed
// reference keeps this module pure/deterministic and DOM-free. Values
// approximate the real tokens: `--axes-bg` (OKLCH 0.13 L, very dark) and
// `--axes-bg-light` (OKLCH 0.98 L, near-white).
const DARK_BG_LUMINANCE = 0.006;
const LIGHT_BG_LUMINANCE = 0.94;

/** WCAG-style contrast ratio (1 = identical, 21 = max black-vs-white). */
function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Below this, a literal colour reads as "the same colour as the
 *  background" at a glance — the Origin-black-line-on-our-dark-canvas bug.
 *  Deliberately stricter than WCAG AA body text (4.5:1) would suggest for
 *  SMALL text, but a 1-2px plot stroke over a grid needs less headroom than
 *  that, and "any perceptible line" is the actual bar here, not AA text
 *  compliance — 2.2 catches true black/white and near-black/near-white
 *  while leaving genuinely mid-toned colours (any hue at ~40-60% lightness)
 *  untouched in either mode. */
const MIN_CONTRAST = 2.2;

/** Fallback achromatic ink when a caller doesn't supply a live design-token
 *  value (e.g. a unit test, or a non-DOM caller) — approximates `--text` in
 *  the dark/light theme blocks (`styles/colors.css`). Production callers
 *  (`uplotOpts.ts`) always pass the live `cssVar`-resolved token instead, so
 *  a real theme swap re-resolves correctly. */
const DEFAULT_INK_ON_DARK = "#eef0f6";
const DEFAULT_INK_ON_LIGHT = "#1e1e26";

/** Below this channel spread (0-255) a colour is achromatic: it has no hue to
 *  keep, so it is swapped for the ink token (Origin's black on a dark canvas
 *  must read as the ordinary ink, as it always has). */
const ACHROMATIC_SPREAD = 12;

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (mx === R) h = ((G - B) / d) % 6;
  else if (mx === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Keep the hue and saturation of a chromatic colour that is too close to the
 *  background and move only its lightness: darker on a light canvas, lighter
 *  on a dark one. The limit is the most extreme lightness that still meets
 *  `MIN_CONTRAST` for this hue/saturation (found by bisection); the colour's
 *  lightness is then scaled toward that limit proportionally, not clamped to
 *  it, so two pale colours of one hue that differ in lightness stay distinct. */
function shiftKeepingHue(rgb: [number, number, number], isDarkBg: boolean, bgL: number): string {
  const [h, s, l] = rgbToHsl(rgb);
  const passes = (lt: number) => contrastRatio(relativeLuminance(hslToRgb(h, s, lt)), bgL) >= MIN_CONTRAST;
  // Light canvas: largest passing lightness (0 -> black always passes).
  // Dark canvas: smallest passing lightness (1 -> white always passes).
  let pass = isDarkBg ? 1 : 0;
  let fail = l;
  for (let i = 0; i < 24; i++) {
    const mid = (pass + fail) / 2;
    if (passes(mid)) pass = mid;
    else fail = mid;
  }
  const limit = pass;
  const out = isDarkBg ? 1 - (1 - l) * (1 - limit) : l * limit;
  return toHex(hslToRgb(h, s, out));
}

/** Resolve a literal draw colour for legibility against the plot's
 *  EFFECTIVE background. `isDarkBg` is a plain boolean the caller has
 *  already resolved from that window's effective mode (`theme`/`light`/
 *  `dark` — see `lib/plotview.ts`'s `PlotBg`) — NOT necessarily the app's
 *  global theme, since a per-window override can pin one window's canvas to
 *  a fixed background regardless of the surrounding chrome.
 *
 *  - `color` doesn't parse (an OKLCH design token, an unrecognized name,
 *    garbage) → passthrough unchanged. Design tokens are already resolved
 *    through `cssVar` by the caller before reaching this function; only a
 *    literal instrument colour this parser can't read should ever land
 *    here, and passthrough is the safe default for it too.
 *  - Contrast against the effective background is adequate → passthrough
 *    (mid-tones, saturated colours, anything already visible — including a
 *    literal true black against a LIGHT background, so light mode keeps
 *    real black lines).
 *  - Contrast is poor and the colour is achromatic (near-black-on-dark /
 *    near-white-on-light) → substitute `inkColor` (or the built-in
 *    fallback), so "the black curve" reads as the ordinary ink.
 *  - Contrast is poor and the colour is chromatic (#00FF00 or #FFFF80 on a
 *    light canvas) → keep its hue and saturation and darken it (lighten it
 *    on a dark canvas) just far enough to reach the contrast threshold;
 *    returned as `#rrggbb`. */
export function resolveDrawColor(color: string, isDarkBg: boolean, inkColor?: string): string {
  const rgb = parseColor(color);
  if (!rgb) return color;
  const fgL = relativeLuminance(rgb);
  const bgL = isDarkBg ? DARK_BG_LUMINANCE : LIGHT_BG_LUMINANCE;
  if (contrastRatio(fgL, bgL) >= MIN_CONTRAST) return color;
  if (Math.max(...rgb) - Math.min(...rgb) >= ACHROMATIC_SPREAD) return shiftKeepingHue(rgb, isDarkBg, bgL);
  return inkColor || (isDarkBg ? DEFAULT_INK_ON_DARK : DEFAULT_INK_ON_LIGHT);
}
