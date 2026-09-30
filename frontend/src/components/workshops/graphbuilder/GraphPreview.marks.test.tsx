// JMP_GAP J5 residual (closed 2026-09-29): the Graph Builder preview PAINTS
// the window's categorical marks. The canvases are invisible to jsdom, so the
// painters are stubbed and this pins what they are handed: the flat canvas'
// draw and every facet cell's draw carry the store's `statMarks` for the
// spec's mode and the points they need (`./previewMarks` pins the rows).

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsViolin } from "../../../lib/api";
import { specToRender, type PlotSpec } from "../../../lib/plotspec";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import type { StatDrawData } from "../../Stage/statRender";
import GraphPreview from "./GraphPreview";

const cells: StatDrawData[] = [];
const flat: StatDrawData[] = [];
vi.mock("../../Stage/StatStageCanvas", () => ({
  default: ({ data }: { data: StatDrawData }) => {
    cells.push(data);
    return null;
  },
}));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsViolin: vi.fn(),
}));
vi.mock("../../Stage/statRender", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../Stage/statRender")>()),
  draw: (_c: unknown, _h: unknown, d: StatDrawData) => flat.push(d),
}));

const ROWS = [[0, 0, 1], [0, 1, 2], [0, 0, 3], [1, 1, 10], [1, 0, 11], [1, 1, 12]];
const DS: Dataset = {
  id: "gm",
  name: "gm.csv",
  data: {
    time: ROWS.map((_, i) => i), values: ROWS, labels: ["lot", "wafer", "y"], units: ["", "", ""], metadata: {},
    cat_levels: { 0: ["L1", "L2"], 1: ["W1", "W2"] },
  },
};
const ref = (channel: number) => ({ datasetId: "gm", channel });
const spec = (mark: PlotSpec["mark"], facet: boolean): PlotSpec => ({
  version: 1,
  zones: { x: ref(0), y: [ref(2)], group: null, facet: facet ? ref(1) : null, yErr: [], xErr: null },
  mark,
});

beforeEach(() => {
  cells.length = 0;
  flat.length = 0;
  vi.mocked(statsViolin).mockReset();
  useApp.setState({ datasets: [DS], statMarks: { box: { points: "all", summary: "mean" }, bar: { points: "all" } } });
});

describe("GraphPreview — categorical marks reach the painters", () => {
  it("flat box: the canvas is handed the box marks and every point", () => {
    const s = spec("box", false);
    render(<GraphPreview render={specToRender(s, [DS])} spec={s} />);
    const d = flat.at(-1);
    if (d?.mode !== "box") throw new Error("expected a box draw");
    expect(d.marks).toMatchObject({ points: "all", summary: "mean" });
    expect(d.points?.map((g) => g.points.map((p) => p.rowIndex))).toEqual([[0, 1, 2], [3, 4, 5]]);
  });

  it("faceted bar: every cell is handed its own marked, raw-carrying draw", () => {
    const s = spec("bar", true);
    render(<GraphPreview render={specToRender(s, [DS])} spec={s} />);
    expect(cells).toHaveLength(2);
    for (const d of cells) {
      if (d.mode !== "bar") throw new Error("expected bar cells");
      expect(d.marks?.points).toBe("all");
      expect(d.data.groups.every((g) => g.series[0].raw != null)).toBe(true);
    }
  });

  it("violin: the preview paints the KDE violin with the violin's marks, flat and per facet", async () => {
    useApp.setState({ statMarks: { violin: { points: "all" } } });
    vi.mocked(statsViolin).mockImplementation(async (data: number[]) => ({
      x: [Math.min(...data), Math.max(...data)], density: [0.2, 0.4], bandwidth: 1, quartiles: [1, 2, 3], n: data.length,
    }));
    const s = spec("violin", false);
    const { container } = render(<GraphPreview render={specToRender(s, [DS])} spec={s} />);
    await waitFor(() => expect(flat.at(-1)?.mode).toBe("violin"));
    const d = flat.at(-1);
    if (d?.mode !== "violin") throw new Error("expected a violin draw");
    expect(d.violins.map((v) => v.n)).toEqual([3, 3]);
    expect(d.marks?.points).toBe("all");
    expect(d.points?.map((g) => g.points.map((p) => p.rowIndex))).toEqual([[0, 1, 2], [3, 4, 5]]);
    expect(container.textContent).not.toContain("violin preview shows box");
    const f = spec("violin", true);
    render(<GraphPreview render={specToRender(f, [DS])} spec={f} />);
    await waitFor(() => expect(cells.slice(-2).map((c) => c.mode)).toEqual(["violin", "violin"]));
  });

  it("violin with no backend: the box stand-in and its note stay", async () => {
    vi.mocked(statsViolin).mockRejectedValue(new Error("offline"));
    const s = spec("violin", false);
    const { findByText } = render(<GraphPreview render={specToRender(s, [DS])} spec={s} />);
    expect(await findByText(/violin preview shows box/)).toBeTruthy();
    expect(flat.at(-1)?.mode).toBe("box");
  });

  it("without a spec the preview paints the unmarked draw it always did", () => {
    const s = spec("box", false);
    render(<GraphPreview render={specToRender(s, [DS])} />);
    const d = flat.at(-1);
    expect(d && "marks" in d ? d.marks : undefined).toBeUndefined();
  });
});

// The error-bar footnote (PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 box 1 leftover):
// the preview names the error bars it draws with the SAME text the Stat Stage
// shows under its plot (`Stage/statErrorNote.figureErrorNote`), and shows
// nothing when no bar is drawn.
describe("GraphPreview — error-bar footnote", () => {
  it("flat box with a mean marker: the stage's footnote text, once", () => {
    useApp.setState({ statMarks: { box: { summary: "mean", errorBars: "se" } } });
    const s = spec("box", false);
    const { getAllByTestId } = render(<GraphPreview render={specToRender(s, [DS])} spec={s} />);
    const notes = getAllByTestId("preview-error-note");
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toBe("Error bars: SE of the mean");
  });

  it("faceted bar: one footnote for the whole grid, from the bar's own default (SE)", () => {
    useApp.setState({ statMarks: {} });
    const s = spec("bar", true);
    const { getAllByTestId } = render(<GraphPreview render={specToRender(s, [DS])} spec={s} />);
    expect(getAllByTestId("preview-error-note").map((n) => n.textContent)).toEqual(["Error bars: SE of the mean"]);
  });

  it("no error bar drawn (box without a summary marker; bar with 'none'): no footnote", () => {
    useApp.setState({ statMarks: { box: { points: "all" }, bar: { errorBars: "none" } } });
    const b = spec("box", false);
    const { queryByTestId, unmount } = render(<GraphPreview render={specToRender(b, [DS])} spec={b} />);
    expect(queryByTestId("preview-error-note")).toBeNull();
    unmount();
    const r = spec("bar", false);
    const { queryByTestId: q2 } = render(<GraphPreview render={specToRender(r, [DS])} spec={r} />);
    expect(q2("preview-error-note")).toBeNull();
  });

  it("without a spec (the unmarked draw) there is no footnote", () => {
    useApp.setState({ statMarks: { box: { summary: "mean", errorBars: "sd" } } });
    const s = spec("box", false);
    const { queryByTestId } = render(<GraphPreview render={specToRender(s, [DS])} />);
    expect(queryByTestId("preview-error-note")).toBeNull();
  });
});
