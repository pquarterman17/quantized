// A plain `id,grp,sub,val` CSV: the Variability chart's Factor A / Factor B pickers offer the text
// columns the importer left in `metadata.text_columns`. Driven through the real panel; the response
// groups sent to the nested ANOVA are compared with pandas
// (`df.groupby(["grp", "sub"])["val"].apply(list)`), then the saved result is reopened.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsNestedAnova, statsVarianceComponents, statsVariabilitySummary } from "../../../lib/api";
import { sanitizeAnalysisResults } from "../../../lib/analysisResult";
import { variabilityRecipe } from "../../../lib/variabilityAnalysisResult";
import { useApp } from "../../../store/useApp";
import { useVariabilityStore } from "../../../store/variability";
import { snapshotReopener } from "../analysisresults/useSnapshotReopen";
import { TEXT_GROUP_DS } from "../textGroupFixture";
import VariabilityChartPanel from "./VariabilityChartPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsNestedAnova: vi.fn(),
  statsVarianceComponents: vi.fn(),
  statsVariabilitySummary: vi.fn(),
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const ANOVA = {
  table: [{ source: "A", SS: 1, df: 1, MS: 1, F: 1, p: 0.5 }], a_levels: 2, b_per_a: [2, 2], n_per_cell: [[3, 3], [3, 3]],
  n_total: 12, grand_mean: 16.25, alpha: 0.05, a_tested_against: "B(A)", b_within_a_estimable: true, error_estimable: true, balanced: true,
};
const VARCOMP = {
  sigma2_A: 15, sigma2_B_within_A: 2 / 3, sigma2_error: 4, sigma2_A_raw: 15, sigma2_B_within_A_raw: 2 / 3, sigma2_error_raw: 4,
  pct_A: 76.3, pct_B_within_A: 3.4, pct_error: 20.3, clamped: { A: false, B_within_A: false, error: false },
  n1_coefficient: 3, n2_coefficient: 6, ms_a: 96, ms_b: 6, ms_e: 4, balanced: true, method: "ANOVA/EMS method",
};
const SUMMARY = {
  cells: [], a_groups: [], grand_mean: 16.25, grand_n: 12, a_levels: 2, balanced: true,
};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.mocked(statsNestedAnova).mockResolvedValue(ANOVA as never);
  vi.mocked(statsVarianceComponents).mockResolvedValue(VARCOMP as never);
  vi.mocked(statsVariabilitySummary).mockResolvedValue(SUMMARY as never);
  useApp.setState({ datasets: [TEXT_GROUP_DS], activeId: "tg", selection: null, analysisResults: [], history: [], future: [] });
  useVariabilityStore.setState({ open: true, request: null });
});

const pick = (name: string, label: string) => {
  const select = screen.getByRole("combobox", { name });
  const option = Array.from(select.querySelectorAll("option")).find((o) => o.textContent === label);
  expect(option, `${name} offers ${label}`).toBeTruthy();
  fireEvent.change(select, { target: { value: option!.getAttribute("value") } });
};

describe("Variability chart on a CSV with text columns", () => {
  it("nests sub under grp and sends the response groups pandas finds", async () => {
    render(<VariabilityChartPanel />);
    pick("Response (Y)", "val");
    pick("Factor A (outer)", "grp");
    pick("Factor B (nested in A)", "sub");
    // pandas: (A,x)=[1,2,3] (A,y)=[10,11,12] (B,x)=[20,21,22] (B,y)=[30,31,32]
    await waitFor(() => expect(statsNestedAnova).toHaveBeenLastCalledWith([[[1, 2, 3], [10, 11, 12]], [[20, 21, 22], [30, 31, 32]]]));
  });

  it("saves the result and reopens it on the same text columns, and only while they are the same", async () => {
    render(<VariabilityChartPanel />);
    pick("Response (Y)", "val");
    pick("Factor A (outer)", "grp");
    pick("Factor B (nested in A)", "sub");
    const save = await screen.findByRole("button", { name: "Save result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    // Through the .dwk's own sanitizer, as a reload would.
    const [result] = sanitizeAnalysisResults(JSON.parse(JSON.stringify(useApp.getState().analysisResults)));
    const reopen = snapshotReopener(result, TEXT_GROUP_DS, () => undefined);
    expect(reopen).not.toBeNull();
    reopen!();
    expect(useVariabilityStore.getState().request).toMatchObject({ responseCol: 0, factorACol: 2, factorBCol: 3 });
    // A release without text-column picks bounds the recipe by the real channels: it declines, never regroups.
    expect(variabilityRecipe(result, TEXT_GROUP_DS)).toBeNull();
    // The sheet's text column `grp` is renamed `zgrp`, which sorts after `sub`: index 2 is `sub` now, so the
    // result must not reopen on it (it would regroup by another column).
    const cols = TEXT_GROUP_DS.data.metadata.text_columns as Record<string, unknown>;
    const swapped = { ...TEXT_GROUP_DS, data: { ...TEXT_GROUP_DS.data, metadata: { text_columns: { zgrp: cols.grp, sub: cols.sub } } } };
    expect(snapshotReopener(result, swapped, () => undefined)).toBeNull();
  });
});
