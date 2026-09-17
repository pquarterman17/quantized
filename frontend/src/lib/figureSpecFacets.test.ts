// BUG-014 (review round): the facet branch used to compose a panel series'
// finished string as `${relabelledLabel} (${unit})` from a request-local
// DataStruct copy whose labels had been overwritten with the user's renames —
// which is literally the bug BUG-014 is named after ("Loop 1" exported as
// "Loop 1 (au)"), surviving inside the one branch the original fix did not
// reach. These pin the rule the flat path and the canvas both use: a rename
// is the legend text VERBATIM, an un-renamed channel still gets its unit.
//
// The SCREEN half of the same fix is pinned in
// `components/Stage/MultiPanelStage.test.tsx` ("a legend rename reaches every
// facet panel's legend"), which asserts the label real `buildOpts` puts on the
// real uPlot options object. Two layers, same string.

import { describe, expect, it } from "vitest";

import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { buildFacetSpecs } from "./figureSpecFacets";
import { defaultPlotView } from "./plotview";
import type { Dataset, DataStruct } from "./types";

const data: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [1, 10, 100],
    [1, 20, 200],
    [2, 30, 300],
    [2, 40, 400],
  ],
  labels: ["batch", "Signal", "Other"],
  units: ["", "au", "au"],
  metadata: {},
};

const dataset: Dataset = { id: "d1", name: "scan.dat", data };

/** Every panel's first series' finished label, in panel order. */
const firstLabels = (specs: ReturnType<typeof buildFacetSpecs>): string[] =>
  (specs ?? []).map((f) => f.series[0].label);

describe("buildFacetSpecs — legend renames (BUG-014)", () => {
  it("composes an UN-renamed channel as 'label (unit)', unchanged", () => {
    const specs = buildFacetSpecs(data, 0, null, [1, 2], null, {});
    expect(specs).toHaveLength(2);
    expect(specs?.[0].series.map((s) => s.label)).toEqual(["Signal (au)", "Other (au)"]);
  });

  it("uses a rename VERBATIM in every panel — no unit re-appended", () => {
    const specs = buildFacetSpecs(data, 0, null, [1, 2], null, { 1: "Loop 1" });
    // The renamed channel loses the "(au)" the derived label would have had;
    // the channel beside it, untouched, keeps its own.
    expect(firstLabels(specs)).toEqual(["Loop 1", "Loop 1"]);
    expect(specs?.[0].series[1].label).toBe("Other (au)");
    // The exact string BUG-014 is named after must not appear anywhere.
    expect(JSON.stringify(specs)).not.toContain("Loop 1 (au)");
  });

  it("honours an EMPTY rename verbatim, matching the screen's `??` fallback", () => {
    const specs = buildFacetSpecs(data, 0, null, [1], null, { 1: "" });
    expect(firstLabels(specs)).toEqual(["", ""]);
  });

  it("leaves the caller's DataStruct untouched (no relabelled copy anywhere)", () => {
    buildFacetSpecs(data, 0, null, [1, 2], null, { 1: "Loop 1" });
    expect(data.labels).toEqual(["batch", "Signal", "Other"]);
  });

  it("keys renames by CHANNEL, not by series position", () => {
    // yKeys [2, 1] puts channel 2 first; only channel 1 is renamed, so the
    // rename must land on the SECOND series of each panel.
    const specs = buildFacetSpecs(data, 0, null, [2, 1], null, { 1: "Loop 1" });
    expect(specs?.[0].series.map((s) => s.label)).toEqual(["Other (au)", "Loop 1"]);
  });

  // Round 3: `sanitizePlotView` casts a restored `.dwk`'s `seriesLabels`
  // without validating its values, so a `null` can reach this function
  // despite the `Record<number, string>` type — the same runtime case
  // `figureSpecSeries.test.ts` pins directly on `seriesDisplayLabel`. A
  // facet panel ships a FINISHED string (no per-series field to defer the
  // resolution to), so this is the one place a `null` here could ship
  // `label: null` on the wire instead of degrading like every other leg.
  it("a null rename (a hand-edited document's `seriesLabels`) degrades to the derived label", () => {
    const specs = buildFacetSpecs(data, 0, null, [1, 2], null, {
      1: null as unknown as string,
    });
    expect(firstLabels(specs)).toEqual(["Signal (au)", "Signal (au)"]);
  });
});

describe("a faceted export request carries the rename through (end to end)", () => {
  const spec = (seriesLabels: Record<number, string>) =>
    buildFigureSpecFromDocument(
      createFigureDocument({
        id: "w1",
        name: "Faceted",
        datasetId: dataset.id,
        view: { ...defaultPlotView(), yKeys: [1, 2], seriesLabels },
        facetKey: 0,
      }),
      dataset,
      "device",
    );

  it("renders a renamed series as the rename alone in every facet panel", () => {
    const facets = spec({ 1: "Loop 1" }).facets;
    expect(facets).toHaveLength(2);
    expect(facets?.map((f) => f.series[0].label)).toEqual(["Loop 1", "Loop 1"]);
  });

  it("still ships the DATA's own labels and units on the wire dataset", () => {
    const built = spec({ 1: "Loop 1" });
    expect(built.dataset.labels).toEqual(["batch", "Signal", "Other"]);
    expect(built.dataset.units).toEqual(["", "au", "au"]);
  });

  it("is byte-identical to before when nothing is renamed", () => {
    expect(spec({}).facets?.map((f) => f.series.map((s) => s.label))).toEqual([
      ["Signal (au)", "Other (au)"],
      ["Signal (au)", "Other (au)"],
    ]);
  });
});
