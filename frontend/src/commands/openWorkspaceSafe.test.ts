// "Open Without Layout…" (LIBRARY_WORKBOOK_UX_PLAN PR E2's safe open) — the
// same replace-and-confirm flow openWorkspaceConfirm.test.ts covers for
// "open-workspace", except the restored layout is deliberately DROPPED:
// `loadWorkspace`'s `skipLayout` option lands on the single fresh maximized
// window every layout-less doc already gets, and leaves the CURRENT
// session's `toolWindowLayout` untouched rather than overwriting it with
// the doc's own (or {}). Mirrors openWorkspaceConfirm.test.ts's mocking
// pattern exactly — same picker/parse plumbing, only the command id and the
// post-load assertions differ.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileCommands } from "./fileCommands";
import { askConfirm } from "../components/overlays/ConfirmDialog";
import { createFigureDocument } from "../lib/figureDocument";
import { openFilePicker } from "../lib/openFilePicker";
import { createPageDocument } from "../lib/pageDocument";
import { defaultPlotView } from "../lib/plotview";
import { WORKSPACE_FORMAT } from "../lib/workspace";
import { useApp } from "../store/useApp";
import type { DataStruct } from "../lib/types";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../lib/openFilePicker", async (orig) => ({
  ...(await orig<typeof import("../lib/openFilePicker")>()),
  openFilePicker: vi.fn(),
}));

const data: DataStruct = {
  time: [0, 1],
  values: [[1], [2]],
  labels: ["y"],
  units: [""],
  metadata: {},
};

/** Drive the picker's callback with a one-file .dwk payload, then let the
 *  whole async chain settle: file.text() -> dispatch -> askConfirm -> apply. */
async function pickWorkspaceFile(json: string) {
  const cb = vi.mocked(openFilePicker).mock.calls.at(-1)?.[0];
  if (!cb) throw new Error("openFilePicker was never called");
  cb([{ text: () => Promise.resolve(json) } as unknown as File]);
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

// A v4 doc carrying an actual saved layout (a second window + a
// toolWindowLayout entry) PLUS the three PR E2 session fields, so the
// "layout skipped, everything else restored" split is genuinely exercised
// rather than vacuously true on an empty layout.
const WS = JSON.stringify({
  format: WORKSPACE_FORMAT,
  version: 4,
  datasets: [{ id: "r1", name: "r1.dat", data, workbookId: "w1" }],
  folders: [],
  workbooks: [{ id: "w1", name: "Restored book" }],
  selectedIds: [],
  librarySelection: { kind: "workbook", id: "w1" },
  workbookLastChild: { w1: "worksheet:r1" },
  expandedWorkbookIds: ["w1"],
  plotWindows: [
    {
      id: "saved-1",
      kind: "plot",
      title: "saved",
      datasetId: "r1",
      geometry: { x: 10, y: 10, w: 480, h: 360 },
      z: 1,
      winState: "normal",
      view: {},
      bg: "theme",
      linkGroup: null,
      pinned: false,
    },
  ],
  focusedWindowId: "saved-1",
  toolWindowLayout: {
    peaks: { x: 50, y: 50, width: 300, height: null, collapsed: false },
  },
});

const EXISTING_TOOL_LAYOUT = { existing: { x: 5, y: 5, width: 250, height: null, collapsed: false } };

function openWorkspaceSafe() {
  const cmd = buildFileCommands(useApp.getState).find((c) => c.id === "open-workspace-safe");
  if (!cmd) throw new Error("open-workspace-safe command not registered");
  cmd.run();
}

beforeEach(() => {
  vi.mocked(askConfirm).mockReset();
  vi.mocked(openFilePicker).mockReset();
  useApp.setState({
    datasets: [
      { id: "a", name: "a.dat", data },
      { id: "b", name: "b.dat", data },
    ],
    activeId: "a",
    selectedIds: [],
    toolWindowLayout: EXISTING_TOOL_LAYOUT,
    // Reset explicitly: WS's own `workbooks: [{id:"w1",...}]` lands in the
    // store the moment any test in this file ACCEPTS a replace (e.g.
    // "accepting restores datasets and workbooks…" below), and would
    // otherwise leak into every later test — including hasWorkspaceContent's
    // "already empty" case, which now checks workbooks too (PR #152 P1 fix).
    workbooks: [],
  });
});

describe("Open Without Layout — confirms before replacing, then skips the saved layout", () => {
  it("asks before discarding a non-empty library, same as Open workspace", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    openWorkspaceSafe();
    await pickWorkspaceFile(WS);
    expect(askConfirm).toHaveBeenCalledOnce();
  });

  it("the confirm message says the layout will be skipped", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    openWorkspaceSafe();
    await pickWorkspaceFile(WS);
    expect(vi.mocked(askConfirm).mock.calls[0][1]).toMatch(/layout/i);
  });

  it("declining leaves the current library untouched", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    openWorkspaceSafe();
    await pickWorkspaceFile(WS);
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("accepting restores datasets and workbooks but collapses to ONE fresh window, leaving toolWindowLayout untouched", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    openWorkspaceSafe();
    await pickWorkspaceFile(WS);
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.id)).toEqual(["r1"]);
    expect(s.workbooks.map((w) => w.id)).toEqual(["w1"]);
    // The saved layout (2 windows named "saved-1") never lands — exactly the
    // single fresh-window fallback a plotWindows-less doc already gets.
    expect(s.plotWindows).toHaveLength(1);
    expect(s.plotWindows[0].id).not.toBe("saved-1");
    expect(s.plotWindows[0].winState).toBe("maximized");
    // The CURRENT session's toolWindowLayout survives untouched — the doc's
    // own "peaks" entry never lands, and the field isn't reset to {} either.
    expect(s.toolWindowLayout).toEqual(EXISTING_TOOL_LAYOUT);
  });

  it("still restores the new PR E2 session fields (librarySelection/workbookLastChild/expandedWorkbookIds)", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    openWorkspaceSafe();
    await pickWorkspaceFile(WS);
    const s = useApp.getState();
    expect(s.librarySelection).toEqual({ kind: "workbook", id: "w1" });
    expect(s.workbookLastChild).toEqual({ w1: "worksheet:r1" });
    expect(s.expandedWorkbookIds).toEqual(["w1"]);
  });

  it("does NOT prompt when the library is already empty (nothing to lose)", async () => {
    useApp.setState({ datasets: [], activeId: null, selectedIds: [] });
    openWorkspaceSafe();
    await pickWorkspaceFile(WS);
    expect(askConfirm).not.toHaveBeenCalled();
    expect(useApp.getState().plotWindows).toHaveLength(1);
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["r1"]);
  });
});

