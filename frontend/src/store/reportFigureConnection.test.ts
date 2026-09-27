// Library "Add to Report…" -> lib/sendFigureToReport.ts's
// `runSendEditableFigureToReport` — adapted from PR #454's
// store/reportFigureConnection.test.ts onto #455's design (`addFigureToReport`
// / `updateReportSheet` / `reportChoices` / `figureBlockFromSpec`, source refs
// via `withSourceRefs`). Covers what #454 pinned that #455 did not yet have:
// a frozen figure needing no dataset, a live figure's dataset resolved
// through the store choke point (never read off `datasets` directly — #454's
// own bug, closed here), source-ref dedupe, fail-closed on a missing figure,
// and a detached (cloned) sent spec.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFigureDocument } from "../lib/figureDocument";
import type { ParamField } from "../lib/params";
import { defaultPlotView } from "../lib/plotview";
import type { ReportEntry, ReportFigureBlock } from "../lib/report";
import { NEW_REPORT, runSendEditableFigureToReport } from "../lib/sendFigureToReport";
import type { Dataset } from "../lib/types";
import { usePendingOps } from "./pendingOps";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const { ask } = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock("../components/overlays/ParamDialog", () => ({ askParams: ask }));
vi.mock("./paramDialog", () => ({ askParams: ask }));

const DS = "d1";

/** The Send dialog's first-page answers. */
function sendParams(over: Record<string, unknown> = {}) {
  return { target: NEW_REPORT, caption: "cap", fmt: "svg", style: "default", greyscale: false, ...over };
}

const existing = (id: string, name: string): ReportEntry => ({
  id,
  name,
  datasetId: null,
  report: { title: name, sections: [] },
});

function figureBlocks(reportId: string): ReportFigureBlock[] {
  const entry = useApp.getState().reports.find((r) => r.id === reportId);
  return (entry?.report.sections ?? []).flatMap((s) =>
    s.blocks.filter((b): b is ReportFigureBlock => b.type === "figure"),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useToasts.setState({ toasts: [] });
  usePendingOps.setState({ ops: [] });
  useApp.setState({
    datasets: [],
    editableFigures: [],
    reports: [],
    openReportId: null,
    history: [],
    future: [],
    status: "",
  });
});

describe("runSendEditableFigureToReport — frozen figures", () => {
  it("sends a frozen figure straight from its snapshot, no dataset needed", async () => {
    const doc = createFigureDocument({
      id: "fig1",
      name: "Frozen sweep",
      datasetId: null,
      view: { ...defaultPlotView(), xKey: 0, yKeys: [0] },
      data: {
        mode: "frozen",
        snapshot: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: ["u"], metadata: {} },
      },
    });
    useApp.setState({ editableFigures: [doc] });
    vi.mocked(ask).mockResolvedValueOnce(sendParams());

    await runSendEditableFigureToReport(useApp.getState, "fig1");

    const s = useApp.getState();
    expect(s.reports).toHaveLength(1);
    expect(s.reports[0].name).toBe("Frozen sweep figures");
    // (a) no live dataset -> the new report's back-reference is null.
    expect(s.reports[0].datasetId).toBeNull();
    const [block] = figureBlocks(s.reports[0].id);
    expect(block).toMatchObject({ type: "figure", name: "Frozen sweep", caption: "cap" });
    expect(s.reports[0].report.source_refs).toEqual([{ kind: "figure", id: "fig1", name: "Frozen sweep" }]);
    expect(s.history).toHaveLength(1);
  });
});

