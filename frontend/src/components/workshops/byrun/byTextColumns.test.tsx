// A plain `id,grp,sub,val` CSV: the By pickers of Distribution, Curve fit and the By-level runs offer the
// text columns the importer left in `metadata.text_columns` (lib/groupableColumns, the rule the other
// group-by pickers already follow). Each is driven through its real panel / section; the rows each level
// receives are compared with pandas (`df.groupby("grp")["val"].apply(list)`, `dropna` on the key).

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel, statsHistogram, statsShapiro } from "../../../lib/api";
import { listFitModels } from "../../../lib/api/curvefit";
import { findPeaks } from "../../../lib/api/peaks";
import { statsDescriptive } from "../../../lib/api/statsDescriptive";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "../curvefit/CurveFitPanel";
import DistributionPanel from "../distribution/DistributionPanel";
import { DEFAULT_PEAK_FIND } from "../peaks/peakFindParams";
import PeakByLevelSection from "../peaks/PeakByLevelSection";
import { GRP, SUB, TEXT_GROUP_DS, VAL, byLevel } from "../textGroupFixture";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(), fetchBookData: vi.fn(), reportEmit: vi.fn(),
  statsHistogram: vi.fn(), statsShapiro: vi.fn(), statsFitDistributions: vi.fn(),
}));
vi.mock("../../../lib/api/statsCi", () => ({ statsConfidenceIntervals: vi.fn(() => new Promise(() => undefined)) }));
vi.mock("../../../lib/api/statsDescriptive", () => ({ statsDescriptive: vi.fn() }));
vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn() }));
vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  autoGuess: vi.fn(), listFitModels: vi.fn(), bootstrapFit: vi.fn(),
}));

const options = (select: HTMLElement) => Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
const pick = (select: HTMLElement, label: string) => {
  const at = Array.from(select.querySelectorAll("option")).find((o) => o.textContent === label);
  expect(at, `option ${label}`).toBeTruthy();
  fireEvent.change(select, { target: { value: (at as HTMLOptionElement).value } });
};
const byGrp = byLevel(GRP); // pandas: {"A": [1, 2, 3, 10, 11, 12], "B": [20, 21, 22, 30, 31, 32]}
const bySub = byLevel(SUB); // pandas: {"x": [1, 2, 3, 20, 21, 22], "y": [10, 11, 12, 30, 31, 32]}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(statsHistogram).mockResolvedValue({ counts: [1], centers: [1], edges: [0, 2], n_bins: 1, n: 1 } as never);
  vi.mocked(statsShapiro).mockResolvedValue({ W: 0.9, p: 0.5, N: 6 });
  vi.mocked(statsDescriptive).mockResolvedValue({ N: 6, mean: 1, median: 1, std: 1, min: 0, max: 2, q1: 1, q3: 1 } as never);
  vi.mocked(listFitModels).mockResolvedValue({
    models: [{ name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] }],
  });
  vi.mocked(fitModel).mockResolvedValue({ params: [2, 1], errors: [0.1, 0.2], R2: 0.98, RMSE: 0.5, yFit: [0] } as never);
  vi.mocked(findPeaks).mockResolvedValue({ peaks: [], background: [] } as never);
  useApp.setState({
    datasets: [TEXT_GROUP_DS], activeId: "tg", xKey: null, yKeys: [0], seriesOrder: null, errKeys: {},
    fitOverlay: null, curveFitOpen: true, distributionOpen: true, reports: [],
    status: "", selection: null, analysisResults: [], openAnalysisResultId: null, history: [], future: [],
  });
});

describe("Distribution By", () => {
  it("offers grp and sub, and profiles each level on pandas' groups", async () => {
    render(<DistributionPanel />);
    const by = await screen.findByLabelText("By (optional)");
    expect(options(by)).toEqual(expect.arrayContaining(["grp", "sub"]));
    pick(by, "grp");
    await waitFor(() => {
      const sent = vi.mocked(statsDescriptive).mock.calls.map(([v]) => v);
      expect(sent).toContainEqual(byGrp.A);
      expect(sent).toContainEqual(byGrp.B);
    });
    // Every group is named by its text value, never a numeric code.
    expect(await screen.findAllByText(/^A$|^B$/)).not.toHaveLength(0);
  });
});