// Sol's PR #152 review (P1) — see openWorkspaceConfirm.test.ts's matching
// describe block for the full rationale: `hasWorkspaceContent`
// (lib/openWorkspaceReplace.ts) gates BOTH open commands, not just
// "open-workspace".
describe("Open without layout — confirms for a dataset-free session that still holds other content", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [],
      activeId: null,
      selectedIds: [],
      editableFigures: [
        createFigureDocument({ id: "fig-1", name: "Frozen figure", datasetId: null, view: defaultPlotView() }),
      ],
      pages: [createPageDocument({ id: "page-1", name: "Panel", rows: 1, cols: 1 })],
      reports: [{ id: "rep-1", name: "Report", datasetId: null, report: { title: "Report", sections: [] } }],
      techniqueViewMemory: {},
    });
  });

  it("asks when the ONLY customization is nonempty techniqueViewMemory (Sol follow-up: persisted project content)", async () => {
    useApp.setState({
      editableFigures: [], pages: [], reports: [],
      techniqueViewMemory: { "magnetometry.mvsh": { yScale: "linear" } } as never,
    });
    vi.mocked(askConfirm).mockResolvedValue(false);
    openWorkspaceSafe();
    await pickWorkspaceFile(WS);
    expect(askConfirm).toHaveBeenCalledOnce();
  });

  it("asks before discarding it (0 datasets is NOT the same as an empty session)", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    openWorkspaceSafe();
    await pickWorkspaceFile(WS);
    expect(askConfirm).toHaveBeenCalledOnce();
  });

  it("declining preserves the figure, page, and report", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    openWorkspaceSafe();
    await pickWorkspaceFile(WS);
    const s = useApp.getState();
    expect(s.editableFigures).toHaveLength(1);
    expect(s.pages).toHaveLength(1);
    expect(s.reports).toHaveLength(1);
  });

  it("accepting replaces them", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    openWorkspaceSafe();
    await pickWorkspaceFile(WS);
    const s = useApp.getState();
    expect(s.editableFigures).toEqual([]);
    expect(s.pages).toEqual([]);
    expect(s.reports).toEqual([]);
  });
});