describe("runSendEditableFigureToReport — live figures resolve their dataset", () => {
  const doc = () =>
    createFigureDocument({
      id: "fig1",
      name: "Lazy sweep",
      datasetId: DS,
      view: { ...defaultPlotView(), xKey: 0, yKeys: [0] },
    });

  it("resolves a still-pending (lazy-book preview) dataset to its FULL data before building the spec", async () => {
    // The #454 bug this closes: reading `state.datasets` directly would see
    // only the small preview below, never the real data `resolveDataset`
    // fetches. `datasets` here holds the PREVIEW; `resolveDataset` is the
    // only path to the FULL rows.
    const preview: Dataset = {
      id: DS, name: "scan.dat",
      data: { time: [0], values: [[1]], labels: ["y"], units: ["u"], metadata: {} },
    };
    const full: Dataset = {
      id: DS, name: "scan.dat",
      data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["y"], units: ["u"], metadata: {} },
    };
    useApp.setState({
      editableFigures: [doc()],
      datasets: [preview],
      resolveDataset: async (id) => (id === DS ? full : undefined),
    });
    vi.mocked(ask).mockResolvedValueOnce(sendParams());

    await runSendEditableFigureToReport(useApp.getState, "fig1");

    const [block] = figureBlocks(useApp.getState().reports[0].id);
    const spec = block.spec as { dataset: { time: number[] } };
    expect(spec.dataset.time).toEqual(full.data.time);
    expect(useApp.getState().reports[0].datasetId).toBe(DS);
    expect(useApp.getState().reports[0].report.source_refs).toEqual([
      { kind: "figure", id: "fig1", name: "Lazy sweep" },
      { kind: "dataset", id: DS, name: "scan.dat" },
    ]);
  });

  it("the sent spec is a DETACHED clone: mutating the live dataset afterward leaves it alone", async () => {
    const live: Dataset = {
      id: DS, name: "scan.dat",
      data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: ["u"], metadata: {} },
    };
    useApp.setState({ editableFigures: [doc()], datasets: [live], resolveDataset: async () => live });
    vi.mocked(ask).mockResolvedValueOnce(sendParams());

    await runSendEditableFigureToReport(useApp.getState, "fig1");

    const [block] = figureBlocks(useApp.getState().reports[0].id);
    const values = (block.spec?.dataset as { values: number[][] }).values;
    expect(values).not.toBe(live.data.values);
    live.data.values[0][0] = 999; // mutate the store's own array in place
    expect((block.spec?.dataset as { values: number[][] }).values[0][0]).toBe(1);
  });

  it("fails closed when the figure's dataset vanishes while resolving — nothing is added", async () => {
    useApp.setState({
      editableFigures: [doc()],
      datasets: [{ id: DS, name: "scan.dat", data: { time: [0], values: [[1]], labels: ["y"], units: ["u"], metadata: {} } }],
      resolveDataset: async () => undefined,
    });
    vi.mocked(ask).mockResolvedValueOnce(sendParams());

    await runSendEditableFigureToReport(useApp.getState, "fig1");

    expect(useApp.getState().reports).toEqual([]);
    expect(useApp.getState().history).toEqual([]);
    expect(useToasts.getState().toasts.some((t) => t.kind === "danger" && /send failed/.test(t.msg))).toBe(true);
  });

  it("fails closed (never an unhandled rejection) when resolveDataset REJECTS", async () => {
    useApp.setState({
      editableFigures: [doc()],
      datasets: [{ id: DS, name: "scan.dat", data: { time: [0], values: [[1]], labels: ["y"], units: ["u"], metadata: {} } }],
      resolveDataset: async () => {
        throw new Error("network error");
      },
    });
    vi.mocked(ask).mockResolvedValueOnce(sendParams());

    await expect(runSendEditableFigureToReport(useApp.getState, "fig1")).resolves.toBeUndefined();

    expect(useApp.getState().reports).toEqual([]);
    expect(useApp.getState().history).toEqual([]);
    expect(
      useToasts.getState().toasts.some((t) => t.kind === "danger" && /send failed: network error/.test(t.msg)),
    ).toBe(true);
  });

  // Finding #1 (P3.6 review round 2): the figure's binding is re-checked
  // against a FRESH read after the dialog AND after the dataset resolve — a
  // rebind (or a mode flip) in either window fails closed instead of pairing
  // the wrong dataset's resolved data with the figure's NEW binding.
  it("fails closed when the figure's binding changes while the dialog is open — no stale dataset id is written", async () => {
    const other: Dataset = { id: "d2", name: "other.dat", data: { time: [0], values: [[9]], labels: ["y"], units: ["u"], metadata: {} } };
    useApp.setState({
      editableFigures: [doc()],
      datasets: [
        { id: DS, name: "scan.dat", data: { time: [0], values: [[1]], labels: ["y"], units: ["u"], metadata: {} } },
        other,
      ],
      resolveDataset: async (id) => useApp.getState().datasets.find((d) => d.id === id),
    });
    ask.mockImplementationOnce(async () => {
      // Simulate a rebind while the Send dialog is still open.
      const fig = useApp.getState().editableFigures[0];
      useApp.setState({ editableFigures: [{ ...fig, bindings: { ...fig.bindings, datasetId: "d2" } }] });
      return sendParams();
    });

    await runSendEditableFigureToReport(useApp.getState, "fig1");

    expect(useApp.getState().reports).toEqual([]);
    expect(useApp.getState().history).toEqual([]);
    expect(
      useToasts.getState().toasts.some((t) => t.kind === "danger" && /binding changed while the dialog was open/.test(t.msg)),
    ).toBe(true);
  });

  it("fails closed when the figure's binding changes DURING the dataset resolve — no stale dataset id is written", async () => {
    const full: Dataset = {
      id: DS, name: "scan.dat",
      data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["y"], units: ["u"], metadata: {} },
    };
    useApp.setState({
      editableFigures: [doc()],
      datasets: [full],
      resolveDataset: async (id) => {
        // Simulate a rebind while the (still in-flight) dataset resolves.
        const fig = useApp.getState().editableFigures[0];
        useApp.setState({ editableFigures: [{ ...fig, data: { mode: "frozen", snapshot: full.data } }] });
        return id === DS ? full : undefined;
      },
    });
    vi.mocked(ask).mockResolvedValueOnce(sendParams());

    await runSendEditableFigureToReport(useApp.getState, "fig1");

    expect(useApp.getState().reports).toEqual([]);
    expect(useApp.getState().history).toEqual([]);
    expect(
      useToasts.getState().toasts.some((t) => t.kind === "danger" && /binding changed while it was sending/.test(t.msg)),
    ).toBe(true);
  });

  // Finding #2: the dataset resolve runs under the same pendingOps
  // busy/cancel mechanism `exportActive` gives the plot path.
  it("registers a pendingOps busy entry with a Cancel affordance while the dataset resolves, and Cancel adds no block", async () => {
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    useApp.setState({
      editableFigures: [doc()],
      datasets: [{ id: DS, name: "scan.dat", data: { time: [0], values: [[1]], labels: ["y"], units: ["u"], metadata: {} } }],
      resolveDataset: async (id) => {
        await gate;
        return useApp.getState().datasets.find((d) => d.id === id);
      },
    });
    vi.mocked(ask).mockResolvedValueOnce(sendParams());

    const p = runSendEditableFigureToReport(useApp.getState, "fig1");
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));
    const op = usePendingOps.getState().ops[0];
    expect(op.label).toMatch(/Sending Lazy sweep/);
    expect(op.cancel).toBeTypeOf("function");

    op.cancel?.();
    resolveGate();
    await p;

    expect(useApp.getState().reports).toEqual([]);
    expect(usePendingOps.getState().ops).toEqual([]);
    expect(useApp.getState().status).toBe("send cancelled");
  });

  // Finding #2: a double-click (two near-simultaneous invocations of the
  // SAME figure) adds exactly one block, never two.
  it("a double-invoke of the same figure adds one block, not two", async () => {
    useApp.setState({
      editableFigures: [doc()],
      datasets: [{ id: DS, name: "scan.dat", data: { time: [0], values: [[1]], labels: ["y"], units: ["u"], metadata: {} } }],
      resolveDataset: async (id) => useApp.getState().datasets.find((d) => d.id === id),
    });
    vi.mocked(ask).mockResolvedValue(sendParams());

    await Promise.all([
      runSendEditableFigureToReport(useApp.getState, "fig1"),
      runSendEditableFigureToReport(useApp.getState, "fig1"),
    ]);

    expect(useApp.getState().reports).toHaveLength(1);
    expect(figureBlocks(useApp.getState().reports[0].id)).toHaveLength(1);
    expect(
      useToasts.getState().toasts.some((t) => t.kind === "danger" && /already being sent/.test(t.msg)),
    ).toBe(true);
  });
});

