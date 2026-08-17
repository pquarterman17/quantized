import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

const dataset: Dataset = {
  id: "d1",
  name: "unknown.csv",
  data: { time: [0, 1], values: [[2], [3]], labels: ["signal"], units: ["V"], metadata: {} },
};

beforeEach(() => {
  useApp.setState({ datasets: [dataset], quickFigureBuilderDatasetId: null, status: "ready" });
});

describe("QuickFigureBuilderSlice", () => {
  it("opens and closes as transient UI state", () => {
    expect(useApp.getState().openQuickFigureBuilder("d1")).toBe(true);
    expect(useApp.getState().quickFigureBuilderDatasetId).toBe("d1");
    useApp.getState().closeQuickFigureBuilder();
    expect(useApp.getState().quickFigureBuilderDatasetId).toBeNull();
  });

  it("fails closed when the worksheet vanished", () => {
    expect(useApp.getState().openQuickFigureBuilder("missing")).toBe(false);
    expect(useApp.getState().quickFigureBuilderDatasetId).toBeNull();
    expect(useApp.getState().status).toBe("Quick Figure Builder unavailable: worksheet not found");
  });

  // P1: loadWorkspace's return object must reset this field explicitly, same
  // as worksheetId/openReportId/figureDocSeed/activePlotSpecId — `set()` is a
  // shallow merge, so an omitted key survives a File > Open. Without the
  // reset, opening a new project leaves the builder pinned to a dataset id
  // from the PREVIOUS project ("Worksheet unavailable" over the fresh one).
  it("loadWorkspace resets the builder target — a fresh project never resumes a stale one", () => {
    useApp.getState().openQuickFigureBuilder("d1");
    expect(useApp.getState().quickFigureBuilderDatasetId).toBe("d1");

    useApp.getState().loadWorkspace({ datasets: [{ id: "w1", name: "first", data: dataset.data }] });

    expect(useApp.getState().quickFigureBuilderDatasetId).toBeNull();
  });
});
