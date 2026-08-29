import { describe, expect, it } from "vitest";

import { createFigureDocument, type FigureDocument } from "./figureDocument";
import { resetFigureDocumentForReshape } from "./figureDocumentReimport";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { defaultPlotView } from "./plotview";
import type { DataStruct, Dataset } from "./types";

function doc(overrides: Parameters<typeof createFigureDocument>[0]["view"] = defaultPlotView()): FigureDocument {
  return createFigureDocument({
    id: "fig-1",
    name: "Figure",
    datasetId: "d1",
    view: overrides,
    groupKey: 4,
    facetKey: 5,
  });
}

describe("resetFigureDocumentForReshape", () => {
  it("clears xKey/yKeys/y2Keys, errors, and every channel-indexed view field", () => {
    const source = doc({
      ...defaultPlotView(),
      xKey: 0,
      yKeys: [1, 5],
      y2Keys: [0],
      seriesOrder: [0, 1, 5],
      hiddenChannels: [5],
      seriesStyles: { 0: { color: "#ff0000" }, 5: { color: "#00ff00" } },
      seriesLabels: { 5: "stale" },
      xLim: [0, 1],
      yLim: [0, 1],
      xStep: 0.1,
      yStep: 0.1,
      y2Lim: [0, 1],
      y2Scale: "log",
      y2Step: 0.1,
      y2AxisLabel: "y2",
    });

    const reset = resetFigureDocumentForReshape(source);

    expect(reset.bindings.xKey).toBeNull();
    expect(reset.bindings.yKeys).toBeNull();
    expect(reset.bindings.y2Keys).toBeNull();
    expect(reset.bindings.errors).toEqual([]);
    expect(reset.plot.view.seriesOrder).toBeNull();
    expect(reset.plot.view.hiddenChannels).toEqual([]);
    expect(reset.plot.view.seriesStyles).toEqual({});
    expect(reset.plot.view.seriesLabels).toEqual({});
    expect(reset.plot.view.xLim).toBeNull();
    expect(reset.plot.view.yLim).toBeNull();
    expect(reset.plot.view.xStep).toBeNull();
    expect(reset.plot.view.yStep).toBeNull();
    expect(reset.plot.view.y2Lim).toBeNull();
    expect(reset.plot.view.y2Scale).toBeNull();
    expect(reset.plot.view.y2Step).toBeNull();
    expect(reset.plot.view.y2AxisLabel).toBe("");
  });

  // The gate lives at the CALL SITE (`reimportColumnsChanged`): an in-range
  // index is not proof its column still means the same thing after a
  // column-count change, so the helper never second-guesses the caller.
  it("resets even when every index is in range — in-range is not proof of freshness", () => {
    const source = doc({
      ...defaultPlotView(),
      xKey: 0,
      yKeys: [1],
      seriesStyles: { 0: { color: "#ff0000" } },
    });

    const reset = resetFigureDocumentForReshape(source);

    expect(reset).not.toBe(source);
    expect(reset.bindings.yKeys).toBeNull();
    expect(reset.plot.view.seriesStyles).toEqual({});
  });

  // PR M booked finding (G5 canonical-state review): groupKey/facetKey now
  // clear like every other channel-indexed binding — a stale groupKey used
  // to reach the backend as FigureSpec.group_col and raise a raw ValueError
  // instead of a clear message (lib/figureSpec.ts, calc/plotting.py).
  it("clears groupKey/facetKey on a column reshape (PR M booked finding)", () => {
    const source = doc({ ...defaultPlotView(), yKeys: [5] });

    const reset = resetFigureDocumentForReshape(source);

    expect(reset.bindings.groupKey).toBeNull();
    expect(reset.bindings.facetKey).toBeNull();
  });

  it("preserves non-channel-indexed state (name, output, publication, data mode)", () => {
    const source: FigureDocument = {
      ...doc({ ...defaultPlotView(), yKeys: [2], plotTitle: "Kept" }),
      publication: { overrides: { grid: true } },
    };

    const reset = resetFigureDocumentForReshape(source);

    expect(reset.name).toBe("Figure");
    expect(reset.plot.view.plotTitle).toBe("Kept");
    expect(reset.publication).toEqual({ overrides: { grid: true } });
    expect(reset.data).toEqual(source.data);
  });

  it("clones rather than mutates — the source document is unchanged after a reset", () => {
    const source = doc({ ...defaultPlotView(), yKeys: [5], hiddenChannels: [5] });
    const snapshot = structuredClone(source);

    resetFigureDocumentForReshape(source);

    expect(source).toEqual(snapshot);
  });

  // SILENT_STATE_CORRUPTION_PLAN #9: `document.publication.seriesStyles` is a
  // POSITIONAL `(ExportSeriesStyle | null)[]` that WINS over every
  // channel-indexed field this function already resets (lib/figureSpec.ts's
  // buildFigureSpecFromDocument: `extras.publicationSeriesStyles === undefined`
  // is the ONLY branch that falls back to deriving styles fresh from the
  // view). Left behind, it survives a reshape verbatim while the plotted set
  // it was built for changes size and meaning.
  it("clears publication.seriesStyles (positional, wins over the view at export) on a reshape reset", () => {
    const source: FigureDocument = {
      ...doc({ ...defaultPlotView(), yKeys: [1] }),
      publication: { overrides: { grid: true }, seriesStyles: [{ color: "#ff0000" }] },
    };

    const reset = resetFigureDocumentForReshape(source);

    expect(reset.publication?.seriesStyles).toBeUndefined();
    // The sibling positional-only publication field (F1's raw backend
    // overrides) has no per-channel index of its own (grid/margins/ticks/
    // annotations use fixed axes coordinates, never a channel position) —
    // audited, not a second instance of this bug — so it survives untouched.
    expect(reset.publication?.overrides).toEqual({ grid: true });
  });

  // End-to-end: after the reset widens the plotted set (F1's saved
  // one-channel figure -> both surviving channels), the stale one-entry
  // array must not survive at all — not verbatim (wrong length vs the new
  // y_keys), and not misaligned onto the newly-widened channel 0 the way it
  // did before this fix (channel 0, "temp", inherited the array's ONLY
  // entry — the red the user picked for "moment" — while "moment" itself,
  // now at position 1, had no entry). Cleared to `undefined`, export derives
  // fresh per-channel styles from `plot.view.seriesStyles`, which this same
  // reset already clears to `{}` (SAME chokepoint `buildExportStyles` uses
  // when `document.publication` carries no override at all).
  it("an exported reshaped figure no longer paints a surviving channel with the stale positional style", () => {
    const before: DataStruct = {
      time: [1, 2, 3],
      values: [[10, 100, 1000], [20, 200, 2000], [30, 300, 3000]],
      labels: ["temp", "moment", "field"],
      units: ["K", "emu", "Oe"],
      metadata: {},
    };
    const after: DataStruct = {
      time: [1, 2, 3],
      values: [[10, 100], [20, 200], [30, 300]],
      labels: ["temp", "moment"],
      units: ["K", "emu"],
      metadata: {},
    };
    const document = createFigureDocument({
      id: "f1",
      name: "fig",
      datasetId: "d1",
      view: { ...defaultPlotView(), xKey: null, yKeys: [1] },
      publication: { overrides: null, seriesStyles: [{ color: "#ff0000" }] },
    });
    const dsBefore: Dataset = { id: "d1", name: "s", data: before };
    const specBefore = buildFigureSpecFromDocument(document, dsBefore, "fig");
    expect(specBefore.series_styles).toEqual([{ color: "#ff0000" }]);
    expect(specBefore.y_keys).toEqual([1]);

    const reset = resetFigureDocumentForReshape(document);
    const dsAfter: Dataset = { id: "d1", name: "s", data: after };
    const specAfter = buildFigureSpecFromDocument(reset, dsAfter, "fig");

    expect(specAfter.y_keys).toEqual([0, 1]);
    // One entry per plotted channel now (the length-mismatch the bug left
    // behind — one style for two channels — is itself gone)...
    expect(specAfter.series_styles).toHaveLength(2);
    // ...and the user's red never lands on "temp" (channel 0) or anywhere
    // else — it derives fresh from the (also-reset) view instead of
    // replaying the stale document.publication array.
    expect(specAfter.series_styles).not.toContainEqual({ color: "#ff0000" });
  });
});
