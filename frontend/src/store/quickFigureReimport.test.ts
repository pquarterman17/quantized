// G5 canonical-state review probe (LIBRARY_WORKBOOK_UX_PLAN PR G, G5 review
// record): does a Quick-Figure-Builder-created FigureDocument develop
// dangling channel indices when its bound dataset is reimported with FEWER
// columns? `lib/figureDocumentReimport.ts`'s `resetFigureDocumentForReshape`
// and `store/reimport.ts`'s `commitReimport` already reset a saved figure's
// channel-indexed bindings on ANY column-count change (grow OR shrink --
// `lib/reimport.ts`'s `reimportColumnsChanged` only compares label counts,
// not direction); `store/reimport.test.ts` pins the GROWING case via
// `createFigureDocument` directly. This probe closes the loop the G5 review
// was asked to close: the SHRINKING case, through the actual G4/G5 creation
// path (`createQuickFigureFromMapping`), including a rich asymmetric-Y +
// X-error mapping (channels 2/3/4) whose target dataset columns vanish
// entirely on reimport. Found already correct -- this is a permanent
// regression pin, not a fix.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { importFile } from "../lib/api";
import { figureDocumentToPlotView } from "../lib/figureDocument";
import type { QuickFigureMapping } from "../lib/quickFigureMapping";
import type { DataStruct, Dataset } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api", () => ({
  applyCorrections: vi.fn(),
  uploadFile: vi.fn(),
  fetchBookData: vi.fn(),
  importFile: vi.fn(),
  guessImportSettings: vi.fn(),
  parseImportText: vi.fn(),
}));

vi.mock("./toasts", () => ({ toast: vi.fn() }));

const wideRaw: DataStruct = {
  time: [0, 1, 2],
  values: [[1, 10, 1.1, 0.9, 0.2], [2, 20, 2.1, 1.9, 0.3], [1.5, 30, 1.6, 1.4, 0.25]],
  labels: ["X", "Y", "Yerr+", "Yerr-", "Xerr"],
  units: ["", "", "", "", ""],
  metadata: { technique: "generic" },
};

/** The re-imported file lost 3 of its 5 columns -- the asymmetric-error and
 *  X-error target columns (2/3/4) are simply gone, not merely renumbered. */
const narrowFresh: DataStruct = {
  time: [0, 1, 2],
  values: [[1], [2], [1.5]],
  labels: ["X"],
  units: [""],
  metadata: { technique: "generic" },
};

function dataset(id: string): Dataset {
  return {
    id,
    name: `${id}.dat`,
    data: wideRaw,
    source: { kind: "path", path: `/data/${id}.dat` },
  };
}

/** Alternate X, one Y series, one COMPLETE asymmetric Y pair, one X-error
 *  binding -- the same shape the G5 lifecycle proof pins, so this probe
 *  exercises the SAME creation path with a shrinking reimport instead of a
 *  save/close/reopen chain. */
function richMapping(): QuickFigureMapping {
  return {
    xKey: 0,
    yKeys: [1],
    errorBindings: [
      { channel: 2, target: 1, axis: "y", side: "+" },
      { channel: 3, target: 1, axis: "y", side: "-" },
      { channel: 4, target: -1, axis: "x", side: "both" },
    ],
    ignoredKeys: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [dataset("d1")],
    activeId: null,
    selectedIds: [],
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    techniqueViewMemory: {},
    history: [],
    future: [],
    status: "",
  });
  useApp.getState().createWindow(null);
  useApp.setState({ history: [], future: [] });
});

describe("G5 canonical-state review: reimport dangling-channel-index probe", () => {
  it("clears (not dangles) a quick-figure's bindings when its bound dataset shrinks on reimport", async () => {
    const ok = useApp.getState().createQuickFigureFromMapping("d1", richMapping(), "line");
    expect(ok).toBe(true);

    const docId = useApp.getState().editableFigures[0].id;
    const winId = useApp.getState().focusedWindowId!;
    // Precondition: the rich bindings actually target the columns about to vanish.
    expect(useApp.getState().editableFigures[0].bindings.errors).toEqual([
      { channel: 2, target: 1, axis: "y", side: "+" },
      { channel: 3, target: 1, axis: "y", side: "-" },
      { channel: 4, target: -1, axis: "x", side: "both" },
    ]);
    expect(useApp.getState().editableFigures[0].bindings.yKeys).toEqual([1]);

    vi.mocked(importFile).mockResolvedValue(narrowFresh);
    await useApp.getState().reimportDataset("d1");

    // The SAVED document (editableFigures) must not dangle: no yKeys/errors
    // that name a column narrowFresh no longer has.
    const saved = useApp.getState().editableFigures.find((d) => d.id === docId)!;
    expect(saved.bindings.xKey).toBeNull();
    expect(saved.bindings.yKeys).toBeNull();
    expect(saved.bindings.errors).toEqual([]);

    // The OPEN WINDOW's document (the live facade the user is looking at)
    // must not dangle either -- this is the half a bindings-only check on
    // editableFigures alone would miss.
    const win = useApp.getState().plotWindows.find((w) => w.id === winId)!;
    expect(win.document?.bindings.xKey).toBeNull();
    expect(win.document?.bindings.yKeys).toBeNull();
    expect(win.document?.bindings.errors).toEqual([]);

    // Projecting the (reset) document to a PlotView -- the exact step the
    // renderer/payload builder takes -- must not throw and must not still
    // reference the vanished channels 2/3/4.
    expect(() => figureDocumentToPlotView(win.document!)).not.toThrow();
    const view = figureDocumentToPlotView(win.document!);
    expect(view.yKeys).toBeNull();
    expect(view.errKeys).toEqual({});

    // Dataset itself only has 1 column now -- confirm the scenario is real
    // (a genuine shrink, not a no-op).
    expect(useApp.getState().datasets.find((d) => d.id === "d1")!.data.labels).toEqual(["X"]);
  });
});
