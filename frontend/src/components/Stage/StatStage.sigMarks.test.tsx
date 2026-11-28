// Significance marks from supplied p-values on the REAL Statistics stage and
// store (plan item 23), through the controls a user touches: pick a source
// (there is none until they do), pick the result or the worksheet columns,
// edit the thresholds, toggle ns / p text. Each commit is one undo step and is
// persisted on the plot. Waits are on rendered or stored STATE.

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox } from "../../lib/api";
import type { PosthocResult } from "../../lib/api/statsTestsMore";
import { statisticalTestAnalysisResult } from "../../lib/statisticalTestAnalysisResult";
import { DEFAULT_PARAMS, DEFAULT_SELECTION } from "../../lib/statsTests";
import { describeResult } from "../../lib/statsTestsResults";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import StatStage from "./StatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const DS: Dataset = {
  id: "ds", name: "ds",
  data: {
    time: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    values: [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [1, 6], [2, 9], [2, 10], [2, 11]],
    labels: ["grp", "y"], units: ["", ""], metadata: {}, cat_levels: { 0: ["A", "B", "C"] },
  },
};
const SHEET: Dataset = {
  id: "pairs", name: "pairs",
  data: {
    time: [0, 1, 2], labels: ["A", "B", "p"], units: ["", "", ""], metadata: {},
    values: [[0, 0, 0.2], [0, 1, 0.0004], [1, 1, 0.012]],
    cat_levels: { 0: ["A", "B"], 1: ["B", "C"] },
  },
};
// What the CSV importer makes of a pair table with TWO text columns: only the first is
// categorical; the second stays in the `text_columns` sidecar, one cell per source row.
const CSV_SHEET: Dataset = {
  id: "csv", name: "pairs.csv",
  data: {
    time: [0, 1, 2], labels: ["A", "p"], units: ["", ""],
    values: [[0, 0.2], [0, 0.0004], [1, 0.012]],
    cat_levels: { 0: ["A", "B"] },
    metadata: { text_columns: { B: ["B", "C", "C"] } },
  },
};
const pair = (i: number, j: number, p: number) => ({ i, j, diff: 1, p, ciLow: null, ciHigh: null, significant: p < 0.05, effect_size: null });
function posthoc(id: string, labels: string[]) {
  const data: PosthocResult = {
    pairs: [pair(0, 1, 0.2), pair(0, 2, 0.0004), pair(1, 2, 0.012)], n_groups: 3, alpha: 0.05, method: "Tukey HSD", key: "tukey",
    omnibus_p: 0.01, adjusted: true, groups: [],
  };
  const params = { ...DEFAULT_PARAMS, more: { ...DEFAULT_PARAMS.more, posthoc: "tukey" as const } };
  return statisticalTestAnalysisResult(id, DS, "posthoc", DEFAULT_SELECTION, params, labels, describeResult({ id: "posthoc", data }, labels, 0.05));
}
const combo = (name: string) => screen.getByRole("combobox", { name });
const note = () => screen.getByTestId("stat-error-note");
const sig = () => (useApp.getState().statMarks.box as { sig?: Record<string, unknown> } | undefined)?.sig;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.mocked(statsBox).mockRejectedValue(new Error("offline"));
  useApp.setState({
    theme: "dark", accent: "violet", datasets: [DS, SHEET, CSV_SHEET], activeId: "ds", selection: null, yKeys: [1], xKey: null,
    seriesOrder: null, statStageSeed: null, statMarks: {}, history: [], future: [],
    analysisResults: [posthoc("good", ["grp = A", "grp = B", "grp = C"]), posthoc("wrong", ["grp = A", "grp = B", "grp = Z"])],
  });
});

