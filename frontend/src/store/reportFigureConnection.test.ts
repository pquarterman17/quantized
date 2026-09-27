import { beforeEach, describe, expect, it } from "vitest";

import { createFigureDocument } from "../lib/figureDocument";
import { defaultPlotView } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

const dataset = (): Dataset => ({
  id: "d1",
  name: "loop.dat",
  data: {
    time: [0, 1],
    values: [[10, 20], [1, 2]],
    labels: ["field", "moment"],
    units: ["Oe", "emu"],
    metadata: {},
  },
});

const figure = () => createFigureDocument({
  id: "fig1",
  name: "M(H)",
  datasetId: "d1",
  view: { ...defaultPlotView(), xKey: 0, yKeys: [1], plotTitle: "Loop" },
});

beforeEach(() => {
  useApp.setState({
    datasets: [dataset()], editableFigures: [figure()], reports: [], openReportId: null,
    history: [], future: [], status: "",
  });
});

describe("addFigureToReport", () => {
  it("creates a report with a detached canonical export spec, source refs, and one undo entry", async () => {
    expect(await useApp.getState().addFigureToReport(
      { kind: "library", figureId: "fig1" },
      { kind: "new", name: "Magnetic summary" },
      "Room-temperature loop",
    )).toBe(true);

    const state = useApp.getState();
    expect(state.reports).toHaveLength(1);
    expect(state.openReportId).toBe(state.reports[0].id);
    expect(state.history.map((entry) => entry.label)).toEqual(["Add figure to report"]);
    expect(state.reports[0]).toMatchObject({ name: "Magnetic summary", datasetId: "d1" });
    expect(state.reports[0].report.source_refs).toEqual([
      { kind: "figure", id: "fig1", name: "M(H)" },
      { kind: "dataset", id: "d1", name: "loop.dat" },
    ]);
    const block = state.reports[0].report.sections[0].blocks[0];
    expect(block).toMatchObject({ type: "figure", name: "M(H)", caption: "Room-temperature loop" });
    if (block.type !== "figure") throw new Error("expected figure block");
    expect(block.spec).toMatchObject({ x_key: 0, y_keys: [1], title: "Loop", dpi: 300 });

    // Adversarial pin: even an illicit in-place edit of the live dataset
    // cannot rewrite the report snapshot after the gesture.
    useApp.getState().datasets[0].data.values[1][0] = 999;
    expect(block.spec?.dataset.values[1][0]).toBe(1);
  });

  it("appends into one Figures section, deduplicates refs, and Undo restores the report", async () => {
    useApp.getState().addReport("Lab book", {
      title: "Lab book",
      sections: [{ title: "Notes", blocks: [{ type: "text", text: "start" }] }],
    });
    const reportId = useApp.getState().reports[0].id;
    useApp.setState({ history: [], future: [] });

    const add = () => useApp.getState().addFigureToReport(
      { kind: "library", figureId: "fig1" }, { kind: "existing", reportId }, "Loop",
    );
    expect(await add()).toBe(true);
    expect(await add()).toBe(true);
    const report = useApp.getState().reports[0].report;
    expect(report.sections.map((section) => section.title)).toEqual(["Notes", "Figures"]);
    expect(report.sections[1].blocks).toHaveLength(2);
    expect(report.source_refs).toEqual([
      { kind: "figure", id: "fig1", name: "M(H)" },
      { kind: "dataset", id: "d1", name: "loop.dat" },
    ]);

    useApp.getState().undo();
    expect(useApp.getState().reports[0].report.sections[1].blocks).toHaveLength(1);
  });

  it("fails closed before history when the figure source or destination disappeared", async () => {
    useApp.setState({ datasets: [] });
    expect(await useApp.getState().addFigureToReport(
      { kind: "library", figureId: "fig1" }, { kind: "new", name: "Broken" },
    )).toBe(false);
    expect(useApp.getState().reports).toEqual([]);
    expect(useApp.getState().history).toEqual([]);
    expect(useApp.getState().status).toMatch(/requires dataset/);

    useApp.setState({ datasets: [dataset()] });
    expect(await useApp.getState().addFigureToReport(
      { kind: "library", figureId: "fig1" }, { kind: "existing", reportId: "gone" },
    )).toBe(false);
    expect(useApp.getState().history).toEqual([]);
  });

  it("accepts a frozen figure without a live dataset", async () => {
    const frozen = createFigureDocument({
      id: "frozen", name: "Archived loop", datasetId: null, view: { ...defaultPlotView(), yKeys: [0] },
      data: { mode: "frozen", snapshot: dataset().data },
    });
    useApp.setState({ datasets: [], editableFigures: [frozen] });
    expect(await useApp.getState().addFigureToReport(
      { kind: "library", figureId: "frozen" }, { kind: "new", name: "Archive" },
    )).toBe(true);
    const block = useApp.getState().reports[0].report.sections[0].blocks[0];
    expect(block.type === "figure" && block.spec?.dataset.values[0]).toEqual([10, 20]);
  });
});
