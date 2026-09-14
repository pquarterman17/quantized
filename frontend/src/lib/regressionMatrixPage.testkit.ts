// P4.2 canonical plot/project regression matrix — the MULTI-PANEL PAGE leg.
//
// A `PageDocument` reaches the user through the same three paths a single
// figure does, and each one has its own artifact:
//   SCREEN  — the Figure Page composer's grid. Its slot model is
//             `lib/pageDocumentActions.ts`'s `resolvePagePanel` (which figure
//             each slot shows, fail-closed on a dangling id) plus
//             `pagePanelLabels` (the "(a)"/"(b)" the composer prints). Those
//             two pure functions ARE what the composer renders from —
//             `components/workshops/figurepage/` calls nothing else to decide
//             placement or labels.
//   EXPORT  — the `FigurePageSpec` posted to `/api/export/figure-page`, built
//             by `components/workshops/figurepage/panelResolve.ts`'s
//             `buildPageSpecFromDocument` (Library "Export…"; the composer's
//             own export builds the identical shape from its session).
//   REOPEN  — the `PageDocument` that comes back out of
//             `serializeWorkspace` -> `parseWorkspace`.
//
// A panel's figure identity is compared as the referenced figure's NAME: it is
// the one identity all three legs carry (the export wire has no figure id, but
// `buildFigureSpecFromDocument` stems the panel's `filename` from
// `document.name`).

import type { FigurePageSpec } from "./api/figurePage";
import type { FigureDocument } from "./figureDocument";
import type { PageLabelFormat } from "./figurepage";
import type { PageDocument, PagePanel } from "./pageDocument";
import { pagePanelLabels, resolvePagePanel } from "./pageDocumentActions";
import type { CanonicalPage } from "./regressionMatrix.testkit";

function layoutOf(page: PageDocument): CanonicalPage["layout"] {
  return {
    linkX: page.layout.linkX,
    linkY: page.layout.linkY,
    rowGap: page.layout.rowGap,
    colGap: page.layout.colGap,
    alignLabels: page.layout.alignLabels,
    resizeMode: page.layout.resizeMode,
  };
}

/** The composer's own grid: which figure each slot resolves to, and the label
 *  it prints. A dangling reference resolves to "missing", which this projects
 *  as a `null` figure with a non-null id still in `label` position — the
 *  fail-closed contract, not an empty slot. */
export function projectScreenPage(page: PageDocument, figures: readonly FigureDocument[]): CanonicalPage {
  const labels = pagePanelLabels(page.panels, page.output.labelFormat);
  return {
    rows: page.rows,
    cols: page.cols,
    panels: page.panels.map((panel, i) => {
      const resolution = resolvePagePanel(panel, figures);
      return {
        row: Math.floor(i / page.cols),
        col: i % page.cols,
        label: panel.label,
        title: panel.title,
        figure: resolution.status === "ok" ? resolution.figure.name : null,
      };
    }),
    resolvedLabels: labels,
    layout: layoutOf(page),
  };
}

/** The wire payload. `buildPageSpecFromDocument` SKIPS an empty slot entirely,
 *  so the empty slots are re-inserted here by (row, col) — the placement the
 *  backend reconstructs from `row`/`col` is the thing being compared, not the
 *  array index. `label` is projected back to its override form (`undefined` on
 *  the wire = "let the renderer auto-label", i.e. a null override). */
export function projectExportPage(spec: FigurePageSpec): CanonicalPage {
  const slots: CanonicalPage["panels"] = Array.from(
    { length: spec.rows * spec.cols },
    (_unused, i) => ({
      row: Math.floor(i / spec.cols),
      col: i % spec.cols,
      label: null,
      title: null,
      figure: null,
    }),
  );
  // The same slot list in `PagePanel` shape, so the resolved label sequence
  // below is computed from the WIRE and nothing else (see `resolvedLabels`).
  // `figureId` here is only "is this slot filled?" for `pagePanelLabels`; the
  // wire carries no figure id, and the identity actually compared is the
  // `filename` stem placed in `panels[].figure`.
  const wireSlots: PagePanel[] = Array.from({ length: spec.rows * spec.cols }, () => ({
    figureId: null,
    label: null,
    title: null,
  }));
  for (const panel of spec.panels) {
    const i = panel.row * spec.cols + panel.col;
    if (i < 0 || i >= slots.length) continue;
    slots[i] = {
      row: panel.row,
      col: panel.col,
      label: panel.label ?? null,
      title: panel.title ?? null,
      figure: panel.figure.filename ?? null,
    };
    wireSlots[i] = {
      figureId: panel.figure.filename ?? `slot-${i}`,
      label: panel.label ?? null,
      title: panel.title ?? null,
    };
  }
  return {
    rows: spec.rows,
    cols: spec.cols,
    panels: slots,
    // The wire deliberately carries only the OVERRIDE labels; the auto "(a)"
    // sequence is the renderer's job, driven by `label_format`. This leg
    // therefore resolves the sequence from the WIRE'S OWN `label_format` and
    // `panels[].label`, never from the PageDocument the screen leg reads —
    // that is what makes the comparison evidence about the product.
    // (Corrected 2026-09-14: it used to call `pagePanelLabels(page.panels,
    // page.output.labelFormat)`, the screen leg's identical call on the screen
    // leg's identical input, so `spec.label_format` was read by no leg at all
    // and a wire that labelled every panel "(i)/(ii)/(iii)" still matched a
    // composer showing "(a)/(b)/(c)".)
    resolvedLabels: pagePanelLabels(wireSlots, (spec.label_format ?? "(a)") as PageLabelFormat),
    layout: {
      linkX: spec.link_x ?? false,
      linkY: spec.link_y ?? false,
      rowGap: spec.row_gap ?? null,
      colGap: spec.col_gap ?? null,
      alignLabels: spec.align_labels ?? false,
      resizeMode: spec.resize_mode ?? "constrained",
    },
  };
}

/** The reopened page. Deliberately the SAME projection as the screen leg,
 *  because the composer has no second model: it renders directly from the
 *  `PageDocument` (via `resolvePagePanel`/`pagePanelLabels`). What differs
 *  between the two legs is therefore the INPUT — an in-memory document and its
 *  figures versus the pair that came back out of `serializeWorkspace` ->
 *  `parseWorkspace` — which is precisely the persistence property this leg
 *  exists to assert. Stating that here rather than writing a second, cosmetically
 *  different projection that would only pretend to be independent evidence. */
export function projectReopenPage(page: PageDocument, figures: readonly FigureDocument[]): CanonicalPage {
  return projectScreenPage(page, figures);
}