describe("marks from supplied p-values, through the controls", () => {
  it("shows the source select disabled, with the reason, while compare is on (acceptance 14, U-c)", async () => {
    render(<StatStage />);
    const source = combo("significance p-value source");
    expect(source).toBeEnabled();
    await userEvent.selectOptions(combo("significance marks"), "brackets");
    await waitFor(() => expect(combo("significance p-value source")).toBeDisabled());
    expect(combo("significance p-value source")).toHaveAttribute("title", expect.stringMatching(/"compare" to off/));
    await userEvent.selectOptions(combo("significance marks"), "off");
    await waitFor(() => expect(combo("significance p-value source")).toBeEnabled());
  });

  it("has no source until the user picks one, then draws from the picked result", async () => {
    render(<StatStage />);
    await waitFor(() => expect(combo("significance p-value source")).toHaveValue(""));
    expect(sig()).toBeUndefined();
    expect(screen.queryByRole("combobox", { name: "post-hoc result" })).toBeNull();

    await userEvent.selectOptions(combo("significance p-value source"), "result");
    await waitFor(() => expect(screen.getByTestId("stat-sig-error")).toHaveTextContent("Pick a post-hoc"));
    await userEvent.selectOptions(combo("post-hoc result"), "good");
    await waitFor(() => expect(note()).toHaveTextContent("p-values from"));
    expect(note()).toHaveTextContent("* p<0.05 ** p<0.01 *** p<0.001; ns not drawn");
    expect(sig()).toMatchObject({ source: { kind: "result", resultId: "good" }, showP: false, showNs: false });

    await userEvent.click(screen.getByRole("checkbox", { name: "show p" }));
    await waitFor(() => expect(note()).toHaveTextContent("p-values shown"));
    expect(sig()).toMatchObject({ showP: true });
  });

  it("refuses a result run on other groups, and undo takes each step back", async () => {
    render(<StatStage />);
    await userEvent.selectOptions(combo("significance p-value source"), "result");
    await userEvent.selectOptions(combo("post-hoc result"), "wrong");
    await waitFor(() => expect(screen.getByTestId("stat-sig-error")).toHaveTextContent('names "grp = Z"'));
    expect(screen.getByTestId("stat-sig-error")).toHaveTextContent("no p-values for the plot's \"grp = C\"");
    expect(screen.queryByTestId("stat-error-note")).toBeNull();

    act(() => useApp.getState().undo());
    await waitFor(() => expect(screen.getByTestId("stat-sig-error")).toHaveTextContent("Pick a post-hoc"));
    act(() => useApp.getState().undo());
    await waitFor(() => expect(combo("significance p-value source")).toHaveValue(""));
    expect(sig()).toBeUndefined();
  });

  it("edits the thresholds, commits only valid ones, and says what is wrong with the rest", async () => {
    render(<StatStage />);
    await userEvent.selectOptions(combo("significance p-value source"), "result");
    await userEvent.selectOptions(combo("post-hoc result"), "good");
    await waitFor(() => expect(note()).toHaveTextContent("p-values from"));

    const cut = screen.getByRole("textbox", { name: "cut-off 1" });
    await userEvent.clear(cut);
    await userEvent.type(cut, "0.001");
    await userEvent.tab();
    await waitFor(() => expect(screen.getByTestId("sig-levels-error")).toHaveTextContent("cut-offs must fall"));
    expect(sig()?.levels).toEqual([{ mark: "*", below: 0.05 }, { mark: "**", below: 0.01 }, { mark: "***", below: 0.001 }]);

    await userEvent.clear(cut);
    await userEvent.type(cut, "0.5");
    await userEvent.tab();
    await waitFor(() => expect(sig()?.levels).toEqual([{ mark: "*", below: 0.5 }, { mark: "**", below: 0.01 }, { mark: "***", below: 0.001 }]));
    await waitFor(() => expect(note()).toHaveTextContent("* p<0.5"));
  });

  it("draws from three worksheet columns, and the picker offers text columns for the groups only", async () => {
    render(<StatStage />);
    await userEvent.selectOptions(combo("significance p-value source"), "sheet");
    await userEvent.selectOptions(combo("p-value worksheet"), "pairs");
    const groupA = combo("group A column");
    expect(Array.from(groupA.querySelectorAll("option")).map((o) => o.textContent)).toEqual(["pick…", "A", "B"]);
    expect(Array.from(combo("p-value column").querySelectorAll("option")).map((o) => o.textContent)).toEqual(["pick…", "p"]);
    await userEvent.selectOptions(groupA, "0");
    await userEvent.selectOptions(combo("group B column"), "1");
    await userEvent.selectOptions(combo("p-value column"), "2");
    await waitFor(() => expect(note()).toHaveTextContent("worksheet pairs"));
    expect(sig()).toMatchObject({ source: { kind: "sheet", datasetId: "pairs", a: 0, b: 1, p: 2 } });
  });

  it("offers every text column of a CSV pair table, not only the categorical first one", async () => {
    render(<StatStage />);
    await userEvent.selectOptions(combo("significance p-value source"), "sheet");
    await userEvent.selectOptions(combo("p-value worksheet"), "csv");
    const groupB = combo("group B column");
    expect(Array.from(groupB.querySelectorAll("option")).map((o) => o.textContent)).toEqual(["pick…", "A", "B"]);
    await userEvent.selectOptions(combo("group A column"), "0");
    await userEvent.selectOptions(groupB, "-2");
    await userEvent.selectOptions(combo("p-value column"), "1");
    await waitFor(() => expect(note()).toHaveTextContent("worksheet pairs.csv"));
    expect(sig()).toMatchObject({ source: { kind: "sheet", datasetId: "csv", a: 0, b: -2, p: 1 } });
    expect(screen.queryByTestId("stat-sig-error")).toBeNull();
  });
});
