// Re-audit #14: Curve Fit's model list was a flat 72 entries with
// near-duplicates. It is grouped by Origin category (lib/fitModelCatalog.ts),
// with each alias spelled out and the custom equations last.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listFitModels } from "../../../lib/api/curvefit";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "./CurveFitPanel";

vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  autoGuess: vi.fn(),
  listFitModels: vi.fn(),
}));

const DATA: DataStruct = { time: [0, 1, 2], values: [[1], [3], [5]], labels: ["y"], units: [""], metadata: {} };

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: [0],
    curveFitOpen: true,
    toolWindowLayout: {},
  });
});

describe("CurveFitPanel — the model list is grouped by Origin category (re-audit #14)", () => {
  it("shows Origin's headings, the aliases, and custom equations last", async () => {
    vi.mocked(listFitModels).mockResolvedValue({
      models: [
        { name: "Linear", category: "Linear", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] },
        { name: "Exponential Decay", category: "Decay", paramNames: ["A", "τ", "C"], nParams: 3, p0: [1, 1, 0], lb: [], ub: [] },
        { name: "ExpDec1", category: "Exponential", paramNames: ["y0", "A1", "t1"], nParams: 3, p0: [0, 1, 1], lb: [], ub: [] },
      ],
    });
    render(<CurveFitPanel />);
    const picker = await screen.findByRole("combobox", { name: "Model" });
    await screen.findByRole("option", { name: "Exponential Decay (= ExpDec1)" });
    const groups = [...picker.querySelectorAll("optgroup")].map((g) => g.label);
    expect(groups).toEqual(["Polynomial", "Exponential", "Custom equations"]);
    expect((picker as HTMLSelectElement).value).toBe("Linear");
  });
});
