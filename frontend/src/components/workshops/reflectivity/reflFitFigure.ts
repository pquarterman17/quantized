// Reflectivity fit — the FIGURE TEMPLATE (P2.2): a fit's data + model,
// residual and SLD panels as editable figures (lib/figureDocument.ts) laid
// out on one Figure Page (lib/pageDocument.ts), ready to style and export
// through the existing vector path. Pure: no React, no store.
//
// The figures are LIVE documents bound by id to the datasets "Add fit curves"
// makes (reflFitCurves.ts `curveDatasets`: per channel R, R fit and — when the
// residuals are known — residual; per spin an SLD profile), so nothing is
// copied here. Layout: one column per channel (a PNR pair side by side), rows
// R(Q) / residuals / SLD. Every Q panel carries the SAME x limits — the union
// of the fitted Q ranges — so data, model and residuals share one Q axis on
// the page as they do in the workshop; the SLD row keeps its own depth axis.
// A fit whose residuals are unknown (reflFitResiduals.ts) gets no residual row.

import { createFigureDocument, type FigureDocument } from "../../../lib/figureDocument";
import {
  DEFAULT_LAYOUT,
  DEFAULT_OUTPUT,
  emptyPagePanels,
  PAGE_DOCUMENT_SCHEMA,
  PAGE_DOCUMENT_VERSION,
  type PageDocument,
  type PagePanel,
} from "../../../lib/pageDocument";
import { defaultPlotView } from "../../../lib/plotview";
import type { PlotView } from "../../../lib/plotview";
import type { CurvesLike } from "./reflFitCurves";
import type { Weighting } from "./reflFitData";
import { channelResiduals, residualUnit } from "./reflFitResiduals";

export interface FigureSources {
  /** The fit-curve dataset ids in `curveDatasets`' order: one per channel,
   *  then one per SLD profile. */
  ids: readonly string[];
  curves: CurvesLike;
  weighting: Weighting;
  /** The name the figures and page are called after ("<data> — refl fit #n"). */
  base: string;
}

export interface FigureIdSource {
  figure: () => string;
  page: string;
  now: string;
}

const POINTS = { marker: true, width: 0 } as const;
const Q_LABEL = "Q (Å⁻¹)";

function view(patch: Partial<PlotView>): PlotView {
  return { ...defaultPlotView(), ...patch };
}

export function reflFitFigurePage(src: FigureSources, mint: FigureIdSource): { figures: FigureDocument[]; page: PageDocument } {
  const { curves, weighting, base } = src;
  const chans = curves.channels;
  const many = chans.length > 1;
  const suffix = (spin: string | null, i: number) => (many ? ` (${spin ?? `channel ${i + 1}`})` : "");
  const qs = chans.flatMap((c) => c.q);
  const xLim: [number, number] | null = qs.length ? [Math.min(...qs), Math.max(...qs)] : null;
  const figures: FigureDocument[] = [];
  const make = (datasetId: string, name: string, v: PlotView): string => {
    const doc = createFigureDocument({ id: mint.figure(), name, datasetId, view: v });
    figures.push(doc);
    return doc.id;
  };

  const rRow = chans.map((c, i) =>
    make(
      src.ids[i],
      `${base} R(Q)${suffix(c.spin, i)}`,
      view({
        yKeys: [0, 1],
        yScale: "log",
        xLim,
        xAxisLabel: Q_LABEL,
        yAxisLabel: "R",
        seriesStyles: { 0: { ...POINTS } },
        seriesLabels: { 0: "data", 1: "model" },
      }),
    ),
  );
  const withResiduals = chans.length > 0 && chans.every((c) => channelResiduals(c, weighting) !== null);
  const residualRow = withResiduals
    ? chans.map((c, i) =>
        make(
          src.ids[i],
          `${base} residuals${suffix(c.spin, i)}`,
          view({
            yKeys: [2],
            xLim,
            xAxisLabel: Q_LABEL,
            yAxisLabel: `residual (${residualUnit(weighting)})`,
            refLines: [{ id: "zero", axis: "y", value: 0 }],
            seriesStyles: { 2: { ...POINTS } },
            showLegend: false,
          }),
        ),
      )
    : [];
  const manySld = curves.sld.length > 1;
  const sldRow = curves.sld.map((p, j) =>
    make(
      src.ids[chans.length + j],
      `${base} SLD${manySld ? ` (${p.spin ?? j + 1})` : ""}`,
      view({ yKeys: [0], xAxisLabel: "z (Å)", yAxisLabel: "SLD (Å⁻²)", showLegend: false }),
    ),
  );

  const rows = [rRow, residualRow, sldRow].filter((row) => row.length > 0);
  const cols = Math.max(1, ...rows.map((row) => row.length));
  const panels: PagePanel[] = emptyPagePanels(Math.max(1, rows.length), cols);
  rows.forEach((row, r) => row.forEach((figureId, c) => (panels[r * cols + c] = { figureId, label: null, title: null })));
  const page: PageDocument = {
    schema: PAGE_DOCUMENT_SCHEMA,
    version: PAGE_DOCUMENT_VERSION,
    id: mint.page,
    name: `${base} — fit figure`,
    rows: Math.max(1, rows.length),
    cols,
    panels,
    output: { ...DEFAULT_OUTPUT },
    layout: { ...DEFAULT_LAYOUT, alignLabels: true },
    createdAt: mint.now,
    modifiedAt: mint.now,
  };
  return { figures, page };
}
