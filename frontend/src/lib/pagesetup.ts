// Page-setup model + pure geometry (ORIGIN_FILE_DECODE_PLAN #54 Stage 2): a
// per-window physical page (width/height/unit + margins) for the spatial
// multi-panel "page" fit and for publication export: the model, the unit list
// and the `.dwk` sanitizer. The geometry (unit conversions, page aspect, the
// content rect, the aspect-honest prefill from a decoded Origin page size, the
// export size and margins) is in `lib/pageGeometry.ts`, which only lazy
// modules import (bundle diet slice 20). Pure: no store/DOM.
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

// A sensible publication default width; height is derived from the aspect.
export const DEFAULT_PAGE_WIDTH_IN = 6;

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
