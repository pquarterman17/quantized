// The Publication preview's "Canvas" group (publication-figures audit #5),
// split out of PropertyPanels.tsx (400-line component ceiling).
//
// Page size: width / height / unit edit the SAME `PageSetup` the Page setup
// dialog and the Export dialog edit (lib/pageSizeFields.ts) — the figure's one
// source of truth for its size. Blank (no page yet) = the style preset's own
// size; typing a dimension creates the page from the 6 × 4 in default.
//
// Axes-box margins: explicit SUBPLOT fractions (`overrides.margins`), the
// hand placement of the axes box — distinct from Page setup's margins, which
// are outer padding around a tight layout (`page_pad`, audit B3).

import type { FigureOverrides } from "../../../lib/figureOverrides";
import { defaultPageSetup } from "../../../lib/pageGeometry";
import { convertPageUnit } from "../../../lib/pageSizeFields";
import { PAGE_UNITS, type PageSetup, type PageUnit } from "../../../lib/pagesetup";
import { Select } from "../../primitives";
import Num from "./PropertyNumberField";

export default function CanvasPanel({
  overrides,
  patch,
  pageSetup,
  setPageSetup,
}: {
  overrides: FigureOverrides;
  patch: (change: Partial<FigureOverrides>) => void;
  /** The previewed figure's page (null = the preset's size); absent hides
   *  the page-size fields (a caller with no page to edit). */
  pageSetup?: PageSetup | null;
  setPageSetup?: (next: PageSetup) => void;
}) {
  const ps = pageSetup ?? null;
  const setSide = (side: "width" | "height", value: number | undefined) => {
    if (!setPageSetup || value === undefined || !(value > 0)) return;
    setPageSetup({ ...(ps ?? defaultPageSetup()), [side]: value, aspectDerived: false });
  };
  return (
    <>
      {setPageSetup && (
        <>
          <Num label="page width" value={ps?.width} min={0} onValue={(v) => setSide("width", v)} />
          <Num label="page height" value={ps?.height} min={0} onValue={(v) => setSide("height", v)} />
          <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
            <label className="qzk-field-lbl">page unit</label>
            <Select
              aria-label="page unit"
              options={PAGE_UNITS.map((value) => ({ value, label: value }))}
              value={ps?.unit ?? "in"}
              onChange={(event) => setPageSetup(convertPageUnit(ps ?? defaultPageSetup(), event.target.value as PageUnit))}
            />
          </span>
          {!ps && <div className="qzk-ds-meta" style={{ width: "100%" }}>No page set: the style preset's size.</div>}
        </>
      )}
      <span className="qzk-field-lbl" style={{ width: "100%" }}>axes box margins (figure fraction)</span>
      <Num label="left" value={overrides.margins?.left} onValue={(left) => patch({ margins: { ...overrides.margins, left } })} />
      <Num label="right" value={overrides.margins?.right} onValue={(right) => patch({ margins: { ...overrides.margins, right } })} />
      <Num label="top" value={overrides.margins?.top} onValue={(top) => patch({ margins: { ...overrides.margins, top } })} />
      <Num label="bottom" value={overrides.margins?.bottom} onValue={(bottom) => patch({ margins: { ...overrides.margins, bottom } })} />
    </>
  );
}
