// P1.4 residual 3: the Stage's xy FACET grid draws the window's Color / Symbol
// / Label — the same series, colours, glyphs and legend text the committed wire
// fixture (`tests/fixtures/wire/graph_encoding_facets.json`) records as the
// screen and the backend reads back from the export. uPlot is mocked to a
// recorder (as in MultiPanelStage.test.tsx), so this asserts what the real
// `buildOpts` puts on each panel's options.

import { render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { facetCompositionFromBinding } from "../../lib/facet";
import type { FigureEncoding } from "../../lib/plotEncodingBinding";
import { defaultPlotView } from "../../lib/plotview";
import { SERIES_VARS } from "../../lib/seriesStyleCycle";
import type { Dataset } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import { withFocusedEncoding } from "../../store/windowDocuments";
import { BackgroundStackWindow } from "../windows/BackgroundAltModes";
import RealMultiPanelStage from "./MultiPanelStage";
import { useEffectiveComposition } from "./useEffectiveComposition";

function MultiPanelStage() {
  const active = useActiveDataset();
  return <RealMultiPanelStage composition={useEffectiveComposition(active)} />;
}

const { created, MockUPlot } = vi.hoisted(() => {
  const created: { opts: { series: { label?: string; stroke?: unknown }[] } }[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(opts: { series: { label?: string }[] }) {
      created.push({ opts });
    }
    destroy(): void {}
    setSize(): void {}
    setScale(): void {}
  }
  return { created, MockUPlot };
});
vi.mock("uplot", () => ({ default: MockUPlot }));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(here, "../../../../tests/fixtures/wire/graph_encoding_facets.json"), "utf-8"))
  .facets as { request: { dataset: Dataset["data"] }; screen: { label: string; series: { label: string; color: string }[] }[] };
const PALETTE = ["#0b6e4f", "#c3423f", "#2d3047", "#f2a541", "#5e548e", "#1b998b", "#e84855", "#3e2f5b"];
// The fixture's own dataset (lib/plotEncodingFacets.test.ts), row 3 excluded.
const DS: Dataset = { id: "fe", name: "facets.csv", data: FIXTURE.request.dataset, excludedRows: [3] };
const PICKS: FigureEncoding = { color: 2, symbol: 3, label: 4 };

const root = document.documentElement;
beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  PALETTE.forEach((c, i) => root.style.setProperty(SERIES_VARS[i], c));
  // A light plot: on a dark one the canvas lifts a near-black series to its ink
  // colour for legibility (`resolveDrawColor`), which the white export never needs.
  root.dataset.theme = "light";
  useApp.setState({
    datasets: [DS], activeId: "fe", xKey: 0, yKeys: [1], y2Keys: null, seriesOrder: null, stackMode: true,
    composition: null, facetKey: null, groupKey: null, seriesLabels: {},
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  SERIES_VARS.forEach((v) => root.style.removeProperty(v));
  delete root.dataset.theme;
});

const labelsOf = () => created.map((c) => c.opts.series.slice(1).map((s) => s.label));

describe("MultiPanelStage — an encoded facet grid", () => {
  it("draws the fixture's series, legend text and colours in every panel", async () => {
    useApp.getState().facetByColumn("fe", 5);
    useApp.setState((s) => ({ plotWindows: withFocusedEncoding(s.plotWindows, s.focusedWindowId, PICKS) }));
    render(<MultiPanelStage />);
    const want = FIXTURE.screen.map((p) => p.series.map((s) => s.label));
    await waitFor(() => expect(labelsOf().slice(-2)).toEqual(want));
    const last = created.slice(-2);
    const strokes = last.map((c) => c.opts.series.slice(1).map((s) => (typeof s.stroke === "function" ? null : s.stroke)));
    expect(strokes).toEqual(FIXTURE.screen.map((p) => p.series.map((s) => s.color)));
  });

  it("a BACKGROUND window's facet grid draws its own document's picks too", async () => {
    const view = { ...defaultPlotView(), xKey: 0, yKeys: [1], facetKey: 5 };
    const composition = facetCompositionFromBinding(DS, 5, 0, [1]);
    render(<BackgroundStackWindow dataset={DS} view={view} composition={composition} encoding={PICKS} />);
    await waitFor(() => expect(labelsOf().slice(-2)).toEqual(FIXTURE.screen.map((p) => p.series.map((s) => s.label))));
  });

  it("without picks the grid is the plain one (one Rxy per panel)", async () => {
    useApp.getState().facetByColumn("fe", 5);
    useApp.setState((s) => ({ plotWindows: withFocusedEncoding(s.plotWindows, s.focusedWindowId, undefined) }));
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(2));
    // Excluded row 3 sits in the second panel, greyed under the default mode (F4.2c (a)).
    expect(labelsOf()).toEqual([["Rxy (Ohm)"], ["Rxy (Ohm)", "Rxy (excluded) (Ohm)"]]);
  });
});
