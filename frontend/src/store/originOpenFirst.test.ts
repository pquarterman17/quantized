// An Origin project import opens like Origin does: on its FIRST graph when it
// has one that resolved (applied through `applyOriginFigure`, so one undo step
// and the user's own code path), else on the first-plot heuristics for the
// primary book -- never on every column of the raw worksheet.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { uploadFile } from "../lib/api";
import { importCore } from "./importDatasetsLazy";
import { loadOriginApplyLibs } from "./originApplyLibs";
import { firstOpenableFigure } from "./originOpenFirst";
import { useImportBatch } from "./importBatch";
import { usePendingOps } from "./pendingOps";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<Record<string, unknown>>()), importFile: vi.fn(), uploadFile: vi.fn() }));
vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

beforeAll(async () => {
  await importCore();
  await loadOriginApplyLibs();
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [], folders: [], workbooks: [], activeId: null, selectedIds: [], originFigures: [], originFidelity: [],
    plotWindows: [], focusedWindowId: null, history: [], future: [], yKeys: null, y2Keys: null,
  });
  useImportBatch.setState({ running: false });
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
});

const WIDE = 20;
const wideLabels = Array.from({ length: WIDE }, (_, c) => `Col${c}`);
const rows = Array.from({ length: 30 }, (_, r) => Array.from({ length: WIDE }, (_, c) => Math.sin(r / 3 + c) * (c + 1)));
const meta = (book: string) => ({
  origin_book: book,
  x_column_name: "A",
  origin_column_names: wideLabels.map((_, i) => `B${i}`),
});

function graph(name: string, book: string) {
  return {
    name, x_from: 0, x_to: 30, x_log: false, y_from: -5, y_to: 5, y_log: false, n_curves: 1, annotations: [] as string[],
    curves: [{ book, x: "A", y: "B0" }],
  };
}

function project(figures: ReturnType<typeof graph>[]) {
  return {
    time: Array.from({ length: 30 }, (_, r) => r),
    values: rows,
    labels: wideLabels,
    units: wideLabels.map(() => ""),
    metadata: {},
    book_source: { kind: "upload" as const, token: "tok" },
    books: [
      { lazy: false as const, primary: true as const, id: "b0", labels: wideLabels, units: wideLabels.map(() => ""), metadata: meta("Raw"), rows: 30, cols: WIDE },
      {
        time: Array.from({ length: 30 }, (_, r) => r), values: rows, labels: wideLabels, units: wideLabels.map(() => ""), metadata: meta("Second"),
      },
    ],
    ...(figures.length ? { figures } : {}),
  };
}
const files = (n: string) => [new File(["x"], n)];

describe("Origin project import opens its first graph", () => {
  it("applies the first resolved figure and says so in the toast", async () => {
    vi.mocked(uploadFile).mockResolvedValueOnce({
      ...project([graph("Graph7", "Second"), graph("Graph8", "Raw")]),
      origin_fidelity: {
        version: 1, container: "opju", status: "best_effort", graph_records_total: 2, graph_records_actionable: 2,
        graph_records_filtered: 0, omissions: [], filtered_figures: [],
      },
    });
    await useApp.getState().importFiles(files("P.opju"));
    const s = useApp.getState();
    expect(s.originFigures.map((f) => f.figure.name)).toEqual(["Graph7", "Graph8"]);
    const second = s.datasets.find((d) => String(d.data.metadata?.origin_book) === "Second");
    // The graph's own book and its one curve (B0), not the raw primary book
    // with every column: that is what the view now shows.
    expect(second).toBeDefined();
    expect(s.activeId).toBe(second!.id);
    expect(s.yKeys).toEqual([0]);
    expect(useToasts.getState().toasts.map((t) => t.msg)).toContain(
      "Opened Graph7 (1 of 2 Origin graphs) — Library ▸ Origin figures to browse",
    );
  });

  it("applies in ONE undo step", async () => {
    vi.mocked(uploadFile).mockResolvedValueOnce(project([graph("Graph1", "Second")]));
    await useApp.getState().importFiles(files("P.opju"));
    expect(useApp.getState().history.filter((h) => h.label === "apply Origin figure")).toHaveLength(1);
  });

  it("only the first Origin project of a batch opens a graph", async () => {
    vi.mocked(uploadFile)
      .mockResolvedValueOnce(project([graph("GraphA", "Second")]))
      .mockResolvedValueOnce(project([graph("GraphB", "Second")]));
    await useApp.getState().importFiles([new File(["x"], "A.opju"), new File(["x"], "B.opju")]);
    const msgs = useToasts.getState().toasts.map((t) => t.msg).filter((m) => m.startsWith("Opened"));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("GraphA");
  });

  it("with no figure, the primary book opens on the first-plot heuristics, not every column", async () => {
    vi.mocked(uploadFile).mockResolvedValueOnce(project([]));
    await useApp.getState().importFiles(files("P.opju"));
    const s = useApp.getState();
    expect(s.originFigures).toHaveLength(0);
    expect(s.yKeys).not.toBeNull();
    expect(s.yKeys!.length).toBeLessThanOrEqual(8);
    expect(s.activeId).toBe(s.datasets.find((d) => String(d.data.metadata?.origin_book) === "Raw")?.id);
  });
});

describe("firstOpenableFigure", () => {
  const fig = (name: string, datasetId: string | null) => ({ id: `f-${name}`, stem: "s", datasetId, siblingIds: [], figure: graph(name, "B") });
  it("skips unresolved figures and counts layers of one window once", () => {
    const r = firstOpenableFigure([fig("G1", null), fig("G2", "d"), fig("G2", "d"), fig("G3", "d")] as never);
    expect(r?.entry.figure.name).toBe("G2");
    expect([r?.nth, r?.total]).toEqual([2, 3]);
  });
  it("is null when nothing resolved", () => {
    expect(firstOpenableFigure([fig("G1", null)] as never)).toBeNull();
  });
});
