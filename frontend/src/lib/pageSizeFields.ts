// The page-size fields shared by the Export dialog and the Page setup dialog
// (publication-figures audit #5): ONE source of truth — the focused window's
// `pageSetup` — read into the fields and written back the same way by both
// dialogs (and by the Publication preview's Canvas group, which edits the same
// `PageSetup` object). Before this, only Page setup could size a figure, it
// opened at 6 × 4.5 in while an export without it used the preset's 6 × 4 in,
// and the Export dialog could not change the size at all.

import type { ParamField } from "./params";
import { fromInches, toInches } from "./pageGeometry";
import { DEFAULT_PAGE_HEIGHT_IN, DEFAULT_PAGE_WIDTH_IN, PAGE_UNITS, type PageSetup, type PageUnit } from "./pagesetup";

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Width / height / unit fields seeded from `ps`. With no page model
 *  (`ps` null) the dimensions start blank: blank = the style preset's own
 *  size, which is what an export without a page already uses. */
export function pageSizeFields(ps: PageSetup | null, hint?: string): ParamField[] {
  return [
    {
      key: "width",
      label: "Width",
      type: "number",
      default: ps ? r3(ps.width) : "",
      hint:
        hint ??
        (ps
          ? "page width, in the selected unit"
          : `blank = the style preset's size (Default: ${DEFAULT_PAGE_WIDTH_IN} × ${DEFAULT_PAGE_HEIGHT_IN} in)`),
      // Re-audit #15: a blank field shows the size it exports at (the Default
      // preset's, in inches -- the unit the field starts in).
      ...(ps ? {} : { placeholder: String(DEFAULT_PAGE_WIDTH_IN) }),
    },
    {
      key: "height",
      label: "Height",
      type: "number",
      default: ps ? r3(ps.height) : "",
      ...(ps ? {} : { placeholder: String(DEFAULT_PAGE_HEIGHT_IN) }),
    },
    { key: "unit", label: "Unit", type: "select", default: ps?.unit ?? "in", options: [...PAGE_UNITS] },
  ];
}

const positive = (x: unknown): number | null => {
  if (x === "" || x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The page `ps` becomes after the dialog's width/height/unit answers: both
 *  dimensions blank keeps `ps` as it is (null stays null — the preset size);
 *  a unit change with blank dimensions converts the existing page; a typed
 *  dimension replaces that side (the other side keeps its physical length).
 *  Editing a dimension clears `aspectDerived` (the user set a real size).
 *  `seed` supplies margins when there was no page yet. */
export function pageSetupFromFields(
  v: Record<string, unknown>,
  ps: PageSetup | null,
  seed: () => PageSetup,
): PageSetup | null {
  const unit: PageUnit = PAGE_UNITS.includes(v.unit as PageUnit) ? (v.unit as PageUnit) : (ps?.unit ?? "in");
  const width = positive(v.width);
  const height = positive(v.height);
  if (width === null && height === null) {
    if (!ps || ps.unit === unit) return ps;
    return convertPageUnit(ps, unit);
  }
  const base = ps ?? seed();
  const inUnit = (value: number, from: PageUnit) => fromInches(toInches(value, from), unit);
  const changed = ps === null || width !== r3(ps.width) || height !== r3(ps.height) || unit !== ps.unit;
  return {
    width: width ?? inUnit(base.width, base.unit),
    height: height ?? inUnit(base.height, base.unit),
    unit,
    margins: base.unit === unit ? base.margins : convertMargins(base, unit),
    aspectDerived: changed ? false : base.aspectDerived,
  };
}

function convertMargins(ps: PageSetup, unit: PageUnit): PageSetup["margins"] {
  const c = (v: number) => fromInches(toInches(v, ps.unit), unit);
  return { left: c(ps.margins.left), right: c(ps.margins.right), top: c(ps.margins.top), bottom: c(ps.margins.bottom) };
}

/** The same physical page expressed in `unit`. */
export function convertPageUnit(ps: PageSetup, unit: PageUnit): PageSetup {
  const c = (v: number) => fromInches(toInches(v, ps.unit), unit);
  return { ...ps, width: c(ps.width), height: c(ps.height), unit, margins: convertMargins(ps, unit) };
}
