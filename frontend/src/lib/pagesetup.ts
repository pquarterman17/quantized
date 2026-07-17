// Page-setup model + pure geometry (ORIGIN_FILE_DECODE_PLAN #54 Stage 2): a
// per-window physical page (width/height/unit + margins) for the spatial
// multi-panel "page" fit and for publication export. One coherent module —
// unit conversions, page aspect, the content rect (page minus margins), the
// aspect-honest prefill from a decoded Origin page size, and the `.dwk`
// sanitizer. Pure: numbers in -> numbers out, no store/DOM.
//
// IMPORTANT (physical-units honesty): Origin stores a graph page size in
// INTERNAL page units with NO proven mapping to cm/inch (see
// docs/origin_project_format.md — "page-unit box width" is a ratio anchor,
// never a physical length). So a page prefilled from a decoded figure keeps
// the decoded ASPECT but its absolute width/height are a DEFAULT we chose,
// flagged `aspectDerived` — the dialog states this; page-mode rendering only
// ever uses the aspect, so the fabricated absolute size never misleads.

export type PageUnit = "cm" | "in" | "px";

export interface PageMargins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PageSetup {
  width: number;
  height: number;
  unit: PageUnit;
  margins: PageMargins;
  /** True when width/height were DERIVED from a decoded page aspect (not a
   *  proven physical size). The dialog surfaces this; cleared once the user
   *  edits the dimensions themselves. */
  aspectDerived: boolean;
}

export const PAGE_UNITS: readonly PageUnit[] = ["cm", "in", "px"];

const CM_PER_IN = 2.54;
// CSS reference DPI — the interactive "px" unit. Export converts to inches for
// matplotlib figsize, so the on-screen px<->in factor is presentation only.
const PX_PER_IN = 96;
// A sensible publication default width; height is derived from the aspect.
const DEFAULT_PAGE_WIDTH_IN = 6;
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

const num = (v: unknown, d: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : d;

/** Validate a persisted / hand-edited PageSetup (drop back to null for a
 *  non-object; clamp each field). Never throws. Dimensions clamp positive;
 *  margins clamp non-negative; unit falls back to inches. */
export function sanitizePageSetup(v: unknown): PageSetup | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const unit = PAGE_UNITS.includes(o.unit as PageUnit) ? (o.unit as PageUnit) : "in";
  const width = Math.max(0.01, num(o.width, DEFAULT_PAGE_WIDTH_IN));
  const height = Math.max(0.01, num(o.height, (DEFAULT_PAGE_WIDTH_IN * 3) / 4));
  const m = (o.margins ?? {}) as Record<string, unknown>;
  const clampM = (x: unknown) => Math.max(0, num(x, 0));
  return {
    width,
    height,
    unit,
    margins: {
      left: clampM(m.left),
      right: clampM(m.right),
      top: clampM(m.top),
      bottom: clampM(m.bottom),
    },
    aspectDerived: o.aspectDerived === true,
  };
}
