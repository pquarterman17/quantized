// P3.4 safe cancel for the Publication Preview's Export commit: both export
// paths (the canonical FigureDocument and the legacy live-plot spec) run as
// one StatusBar op with a Cancel that aborts the render request. A cancelled
// export saves no file, raises no error toast and leaves a status line.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigure, type FigureSpec } from "../../../lib/api/figures";
import type { FigureDocument } from "../../../lib/figureDocument";
import type { DataStruct } from "../../../lib/types";
import { usePendingOps } from "../../../store/pendingOps";
import { useToasts } from "../../../store/toasts";
import type { LegacyFigureState } from "./legacyFigure";
import { exportPreviewFigure, type PreviewExportDeps } from "./previewExport";

vi.mock("../../../lib/api/figures", () => ({ exportFigure: vi.fn() }));
vi.mock("../../../lib/figureSpec", () => ({
  buildFigureSpecFromDocument: vi.fn(() => ({ fmt: "pdf" })),
}));

const DATA: DataStruct = { time: [0, 1], values: [[1], [2]], labels: ["A"], units: [""], metadata: {} };
const SPEC = { dataset: DATA } as unknown as FigureSpec;
const DOC = { name: "doc.dat", output: { format: "svg" } } as unknown as FigureDocument;
const LEGACY: LegacyFigureState = {
  data: DATA, xKey: null, yKeys: [0], xScale: "linear", yScale: "linear",
  xFmt: { mode: "auto", digits: 2 }, yFmt: { mode: "auto", digits: 2 }, style: "default", overrides: {},
  title: "", xLabel: "", yLabel: "", seriesStyles: {}, docSeriesStyles: undefined, docGroupCol: null, y2: null,
};

/** A request that settles only when its signal aborts (as fetch does). */
function hangUntilAborted(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
}

function deps(over: Partial<PreviewExportDeps>): PreviewExportDeps & { statuses: string[] } {
  const statuses: string[] = [];
  return {
    canonicalDocument: null,
    canonicalReadiness: null,
    canonicalDataset: null,
    spec: SPEC,
    legacyState: LEGACY,
    frozenData: null,
    active: { id: "d1", name: "scan.dat", data: DATA },
    fmt: "pdf",
    dpi: 300,
    autoSeriesStyles: false,
    setStatus: (s) => statuses.push(s),
    statuses,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
});

describe("exportPreviewFigure cancel (P3.4)", () => {
  it.each([
    ["live-plot spec", {}],
    [
      "canonical document",
      {
        canonicalDocument: DOC,
        canonicalReadiness: { state: "ready" as const, data: DATA, spec: SPEC },
        canonicalDataset: { id: "d1", name: "scan.dat", data: DATA },
      },
    ],
  ])("the %s export shows a cancellable op; Cancel aborts it with no error toast", async (_name, over) => {
    let signal: AbortSignal | undefined;
    vi.mocked(exportFigure).mockImplementationOnce((_body, s) => {
      signal = s;
      return hangUntilAborted(s);
    });
    const d = deps(over);
    const p = exportPreviewFigure(d);
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(usePendingOps.getState().ops.map((o) => o.label)).toEqual(["Exporting figure…"]);
    expect(signal?.aborted).toBe(false);
    usePendingOps.getState().ops[0].cancel?.();
    await p;
    expect(signal?.aborted).toBe(true);
    expect(d.statuses).toEqual(["export cancelled"]);
    expect(useToasts.getState().toasts).toEqual([]);
    expect(usePendingOps.getState().ops).toEqual([]);
  });

  it("reports a completed export as before and leaves no op behind", async () => {
    vi.mocked(exportFigure).mockResolvedValueOnce(undefined);
    const d = deps({});
    await exportPreviewFigure(d);
    expect(d.statuses).toEqual(["exported scan.pdf"]);
    expect(usePendingOps.getState().ops).toEqual([]);
  });

  it("still reports a real failure (not a cancel) as a failure", async () => {
    vi.mocked(exportFigure).mockRejectedValueOnce(new Error("render crashed"));
    const d = deps({});
    await exportPreviewFigure(d);
    expect(d.statuses).toEqual(["export failed: render crashed"]);
    expect(usePendingOps.getState().ops).toEqual([]);
  });
});
