// Red-first tests for the Combine dialog's open/closed handshake
// (LIBRARY_WORKBOOK_UX_PLAN PR J slice 2). Mirrors quickPlotWithDialog.test.ts.

import { beforeEach, describe, expect, it } from "vitest";

import { openCombineDialog, useCombineDialog } from "./combineDialog";

describe("combineDialog store", () => {
  beforeEach(() => {
    useCombineDialog.setState({ seed: null });
  });

  it("starts closed", () => {
    expect(useCombineDialog.getState().seed).toBeNull();
  });

  it("open(seed) stores the seed selection verbatim", () => {
    openCombineDialog({ workbookIds: ["w1"], worksheetIds: ["d1", "d2"] });
    expect(useCombineDialog.getState().seed).toEqual({ workbookIds: ["w1"], worksheetIds: ["d1", "d2"] });
  });

  it("close() clears the seed", () => {
    openCombineDialog({ workbookIds: [], worksheetIds: ["d1"] });
    useCombineDialog.getState().close();
    expect(useCombineDialog.getState().seed).toBeNull();
  });

  it("a second open() replaces the prior seed", () => {
    openCombineDialog({ workbookIds: [], worksheetIds: ["d1"] });
    openCombineDialog({ workbookIds: ["w2"], worksheetIds: [] });
    expect(useCombineDialog.getState().seed).toEqual({ workbookIds: ["w2"], worksheetIds: [] });
  });
});
