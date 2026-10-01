// The dialog basics (`test/dialogA11y.ts`) for the store-driven dialogs:
// Split dataset, Separate worksheets, Reimport all, Combine workbooks,
// Workbook properties, Quick Plot With… and the plot-recipe apply prompt.
// Fixtures mirror each dialog's own test file. The most-used dialogs are in
// `dialogInventory.a11y.test.tsx`.

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CombineWorkbooksDialog from "./CombineWorkbooksDialog";
import PlotRecipeApplyDialog from "./PlotRecipeApplyDialog";
import QuickPlotWithDialog from "./QuickPlotWithDialog";
import ReimportAllDialog from "./ReimportAllDialog";
import SeparateWorksheetsDialog from "./SeparateWorksheetsDialog";
import SplitDatasetDialog from "./SplitDatasetDialog";
import WorkbookPropertiesDialog from "../Library/WorkbookPropertiesDialog";
import { auditDialog } from "../../test/dialogA11y";
import { captureRecipe } from "../../lib/plotRecipe";
import { defaultPlotView } from "../../lib/plotview";
import type { QuickPlotTemplate } from "../../lib/quickPlotTemplates";
import type { Dataset } from "../../lib/types";
import { openCombineDialog, useCombineDialog } from "../../store/combineDialog";
import { openQuickPlotWith, useQuickPlotWithDialog } from "../../store/quickPlotWithDialog";
import { useApp } from "../../store/useApp";
import { useWorkbookPropertiesDialog } from "../../store/workbookPropertiesDialog";

vi.mock("../../store/toasts", () => ({ toast: vi.fn() }));

const dialog = () => screen.queryByRole("dialog");

function ds(id: string, name: string, workbookId?: string, labels = ["M"], technique?: string): Dataset {
  return {
    id,
    name,
    workbookId,
    data: {
      time: [0, 1, 2, 3, 4, 5],
      values: [[4.998], [5.0], [5.003], [9.997], [10.0], [10.003]].map((r) => labels.map((_, i) => r[0] + i)),
      labels,
      units: labels.map(() => ""),
      metadata: technique ? { technique } : {},
    },
  };
}

async function openWith(ui: ReactNode, open: () => unknown): Promise<HTMLElement> {
  render(
    <>
      <button type="button">opener</button>
      {ui}
    </>,
  );
  const opener = screen.getByRole("button", { name: "opener" });
  opener.focus();
  await act(async () => {
    await open();
  });
  await screen.findByRole("dialog");
  return opener;
}

beforeEach(() => {
  useApp.setState({
    datasets: [ds("d1", "A.dat", "w1"), ds("d2", "B.dat", "w1"), ds("d3", "C.dat", "w2")],
    workbooks: [{ id: "w1", name: "run1", folderId: "f1" }, { id: "w2", name: "run2" }],
    folders: [{ id: "f1", name: "Folder", parentId: null, order: 0 }],
    originFigures: [],
    editableFigures: [],
    figureDocs: [],
    reports: [],
    pages: [],
    plotWindows: [],
    focusedWindowId: null,
    plotRecipes: [],
    pendingRecipeApplication: null,
    quickPlotTemplates: [],
    activeId: "d1",
    selectedIds: ["d1"],
    worksheetId: null,
    trash: [],
    history: [],
    future: [],
    status: "",
    splitDialogTargetId: null,
    separatePreview: null,
    reimportAllRows: null,
    reimportAllBusy: false,
    reimportAllCommitted: null,
  });
  useCombineDialog.setState({ seed: null });
  useQuickPlotWithDialog.setState({ datasetId: null, workbookId: null });
  useWorkbookPropertiesDialog.setState({ properties: null });
});

describe("dialog basics — store-driven dialogs", () => {
  it("Split dataset", async () => {
    const user = userEvent.setup();
    const opener = await openWith(<SplitDatasetDialog />, () => useApp.setState({ splitDialogTargetId: "d1" }));
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });

  it("Separate worksheets", async () => {
    const user = userEvent.setup();
    const opener = await openWith(<SeparateWorksheetsDialog />, () =>
      useApp.getState().previewSeparateWorksheets(["d1"]),
    );
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });

  it("Reimport all", async () => {
    const user = userEvent.setup();
    const opener = await openWith(<ReimportAllDialog />, () =>
      useApp.setState({
        reimportAllRows: [
          { datasetId: "d1", datasetName: "A.dat", sourcePath: "/a", outcome: "staged", message: "ready" },
          { datasetId: "d2", datasetName: "B.dat", sourcePath: "/b", outcome: "missing", message: "file not found" },
        ],
      }),
    );
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });

  it("Combine workbooks", async () => {
    const user = userEvent.setup();
    const opener = await openWith(<CombineWorkbooksDialog />, () =>
      openCombineDialog({ workbookIds: [], worksheetIds: ["d1", "d2"] }),
    );
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });

  it("Workbook properties", async () => {
    const user = userEvent.setup();
    const opener = await openWith(<WorkbookPropertiesDialog />, () =>
      useWorkbookPropertiesDialog.getState().open({
        name: "Book 1", location: "Project / Runs", source: "Linked source", sourcePath: "C:/s.opju",
        originBook: "Book1", availability: "1 loaded", worksheetCount: 2, artifactCount: 1,
        tags: ["sample"], importedAt: "2026-09-20T12:00:00.000Z",
      }),
    );
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });

  it("Quick Plot With… (one usable and one disabled template)", async () => {
    const user = userEvent.setup();
    const base: QuickPlotTemplate = {
      id: "qpt-1", name: "Mine", createdAt: "x", modifiedAt: "x", scope: { kind: "schema" },
      technique: "magnetometry.mvsh", signature: { channels: [] },
      mapping: { xKey: null, yKeys: [0], errorBindings: [], ignoredKeys: [] }, style: "line", labels: { 0: "M" },
    };
    useApp.setState({
      datasets: [ds("d1", "A.dat", undefined, ["M"], "magnetometry.mvsh")],
      quickPlotTemplates: [base, { ...base, id: "qpt-2", name: "XRD", technique: "xrd.powder" }],
    });
    const opener = await openWith(<QuickPlotWithDialog />, () => openQuickPlotWith("d1"));
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });

  it("Apply plot recipe (partial match)", async () => {
    const user = userEvent.setup();
    const original = ds("d1", "d1.xy", undefined, ["2theta", "Intensity", "Ierr"], "xrd.powder");
    const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
    const recipe = captureRecipe(original, view, null, { id: "r1", name: "XRD Recipe", appVersion: "0" });
    useApp.setState({
      plotRecipes: [recipe],
      datasets: [ds("d1", "d1.xy", undefined, ["2theta", "Signal", "Ierr"], "xrd.powder")],
    });
    const opener = await openWith(<PlotRecipeApplyDialog />, () => useApp.getState().applyPlotRecipe("r1", "d1"));
    expect(await auditDialog(dialog, { opener, user })).toEqual([]);
  });
});
