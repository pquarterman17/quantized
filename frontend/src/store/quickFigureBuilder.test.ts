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
});
