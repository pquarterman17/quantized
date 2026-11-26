// Plan item 47 follow-up: a CSV text column (a read-only `metadata.text_columns` sidecar, no channel index)
// labels points, through the real picker, store, save and reopen, a column insert, and the export request.
// The same dataset and expected labels are pinned for the export drawing in
// tests/fixtures/wire/point_label_avoid_cluster.json ("text_column").

import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import wire from "../../../../tests/fixtures/wire/point_label_avoid_cluster.json";
import { createFigureDocument } from "../../lib/figureDocument";
import { buildFigureSpecFromDocument } from "../../lib/figureSpec";
import { sliceDataStruct } from "../../lib/datasetsplit";
import { defaultPlotView } from "../../lib/plotview";
import { parseWorkspace, serializeWorkspace } from "../../lib/workspace";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { insertColumn } from "../../store/worksheetColumns";
import { usePointLabelLayout, usePointLabelReadout } from "../Stage/usePointLabelLayout";
import PointLabelsCard from "./PointLabelsCard";

const fx = wire.text_column;
const st = () => useApp.getState();
const TEXT = { key: -1, text: "Name", mode: "all" as const, topN: 10 };

/** What `import_csv` makes of the fixture's CSV: x = Temp (the time column), one channel, the text sidecar. */
function csvDataset(): Dataset {
  return {
    id: "d",
    name: "d",
    data: { time: fx.x, values: fx.y.map((y) => [y]), labels: ["Moment"], units: [""], metadata: { text_columns: { [fx.column]: fx.cells } } },
    excludedRows: fx.excluded,
  } as unknown as Dataset;
}

const texts = (points: { text: string }[]) => points.map((p) => p.text);
const WIRE_TEXTS = texts(fx.wire_points);

function exportedPoints(ds: Dataset, pointLabels: typeof TEXT, yKeys = [0]) {
  const view = { ...defaultPlotView(), xKey: null, yKeys, pointLabels };
  const spec = buildFigureSpecFromDocument(createFigureDocument({ id: "t", name: "T", datasetId: ds.id, view }), ds, "f");
  return spec.overrides?.point_labels;
}
const exportedTexts = (ds: Dataset, pointLabels: typeof TEXT, yKeys = [0]) => texts(exportedPoints(ds, pointLabels, yKeys)?.points ?? []);

beforeEach(() => {
  useApp.setState({
    datasets: [csvDataset()], activeId: "d", pointLabels: null, xKey: null, yKeys: [0], y2Keys: null, groupKey: null, facetKey: null,
    xScale: "linear", yScale: "linear", exchangeXY: false, waterfall: 0, waterfallDx: 0, hiddenChannels: [], seriesStyles: {},
    selection: null, history: [], future: [],
  });
});