describe("runSendEditableFigureToReport — fail-closed / dedupe / new-report name", () => {
  it("fails closed when the source figure is no longer available — no dialog, no report, no history", async () => {
    await runSendEditableFigureToReport(useApp.getState, "gone");

    expect(ask).not.toHaveBeenCalled();
    expect(useApp.getState().reports).toEqual([]);
    expect(useApp.getState().history).toEqual([]);
    expect(useToasts.getState().toasts.some((t) => t.kind === "danger" && /send failed/.test(t.msg))).toBe(true);
  });

  it("sending the same figure into the same report twice does not duplicate its source ref", async () => {
    const doc = createFigureDocument({
      id: "fig1", name: "Sweep", datasetId: null,
      view: { ...defaultPlotView(), xKey: 0, yKeys: [0] },
      data: { mode: "frozen", snapshot: { time: [0], values: [[1]], labels: ["y"], units: ["u"], metadata: {} } },
    });
    useApp.setState({ editableFigures: [doc], reports: [existing("rep-a", "Fit A")], openReportId: "rep-a" });
    vi.mocked(ask).mockResolvedValueOnce(sendParams({ target: "Fit A" }));
    await runSendEditableFigureToReport(useApp.getState, "fig1");
    vi.mocked(ask).mockResolvedValueOnce(sendParams({ target: "Fit A" }));
    await runSendEditableFigureToReport(useApp.getState, "fig1");

    const refs = useApp.getState().reports.find((r) => r.id === "rep-a")?.report.source_refs;
    expect(refs).toEqual([{ kind: "figure", id: "fig1", name: "Sweep" }]);
    expect(figureBlocks("rep-a").map((b) => b.name)).toEqual(["Sweep", "Sweep-2"]);
  });

  // Finding #4 (P3.6 review round 2): the Library path strips the figure's
  // own name's extension for the block stem and the default report name,
  // exactly like the plot path (lib/sendFigureToReport.test.ts pins that
  // side of the same claim).
  it("strips the figure's own name extension for the block stem and default report name ('scan.dat' -> 'scan')", async () => {
    const namedDoc = createFigureDocument({
      id: "fig1", name: "scan.dat", datasetId: null,
      view: { ...defaultPlotView(), xKey: 0, yKeys: [0] },
      data: { mode: "frozen", snapshot: { time: [0], values: [[1]], labels: ["y"], units: ["u"], metadata: {} } },
    });
    useApp.setState({ editableFigures: [namedDoc] });
    ask.mockImplementationOnce(async (_title: string, fields: ParamField[]) => {
      expect(fields.find((f) => f.key === "newReportName")?.default).toBe("scan figures");
      return sendParams();
    });

    await runSendEditableFigureToReport(useApp.getState, "fig1");

    const s = useApp.getState();
    expect(s.reports[0].name).toBe("scan figures");
    expect(figureBlocks(s.reports[0].id)[0].name).toBe("scan");
  });

  // "(c)" — the "New report" name is now the ONE dialog's own field
  // (finding #8), not a second modal.
  it("(c) 'New report' name is a field on the SAME dialog; cancelling it leaves reports and history unchanged", async () => {
    const doc = createFigureDocument({
      id: "fig1", name: "Sweep", datasetId: null,
      view: { ...defaultPlotView(), xKey: 0, yKeys: [0] },
      data: { mode: "frozen", snapshot: { time: [0], values: [[1]], labels: ["y"], units: ["u"], metadata: {} } },
    });
    useApp.setState({ editableFigures: [doc] });
    vi.mocked(ask).mockResolvedValueOnce(null);

    await runSendEditableFigureToReport(useApp.getState, "fig1");

    expect(ask).toHaveBeenCalledTimes(1);
    expect(useApp.getState().reports).toEqual([]);
    expect(useApp.getState().history).toEqual([]);
  });

  it("(c) a typed name overrides the '<figure name> figures' default", async () => {
    const doc = createFigureDocument({
      id: "fig1", name: "Sweep", datasetId: null,
      view: { ...defaultPlotView(), xKey: 0, yKeys: [0] },
      data: { mode: "frozen", snapshot: { time: [0], values: [[1]], labels: ["y"], units: ["u"], metadata: {} } },
    });
    useApp.setState({ editableFigures: [doc] });
    vi.mocked(ask).mockResolvedValueOnce(sendParams({ newReportName: "  Custom report  " }));

    await runSendEditableFigureToReport(useApp.getState, "fig1");

    expect(useApp.getState().reports[0].name).toBe("Custom report");
  });
});
