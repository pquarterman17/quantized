// A plain `id,grp,sub,val` CSV: Statistical tests' "Group by" (Value by category) and Factor A / B
// pickers offer the text columns the importer left in `metadata.text_columns`. Driven through the real
// panel; the groups sent to the backend are compared with pandas
// (`df.groupby("grp")["val"].apply(list)`), the groups are named by their text, and the saved result
// reopens only while the text column is still there under its name.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetBookTransportForTests } from "../../../lib/bookData";
import { useStatsTestsStore } from "../../../store/statsTests";
import { useApp } from "../../../store/useApp";
import { snapshotReopener } from "../analysisresults/useSnapshotReopen";
import { GRP, SUB, TEXT_GROUP_DS, VAL, byLevel } from "../textGroupFixture";
import StatsTestsPanel from "./StatsTestsPanel";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));

vi.mock("../../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsTests")>()),
  runStatsTest: runMock,
}));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fetchBookData: vi.fn(() => new Promise(() => {})),
}));

const options = (select: HTMLElement) => Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
const choose = (label: string, text: string) => {
  const select = screen.getByLabelText(label);
  const at = Array.from(select.querySelectorAll("option")).find((o) => o.textContent === text);
  expect(at, `${label}: ${text}`).toBeTruthy();
  fireEvent.change(select, { target: { value: (at as HTMLOptionElement).value } });
};
const pickTest = (label: RegExp) => {
  const select = screen.getByLabelText("Test") as HTMLSelectElement;
  fireEvent.change(select, { target: { value: Array.from(select.options).find((o) => label.test(o.text))!.value } });
};

beforeEach(() => {
  resetBookTransportForTests();
  vi.clearAllMocks();
  runMock.mockResolvedValue({ id: "welch-anova", data: { F: 40, df1: 1, df2: 10, p: 0.001, alpha: 0.05, significant: true, N: 12, omega_sq: 0.7, classical_F: 41, classical_p: 0.001, groups: [{ index: 0, n: 6, mean: 6.5, sd: 5 }, { index: 1, n: 6, mean: 26, sd: 5 }] } });
  useApp.setState({
    datasets: [TEXT_GROUP_DS], activeId: "tg", status: "", reports: [], openReportId: null,
    analysisResults: [], openAnalysisResultId: null, history: [], future: [],
  });
  useStatsTestsStore.setState({ open: true, request: null });
});

describe("Statistical tests groups by a CSV text column", () => {
  it("offers grp and sub under Group by, runs on pandas' groups, and names the saved result's column", async () => {
    render(<StatsTestsPanel />);
    pickTest(/Welch ANOVA/);
    fireEvent.click(screen.getByRole("radio", { name: "Value by category" }));
    expect(options(screen.getByLabelText("Group by"))).toEqual(expect.arrayContaining(["grp", "sub"]));
    // The response stays on real columns: a text column's level codes are not a response.
    expect(options(screen.getByLabelText("Value"))).not.toContain("grp");
    choose("Value", "val");
    choose("Group by", "grp");
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await vi.waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(1));
    const expected = byLevel(GRP); // pandas: df.groupby("grp")["val"].apply(list)
    expect(runMock).toHaveBeenCalledTimes(1);
    const body = runMock.mock.calls[0]![0].body as { groups: number[][] };
    expect(body.groups).toHaveLength(2);
    body.groups.forEach((g, i) => g.forEach((v, j) => expect(v).toBeCloseTo([expected.A, expected.B][i]![j]!, 12)));
    const [saved] = useApp.getState().analysisResults;
    expect(saved!.parameters).toMatchObject({ labels: ["grp = A", "grp = B"] });
    expect(saved!.selection!.channels.map((c) => c.label)).toEqual(["val", "grp"]);
    // Reopens while grp is still the column at that index, never regroups by another column.
    const source = useApp.getState().datasets[0]!;
    expect(snapshotReopener(saved, source, () => undefined)).toBeTypeOf("function");
    const renamed = { ...source, data: { ...source.data, metadata: { text_columns: { sub: SUB, grp2: GRP } } } };
    expect(snapshotReopener(saved, renamed, () => undefined)).toBeNull();
  });

  it("offers the text columns as Factor A and Factor B and sends pandas' cells", async () => {
    render(<StatsTestsPanel />);
    pickTest(/Two-way ANOVA/);
    expect(options(screen.getByLabelText("Factor A"))).toEqual(expect.arrayContaining(["grp", "sub"]));
    expect(options(screen.getByLabelText("Factor B"))).toEqual(expect.arrayContaining(["grp", "sub"]));
    choose("Response", "val");
    choose("Factor A", "grp");
    choose("Factor B", "sub");
    runMock.mockResolvedValue({ id: "anova2-unbalanced", data: {} });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await vi.waitFor(() => expect(runMock.mock.calls.length).toBe(1));
    const body = runMock.mock.calls[0]![0].body as Record<string, unknown>;
    // pandas: the rows in file order with their grp / sub text.
    expect(JSON.stringify(body)).toContain(JSON.stringify(VAL));
    expect(JSON.stringify(body)).toContain(JSON.stringify(GRP));
    expect(JSON.stringify(body)).toContain(JSON.stringify(SUB));
  });
});
