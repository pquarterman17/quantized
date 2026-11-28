// A plain `id,grp,sub,val` CSV: Fit Y by X's X (factor) and By pickers offer the text columns the
// importer left in `metadata.text_columns`. Driven through the real panel; the groups sent to the
// ANOVA are compared with pandas (`df.groupby("grp")["val"].apply(list)`, and the same within each
// `sub`), then the saved result is reopened and the old-release bound is checked.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sanitizeAnalysisResults } from "../../../lib/analysisResult";
import { fitYByXRecipe } from "../../../lib/fitYByXAnalysisResult";
import { useFitYByXStore } from "../../../store/fitYByX";
import { useApp } from "../../../store/useApp";
import { snapshotReopener } from "../analysisresults/useSnapshotReopen";
import { TEXT_GROUP_DS } from "../textGroupFixture";
import FitYByXPanel from "./FitYByXPanel";

const { anovaMock, recommendMock } = vi.hoisted(() => ({ anovaMock: vi.fn(), recommendMock: vi.fn() }));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsAnova: anovaMock,
  statsLevene: vi.fn().mockResolvedValue({ W: 0.1, p: 0.8, center: "median", n_groups: 2, method: "Brown-Forsythe" }),
  statsTukey: vi.fn().mockResolvedValue({ pairs: [], n_groups: 2, alpha: 0.05 }),
  statsRecommend: recommendMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  anovaMock.mockResolvedValue({ fStat: 40, df1: 1, df2: 10, pValue: 0.0001, reject: true });
  recommendMock.mockResolvedValue({
    recommendation: "One-way ANOVA", endpoint: "/api/stats/anova", parametric: true, n_groups: 2, paired: false,
    checks: { alpha: 0.05, shapiro_p: [0.5, 0.6] }, reasons: [],
  });
  useApp.setState({ datasets: [TEXT_GROUP_DS], activeId: "tg", reports: [], analysisResults: [], status: "" });
  useFitYByXStore.setState({ open: true, request: null });
});

const pick = (name: string, label: string) => {
  const select = screen.getByRole("combobox", { name });
  const option = Array.from(select.querySelectorAll("option")).find((o) => o.textContent === label);
  expect(option, `${name} offers ${label}`).toBeTruthy();
  fireEvent.change(select, { target: { value: option!.getAttribute("value") } });
};

describe("Fit Y by X on a CSV with text columns", () => {
  it("runs a one-way on the second text column with pandas' groups", async () => {
    render(<FitYByXPanel />);
    pick("Y (response)", "val");
    pick("X (factor)", "grp");
    // pandas: df.groupby("grp")["val"].apply(list) -> A [1,2,3,10,11,12], B [20,21,22,30,31,32]
    await waitFor(() => expect(anovaMock).toHaveBeenLastCalledWith([[1, 2, 3, 10, 11, 12], [20, 21, 22, 30, 31, 32]]));
  });

  it("partitions by a text column, one analysis per level of sub", async () => {
    render(<FitYByXPanel />);
    pick("Y (response)", "val");
    pick("X (factor)", "grp");
    pick("By (optional)", "sub");
    // pandas: within sub = x, groupby grp -> A [1,2,3], B [20,21,22]; within sub = y -> A [10,11,12], B [30,31,32]
    await waitFor(() => {
      const calls = anovaMock.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(calls).toContain(JSON.stringify([[1, 2, 3], [20, 21, 22]]));
      expect(calls).toContain(JSON.stringify([[10, 11, 12], [30, 31, 32]]));
    });
  });

  it("saves the result, reopens it on the same text columns, and an older release declines it", async () => {
    render(<FitYByXPanel />);
    pick("Y (response)", "val");
    pick("X (factor)", "grp");
    pick("By (optional)", "sub");
    const save = await screen.findByRole("button", { name: "Save result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    const [result] = sanitizeAnalysisResults(JSON.parse(JSON.stringify(useApp.getState().analysisResults)));
    snapshotReopener(result, TEXT_GROUP_DS, () => undefined)!();
    expect(useFitYByXStore.getState().request).toMatchObject({ xCol: 2, yCol: 0, byCol: 3 });
    // A release without text-column picks bounds the recipe by the real channels: it declines, never regroups.
    expect(fitYByXRecipe(result, TEXT_GROUP_DS)).toBeNull();
    // A renamed text column that now sorts differently is not the column the result recorded.
    const cols = TEXT_GROUP_DS.data.metadata.text_columns as Record<string, unknown>;
    const moved = { ...TEXT_GROUP_DS, data: { ...TEXT_GROUP_DS.data, metadata: { text_columns: { zgrp: cols.grp, sub: cols.sub } } } };
    expect(snapshotReopener(result, moved, () => undefined)).toBeNull();
  });
});
