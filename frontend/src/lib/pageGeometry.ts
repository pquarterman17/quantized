// Page-setup geometry: unit conversions, the default and decoded-aspect pages,
// and the export's page size and margin fractions. Split out of
// `lib/pagesetup.ts` (bundle diet slice 20, plans/BUNDLE_HEADROOM.md), which
// keeps the model, the unit list and the `.dwk` sanitizer the eager view
// sanitizer needs. Everything here serves the lazy Page Setup dialog, the
// Origin apply body and the figure export. Import it from this path, never
// re-exported through pagesetup.ts: a re-export keeps it in the parent's
// eager chunk (slice 18). See pagesetup.ts's header for the physical-units
// caveat that `pageSetupFromDecoded` honours.

import { DEFAULT_PAGE_WIDTH_IN, type PageMargins, type PageSetup, type PageUnit } from "./pagesetup";

const CM_PER_IN = 2.54;
// CSS reference DPI — the interactive "px" unit. Export converts to inches for
// matplotlib figsize, so the on-screen px<->in factor is presentation only.
const PX_PER_IN = 96;
const DEFAULT_MARGIN_IN = 0.5;

/** Convert a length in `unit` to inches (the export/canonical unit). */
export function toInches(value: number, unit: PageUnit): number {
  if (unit === "cm") return value / CM_PER_IN;
  if (unit === "px") return value / PX_PER_IN;
  return value;
}

/** Convert inches to `unit`. */
export function fromInches(inches: number, unit: PageUnit): number {
  if (unit === "cm") return inches * CM_PER_IN;
  if (unit === "px") return inches * PX_PER_IN;
  return inches;
}

/** Page aspect (width / height), unit-independent (both sides share a unit).
 *  null for a degenerate page. */
export function pageAspect(ps: Pick<PageSetup, "width" | "height">): number | null {
  return ps.width > 0 && ps.height > 0 ? ps.width / ps.height : null;
}

function defaultMargins(inches = DEFAULT_MARGIN_IN): PageMargins {
  return { left: inches, right: inches, top: inches, bottom: inches };
}

/** A neutral default page (US-letter-ish 4:3 at 6 in wide) — the seed when the
 *  user opens Page Setup on a window with no page model yet. Not aspect-derived
 *  (the user is defining it). */
export function defaultPageSetup(): PageSetup {
  return {
    width: DEFAULT_PAGE_WIDTH_IN,
    height: (DEFAULT_PAGE_WIDTH_IN * 3) / 4,
    unit: "in",
    margins: defaultMargins(),
    aspectDerived: false,
  };
}

/** Aspect-honest prefill from a decoded Origin page size (internal page units).
 *  Keeps the DECODED ASPECT, fixes width at a publication default, DERIVES the
 *  height, and flags `aspectDerived`. Returns null when the page is
 *  absent/degenerate (then the window has no page model and "page" fit falls
 *  back to "frames"). */
export function pageSetupFromDecoded(
  page: { width: number; height: number } | null | undefined,
): PageSetup | null {
  if (!page || !(page.width > 0) || !(page.height > 0)) return null;
  const aspect = page.width / page.height;
  return {
    width: DEFAULT_PAGE_WIDTH_IN,
    height: DEFAULT_PAGE_WIDTH_IN / aspect,
    unit: "in",
    margins: defaultMargins(),
    aspectDerived: true,
  };
}

/** The drawable content rect (page minus margins) as matplotlib subplotpars
 *  FRACTIONS — {left, right, bottom, top} in [0,1], measured from the
 *  bottom-left. Margins share the page unit, so each fraction is just
 *  margin/dimension (no unit conversion). Clamped so pathological margins
 *  can't invert the rect (min 5% content span kept). */
export function contentRectFractions(ps: PageSetup): {
  left: number;
  right: number;
  bottom: number;
  top: number;
} {
  const w = ps.width > 0 ? ps.width : 1;
  const h = ps.height > 0 ? ps.height : 1;
  const clampFrac = (v: number) => Math.min(0.475, Math.max(0, v));
  const ml = clampFrac(ps.margins.left / w);
  const mr = clampFrac(ps.margins.right / w);
  const mt = clampFrac(ps.margins.top / h);
  const mb = clampFrac(ps.margins.bottom / h);
  return { left: ml, right: 1 - mr, bottom: mb, top: 1 - mt };
}

/** The page size in INCHES (export/matplotlib figsize unit). */
export function pageSizeInches(ps: PageSetup): { width_in: number; height_in: number } {
  return { width_in: toInches(ps.width, ps.unit), height_in: toInches(ps.height, ps.unit) };
}

/** Each margin as a FRACTION of its page dimension, in the convention
 *  `calc.figure_overrides` expects for its `margins` override (left/bottom are
 *  the distance from that edge; right/top are the distance from the far edge —
 *  it subtracts them from 1 itself). Clamped so pathological margins can't
 *  invert the plotting rect. */
export function marginFractions(ps: PageSetup): PageMargins {
  const w = ps.width > 0 ? ps.width : 1;
  const h = ps.height > 0 ? ps.height : 1;
  const c = (v: number) => Math.min(0.475, Math.max(0, v));
  return {
    left: c(ps.margins.left / w),
    right: c(ps.margins.right / w),
    top: c(ps.margins.top / h),
    bottom: c(ps.margins.bottom / h),
  };
}