describe("the Point labels picker", () => {
  it("lists the text column by name, marked, beside the channels, and picks it", () => {
    render(<PointLabelsCard />);
    fireEvent.click(screen.getByText("Point labels"));
    expect(screen.getByRole("option", { name: "Moment" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Name (text column)" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Label column"), { target: { value: "text:Name" } });
    expect(st().pointLabels).toEqual({ key: -1, text: "Name", mode: "top", topN: 10 });
    expect(screen.getByLabelText("Label column")).toHaveValue("text:Name");
    // the Avoid option rides along with the text source ...
    fireEvent.click(screen.getByLabelText("Avoid overlaps"));
    expect(st().pointLabels?.text).toBe("Name");
    expect(st().pointLabels?.avoid).toBeDefined();
    // ... and switching back to a channel drops the text name
    fireEvent.change(screen.getByLabelText("Label column"), { target: { value: "0" } });
    expect(st().pointLabels).toMatchObject({ key: 0, avoid: expect.anything() });
    expect("text" in (st().pointLabels ?? {})).toBe(false);
    st().undo();
    expect(st().pointLabels?.text).toBe("Name");
  });

  it("offers no text entry for a dataset without text columns", () => {
    useApp.setState({ datasets: [{ ...csvDataset(), data: { ...csvDataset().data, metadata: {} } }] });
    render(<PointLabelsCard />);
    fireEvent.click(screen.getByText("Point labels"));
    expect(screen.queryByRole("option", { name: /text column/ })).toBeNull();
  });
});

describe("on screen and in the export", () => {
  it("the live layout draws the cell strings: blank unlabelled, padding trimmed, long cut, excluded row left out", async () => {
    useApp.setState({ pointLabels: TEXT });
    const { result } = renderHook(() => usePointLabelLayout(st().datasets[0], null, undefined));
    await waitFor(() => expect(result.current.points.length).toBeGreaterThan(0));
    expect(result.current.points.map(({ x, y, text, s }) => ({ x, y, text, s }))).toEqual(fx.wire_points);
    expect(result.current.refusal).toBeNull();
  });

  it("the export request carries exactly the same strings (the fixture the matplotlib drawing is tested with)", () => {
    expect(exportedPoints(st().datasets[0], TEXT)?.points).toEqual(fx.wire_points);
  });

  it("the hover readout shows the cell text of the row under the cursor", () => {
    useApp.setState({ pointLabels: TEXT });
    const payload = { data: [fx.x, fx.y], series: [{ label: "y", unit: "", axis: 0 }], xLabel: "x", xUnit: "" } as never;
    const { result } = renderHook(() => usePointLabelReadout(st().datasets[0], payload, 1));
    expect(result.current).toEqual({ row: 2, label: "α-Fe" });
  });

  it("follows row exclusion and the data filter from rowstate", () => {
    // the filter drops the rows whose Moment is below 3 (rows 0 and 1); no manual exclusion
    const filtered = { ...csvDataset(), excludedRows: [], filter: [{ col: 0, kind: "range", min: 3 }] } as unknown as Dataset;
    // row 3 has a blank cell, row 2 the long one, row 4 the padded one, row 5 "Last"
    expect(exportedTexts(filtered, TEXT)).toEqual(["Last", "padded", WIRE_TEXTS[1]]);
  });

  it("a row slice (extract / split) keeps the strings with their rows", () => {
    const child = { ...csvDataset(), id: "c", excludedRows: [], data: sliceDataStruct(csvDataset().data, [4, 2]) } as Dataset;
    expect(exportedTexts(child, TEXT).sort()).toEqual(["padded", WIRE_TEXTS[1]].sort());
  });

  it("says so, and draws nothing, when the text column is gone", () => {
    const gone = { ...csvDataset(), data: { ...csvDataset().data, metadata: {} } } as Dataset;
    const wirePl = exportedPoints(gone, TEXT);
    expect(wirePl?.points).toEqual([]);
    expect(wirePl?.note).toMatch(/label column no longer exists/);
  });
});

describe("a column insert and a reload", () => {
  it("an inserted column neither turns the labels off nor moves them", () => {
    useApp.setState({ pointLabels: TEXT });
    expect(insertColumn("d", 0)).toBe(0);
    expect(st().datasets[0].data.labels).toEqual(["A", "Moment"]);
    expect(st().pointLabels).toEqual(TEXT);
    // Moment is channel 1 now; the labels are still the strings of the same rows
    expect(exportedPoints(st().datasets[0], TEXT, [1])?.points).toEqual(fx.wire_points);
    st().undo();
    expect(st().datasets[0].data.labels).toEqual(["Moment"]);
    expect(st().pointLabels).toEqual(TEXT);
  });

  it("survives save and reopen of the workspace", () => {
    useApp.setState({ pointLabels: TEXT });
    const json = serializeWorkspace({ ...st(), plotWindows: st().windowsForSave() });
    const back = parseWorkspace(json, { width: 5000, height: 5000 });
    const win = back.plotWindows.find((w) => w.view.pointLabels);
    expect(win?.view.pointLabels).toEqual(TEXT);
    expect(back.datasets[0].data.metadata).toMatchObject({ text_columns: { Name: fx.cells } });
    expect(exportedPoints(back.datasets[0], win!.view.pointLabels as typeof TEXT)?.points).toEqual(fx.wire_points);
  });
});