describe("Curve fit By", () => {
  it("offers grp and sub, fits each level on pandas' rows, and saves the text column by name", async () => {
    render(<CurveFitPanel />);
    const by = await screen.findByLabelText("By (optional)");
    expect(options(by)).toEqual(expect.arrayContaining(["grp", "sub"]));
    pick(by, "grp");
    fireEvent.click(screen.getByRole("tab", { name: "Results" }));
    expect(await screen.findAllByText(/n=6/)).toHaveLength(2);
    const fitted = vi.mocked(fitModel).mock.calls.map(([req]) => ({ x: req.x, y: req.y }));
    // pandas: the x (row number) and val of the rows of each grp level, in file order.
    const rowsOf = (level: string) => GRP.flatMap((g, i) => (g === level ? [i + 1] : []));
    expect(fitted).toEqual([{ x: rowsOf("A"), y: byGrp.A }, { x: rowsOf("B"), y: byGrp.B }]);
    const save = await screen.findByRole("button", { name: "Save By result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    const [result] = useApp.getState().analysisResults;
    expect(result!.parameters).toMatchObject({ toolId: "curvefit", byColumn: "grp" });
    expect(result!.tables![0]!.rows.map((r) => r[0])).toEqual(["A", "B"]);
    // A text column has no channel number: the selection keeps no factor key a reopening would bound away.
    const selection = (result!.parameters as unknown as { selection: { items: { factorKeys: number[] }[] } }).selection;
    expect(selection.items[0]!.factorKeys).toEqual([]);
  });

  it("keeps a text pick made after a real one (the selection's factor key going empty does not clear it)", async () => {
    render(<CurveFitPanel />);
    const by = await screen.findByLabelText("By (optional)");
    pick(by, "id");
    pick(by, "sub");
    await waitFor(() => expect((by as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("sub"));
    fireEvent.click(screen.getByRole("tab", { name: "Results" }));
    await waitFor(() => expect(vi.mocked(fitModel).mock.calls.at(-1)![0].y).toEqual(bySub.y));
  });
});

describe("By-level run (Find peaks)", () => {
  const bodyRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);

  it("runs the detector once per level of sub on pandas' rows, labelled by the text", async () => {
    render(<PeakByLevelSection params={{ ...DEFAULT_PEAK_FIND }} />);
    const by = await screen.findByLabelText(/By \(optional\)/);
    expect(options(by)).toEqual(expect.arrayContaining(["grp", "sub"]));
    pick(by, "sub");
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(vi.mocked(findPeaks).mock.calls.map(([req]) => req.y)).toEqual([bySub.x, bySub.y]);
    expect(bodyRows().map((r) => within(r).getAllByRole("cell")[0]!.textContent)).toEqual(["x", "y"]);
  });

  it("leaves a row with a blank group out, like pandas' groupby, instead of making a missing-value group", async () => {
    const blank = ["A", "A", "A", "", "A", "A", "B", "B", "B", "B", "B", "B"];
    useApp.setState({ datasets: [{ ...TEXT_GROUP_DS, data: { ...TEXT_GROUP_DS.data, metadata: { text_columns: { grp: blank, sub: SUB } } } }] });
    render(<PeakByLevelSection params={{ ...DEFAULT_PEAK_FIND }} />);
    pick(await screen.findByLabelText(/By \(optional\)/), "grp");
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    // pandas: df.dropna(subset=["grp"]).groupby("grp")["val"] -- A loses its blank row (val 10), B is untouched.
    const sent = vi.mocked(findPeaks).mock.calls.map(([req]) => req.y);
    expect(sent).toEqual([VAL.filter((_, i) => blank[i] === "A"), VAL.filter((_, i) => blank[i] === "B")]);
    expect(bodyRows().map((r) => within(r).getAllByRole("cell")[1]!.textContent)).toEqual(["5", "6"]);
  });
});
