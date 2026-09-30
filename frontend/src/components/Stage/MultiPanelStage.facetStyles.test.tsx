// FEATURE-001 (plans/BUGS_AND_ISSUES.md): per-channel styles reach every
// facet panel, keyed by CHANNEL — on screen (this file renders the real
// `MultiPanelStage` over a mocked uPlot and reads what `buildOpts` put on each
// panel's series) and in the export (`buildFigureSpecFromDocument` ships each
// panel series' own channel's style). The decision the entry asked for is
// "one style per channel, applied in every panel": the grid shares the flat
// plot's channel-keyed `seriesStyles`, and a panel projects it through its OWN
// `channels` list, so panels that resolve DIFFERENT channel sets (the case that
// broke the two reverted attempts) each still dress the right curve.
//
// Request + screen are the committed wire fixture
// `tests/fixtures/wire/facet_styles.json`, which the BACKEND half
// (`tests/test_export_facet_styles.py`) posts to the real route and reads back
// line by line. To regenerate after a DELIBERATE rule change:
//   GRAPH_ENCODING_FIXTURE_WRITE=1 npx vitest run src/components/Stage/MultiPanelStage.facetStyles.test.tsx

import { render, waitFor } from "@testing-library/react";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { facetPayloads } from "../../lib/facet";
import { createFigureDocument } from "../../lib/figureDocument";
import { buildFigureSpecFromDocument } from "../../lib/figureSpec";
import { defaultPlotView } from "../../lib/plotview";
import { SERIES_VARS } from "../../lib/seriesStyleCycle";
import type { Dataset, DataStruct, SeriesStyle } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import { facetPanelStyles } from "./facetGridRender";
import RealMultiPanelStage from "./MultiPanelStage";
import { useEffectiveComposition } from "./useEffectiveComposition";

function MultiPanelStage() {
  const active = useActiveDataset();
  return <RealMultiPanelStage composition={useEffectiveComposition(active)} />;
}

