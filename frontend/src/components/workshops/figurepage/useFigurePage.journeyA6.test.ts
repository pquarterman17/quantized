// FIGURE_AUTHORING_WORKFLOW_PLAN acceptance journey A6 (multi-panel), the
// deterministic half: "build a 2x2 page, link then unlink axes, rearrange,
// save/reopen, edit one panel, and preserve layout" — through the REAL
// Figure Page session hook, the REAL store, and the .dwk serializer/parser
// (the actual file boundary, not just the in-memory store). The page route is
// asserted through `buildSpec()`, the exact request body export sends.
//
// Not covered here (human): the feel of Shift+Arrow / drag rearrange and the
// visual result of a linked page; there is no live canvas link in this composer
// (see the plan's A6 note), only the render-time link_x/link_y flags.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FigurePageSpec } from "../../../lib/api/figurePage";
import { parseWorkspace, serializeWorkspace } from "../../../lib/workspace";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useFigurePage } from "./useFigurePage";

vi.mock("../../../lib/api", () => ({
  exportFigurePage: vi.fn().mockResolvedValue(undefined),
  renderFigurePageBlob: vi.fn().mockResolvedValue(new Blob(["png"], { type: "image/png" })),
  fetchBookData: vi.fn(),
}));
vi.mock("../../../lib/clipboard", () => ({
  clipboardImageSupported: vi.fn(() => true),
  clipboardSvgSupported: vi.fn(() => true),
}));
vi.mock("../../../lib/officeClipboard", () => ({
  copyOfficeGraphicFormats: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const app = () => useApp.getState();
const VIEWPORT = { width: 5000, height: 5000 };

const dataset = (id: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: {
    time: [0, 1, 2],
    values: [[1, 9], [2, 8], [3, 7]],
    labels: ["A", "B"],
    units: ["u", "v"],
    metadata: { technique: "generic" },
  },
});

/** Four separately SAVED editable figures (two per dataset), as the owner builds them. */
function buildFourFigures(): string[] {
  const ids: string[] = [];
  for (const [i, dsId] of ["d1", "d1", "d2", "d2"].entries()) {
    const winId = app().createWindow(dsId, undefined, `Fig ${i + 1}`);
    app().focusWindow(winId);
    app().setYKeys([i % 2]);
    app().setPlotTitle(`Title ${i + 1}`);
    ids.push(app().saveFigure(winId)!);
  }
  return ids;
}

function reopenProjectFromFile() {
  const text = serializeWorkspace({ ...app(), plotWindows: app().windowsForSave() });
  const loaded = parseWorkspace(text, VIEWPORT);
  expect(loaded.migrationWarnings ?? []).toEqual([]);
  app().loadWorkspace(loaded);
}

const order = (spec: FigurePageSpec | null) => (spec?.panels ?? []).map((p) => [p.row, p.col, p.figure.title]);

beforeEach(() => {
  useApp.setState({
    datasets: [dataset("d1"), dataset("d2")], activeId: "d1", selectedIds: [], librarySelection: null,
    plotWindows: [], focusedWindowId: null, editableFigures: [], figureDocs: [], pages: [], pageDocSeed: null,
    figurePageOpen: false, techniqueViewMemory: {}, history: [], future: [], status: "",
  });
});

describe("A6 multi-panel: 2x2, link then unlink, rearrange, save/reopen, edit one panel", () => {
  it("keeps grid, panel order, layout flags, captions and the page request through every file round trip", async () => {
    const figureIds = buildFourFigures();
    expect(app().editableFigures.map((d) => d.id)).toEqual(figureIds);

    // Build the 2x2 page.
    const s1 = renderHook(() => useFigurePage());
    act(() => s1.result.current.setGrid(2, 2));
    for (let i = 0; i < 4; i++) {
      act(() => s1.result.current.assign(i, s1.result.current.figureSources[i]));
    }
    act(() => s1.result.current.setName("Journey page"));

    // Link X and Y: the flags reach the page request, with the panel order.
    act(() => s1.result.current.setLayout({ linkX: true, linkY: true }));
    const linked = await s1.result.current.buildSpec();
    expect(linked).toMatchObject({ rows: 2, cols: 2, link_x: true, link_y: true });
    expect(order(linked)).toEqual([[0, 0, "Title 1"], [0, 1, "Title 2"], [1, 0, "Title 3"], [1, 1, "Title 4"]]);

    // Unlink: both flip back.
    act(() => s1.result.current.setLayout({ linkX: false, linkY: false }));
    expect(await s1.result.current.buildSpec()).toMatchObject({ link_x: false, link_y: false });

    // Rearrange (swap 0<->1 and 2<->3) with a caption on one panel; layout customised.
    act(() => s1.result.current.setSlotLabel(0, "(zz)"));
    act(() => s1.result.current.moveSlot(0, 1));
    act(() => s1.result.current.moveSlot(2, 3));
    act(() => s1.result.current.setLayout({ rowGap: 0.3, colGap: 0.1, alignLabels: true, resizeMode: "tight" }));
    const specBeforeSave = await s1.result.current.buildSpec();
    expect(order(specBeforeSave)).toEqual([[0, 0, "Title 2"], [0, 1, "Title 1"], [1, 0, "Title 4"], [1, 1, "Title 3"]]);

    act(() => s1.result.current.save());
    const savedPage = structuredClone(app().pages[0]);
    expect(savedPage.panels.map((p) => p.figureId)).toEqual([figureIds[1], figureIds[0], figureIds[3], figureIds[2]]);
    s1.unmount();

    // Save the whole project, reopen from the file, reopen the page.
    reopenProjectFromFile();
    expect(app().pages).toEqual([savedPage]); // complete page document, incl. layout + timestamps
    app().openPageDocument(savedPage.id);
    const s2 = renderHook(() => useFigurePage());
    expect(s2.result.current.dirty).toBe(false);
    expect(s2.result.current.rows).toBe(2);
    expect(s2.result.current.cols).toBe(2);
    expect(s2.result.current.layout).toEqual(savedPage.layout);
    expect(s2.result.current.slots.map((s) => s.source?.id)).toEqual(savedPage.panels.map((p) => p.figureId));
    expect(s2.result.current.slots[1].label).toBe("(zz)"); // the caption travelled with its panel
    expect(await s2.result.current.buildSpec()).toEqual(specBeforeSave);

    // Edit ONE panel, save, round-trip the file again: only that override changes.
    act(() => s2.result.current.setSlotTitle(2, "Only this one"));
    act(() => s2.result.current.save());
    s2.unmount();
    reopenProjectFromFile();
    const page = app().pages[0];
    expect(page.layout).toEqual(savedPage.layout);
    expect(page.panels.map((p) => p.figureId)).toEqual(savedPage.panels.map((p) => p.figureId));
    expect(page.panels.map((p) => p.title)).toEqual([null, null, "Only this one", null]);
    expect(page.panels.map((p) => p.label)).toEqual([null, "(zz)", null, null]);
    app().openPageDocument(page.id);
    const s3 = renderHook(() => useFigurePage());
    const finalSpec = await s3.result.current.buildSpec();
    expect(finalSpec?.panels.map((p) => p.title ?? null)).toEqual([null, null, "Only this one", null]);
    expect(order(finalSpec)).toEqual([[0, 0, "Title 2"], [0, 1, "Title 1"], [1, 0, "Title 4"], [1, 1, "Title 3"]]);
    expect(finalSpec).toMatchObject({ row_gap: 0.3, col_gap: 0.1, align_labels: true, resize_mode: "tight", link_x: false, link_y: false });
  });

  it("a linked page reopens linked", async () => {
    buildFourFigures();
    const s1 = renderHook(() => useFigurePage());
    act(() => s1.result.current.setGrid(2, 2));
    for (let i = 0; i < 4; i++) act(() => s1.result.current.assign(i, s1.result.current.figureSources[i]));
    act(() => s1.result.current.setLayout({ linkX: true, linkY: true }));
    act(() => s1.result.current.save());
    const id = app().pages[0].id;
    s1.unmount();
    reopenProjectFromFile();
    app().openPageDocument(id);
    const s2 = renderHook(() => useFigurePage());
    expect(await s2.result.current.buildSpec()).toMatchObject({ link_x: true, link_y: true });
  });
});