type SeriesOpts = { label?: string; stroke?: unknown; width?: number; dash?: number[]; points?: { show?: boolean } };
const { created, MockUPlot } = vi.hoisted(() => {
  const created: { opts: { series: SeriesOpts[] } }[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(opts: { series: SeriesOpts[] }) {
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
const FIXTURE = join(here, "../../../../tests/fixtures/wire/facet_styles.json");
const PALETTE = ["#0b6e4f", "#c3423f", "#2d3047", "#f2a541", "#5e548e", "#1b998b", "#e84855", "#3e2f5b"];

// The QD-shaped dataset the FEATURE-001 entry measured: ch0 B (x), ch1 level
// (the facet column), ch2 M_DC finite ONLY on level-0 rows, ch3 M_AC finite
// ONLY on level-1 rows. With no explicit Y the density heuristic runs per
// panel: panel "0" resolves [level, M_DC], panel "1" resolves [level, M_AC] —
// so M_AC sits at the SAME series index M_DC does, and an index-keyed style
// list would dress it in M_DC's dashes.
const ROWS = [
  [0, 0, 1.0, NaN], [1, 0, 1.5, NaN], [2, 0, 1.2, NaN],
  [0, 1, NaN, 3.0], [1, 1, NaN, 2.5], [2, 1, NaN, 2.8],
];
const DATA: DataStruct = {
  time: ROWS.map((_, i) => i),
  values: ROWS,
  labels: ["B", "level", "M_DC", "M_AC"],
  units: ["T", "", "emu", "emu"],
  metadata: {},
};
const DS: Dataset = { id: "fs", name: "styles.csv", data: DATA };
// M_DC: a chosen colour, dashed, wide. M_AC: markers only (its colour stays
// the panel's own cycle slot). `level` is unstyled.
const STYLES: Record<number, SeriesStyle> = {
  2: { color: "#ff8800", line: "dashed", width: 3 },
  3: { marker: true, markerShape: "square" },
};
const OPTS = { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "" };

const root = document.documentElement;
beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  PALETTE.forEach((c, i) => root.style.setProperty(SERIES_VARS[i], c));
  root.dataset.theme = "light";
  useApp.setState({
    datasets: [DS], activeId: "fs", xKey: 0, yKeys: null, y2Keys: null, seriesOrder: null, stackMode: true,
    composition: null, facetKey: null, groupKey: null, seriesLabels: {}, seriesStyles: STYLES, hiddenChannels: [],
    plotTemplate: "screen", defaultLineWidth: 1.5, defaultTrace: "Line",
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  SERIES_VARS.forEach((v) => root.style.removeProperty(v));
  delete root.dataset.theme;
  useApp.setState({ seriesStyles: {}, facetKey: null, composition: null });
});

const written: Record<string, unknown> = {};
afterAll(() => {
  if (process.env.GRAPH_ENCODING_FIXTURE_WRITE === "1") writeFileSync(FIXTURE, `${JSON.stringify(written, null, 2)}\n`);
});

describe("MultiPanelStage — per-channel styles on an unencoded facet grid (FEATURE-001)", () => {
  it("each panel dresses its OWN channels, keyed by channel, on screen and in the export request", async () => {
    // The screen's rule, stated once: the panels the grid draws and the style
    // list each hands `buildOpts` (`facetGridRender.facetPanelStyles`).
    const panels = facetPayloads(DATA, 1, 0, null);
    expect(panels.map((p) => p.channels)).toEqual([[1, 2], [1, 3]]); // the differing-channel case
    const screen = panels.map((p) => ({
      label: p.label,
      series: p.payload.series.map((s, j) => {
        const st = facetPanelStyles(p, STYLES)[j];
        return { label: s.unit ? `${s.label} (${s.unit})` : s.label, style: st ?? null };
      }),
    }));

    useApp.getState().facetByColumn("fs", 1);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(2));
    const [p0, p1] = created.map((c) => c.opts.series.slice(1));
    expect(p0.map((s) => s.label)).toEqual(["level", "M_DC (emu)"]);
    expect(p1.map((s) => s.label)).toEqual(["level", "M_AC (emu)"]);
    // Panel "0": M_DC wears its chosen colour, dash and width.
    expect(p0[1]).toMatchObject({ stroke: "#ff8800", width: 3, dash: [8, 4] });
    // Panel "1": M_AC (the SAME series index) wears ITS style — markers, no
    // dash — not M_DC's; `level` (index 0 in both) is unstyled in both.
    expect(p1[1].dash).toBeUndefined();
    expect(p1[1].points?.show).toBe(true);
    expect(p1[1].stroke).not.toBe("#ff8800");
    expect(p0[0].dash).toBeUndefined();
    expect(p1[0].dash).toBeUndefined();
    expect(p0[0].stroke).toBe(p1[0].stroke);

    // The export: each panel series carries its channel's CHOSEN style only
    // (no derived colour — the panel's cycle colours an unstyled series on
    // both sides, the BUG-016 grouped rule).
    const view = { ...defaultPlotView(), xKey: 0, yKeys: null, facetKey: 1, seriesStyles: STYLES };
    const doc = createFigureDocument({ id: "w", name: "w", datasetId: "fs", view, facetKey: 1, mark: "line" });
    const request = buildFigureSpecFromDocument(doc, DS, "fs", OPTS);
    expect(request.facets?.map((f) => f.series.map((s) => s.style ?? null))).toEqual([
      [null, { color: "#ff8800", line: "dashed", width: 3 }],
      [null, { marker: true, marker_shape: "square" }],
    ]);
    expect(request.encoding).toBeUndefined();

    const current = JSON.parse(JSON.stringify({ request, screen })) as unknown;
    written.styles = current;
    expect(current).toEqual(JSON.parse(readFileSync(FIXTURE, "utf-8")).styles);
  });
});
