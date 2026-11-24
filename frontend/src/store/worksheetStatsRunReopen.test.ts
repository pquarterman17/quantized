// "Open in Frequency count" (OPEN_ITEMS row 12, writer 20, reopen gaps lane): the
// Data > Frequency count prompt is refilled with the recorded column and binning,
// and its commit replaces the old output in one undo step or adds a new one. FAIL
// CLOSED: a version-1 result, a moved column, a deleted source or an incomplete
// record never opens the prompt (and never counts a different column).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { frequencyCountSeed } from "../lib/frequencyCountReopenSeed";
import type { Dataset } from "../lib/types";
import { useToolReopen } from "./toolReopen";
import { openCommittedResultInTool } from "./toolReopenOpen";
import { useApp } from "./useApp";

const { askParamsMock } = vi.hoisted(() => ({ askParamsMock: vi.fn() }));
vi.mock("./paramDialog", () => ({ askParams: askParamsMock }));
vi.mock("./toasts", () => ({ toast: vi.fn() }));

import { runFrequencyCount } from "./worksheetStatsRun";

const sheet: Dataset = {
  id: "w", name: "scan", workbookId: "B",
  data: { time: [1, 2, 3, 4], values: [[1, 10], [2, 20], [3, 30], [10, 40]], labels: ["M1", "M2"], units: ["emu", "K"], metadata: { x_column_name: "T" } },
};
const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "w");
const result = () => useApp.getState().analysisResults[0]!;
const dialogFields = () => askParamsMock.mock.calls.at(-1)![1] as { key: string; default: unknown; options?: string[] }[];
const fieldDefault = (key: string) => dialogFields().find((f) => f.key === key)?.default;
const open = (): boolean => openCommittedResultInTool(result().id);

async function commitOnce(): Promise<void> {
  askParamsMock.mockResolvedValue({ column: "B: M2", bins: "2", width: "", min: "5", max: "45" });
  await runFrequencyCount();
  expect(outputs()).toHaveLength(1);
  useApp.getState().setActive("w");
  askParamsMock.mockClear();
}

beforeEach(() => {
  askParamsMock.mockReset();
  useToolReopen.setState({ sessions: {} });
  useApp.setState({ datasets: [sheet], activeId: "w", history: [], future: [], status: "", analysisResults: [], staleDatasets: [], recalcMode: "manual" });
});

describe("Frequency count reopens its prompt", () => {
  it("refills the recorded column and binning, and a Replace rewrites the old output in one undo step", async () => {
    await commitOnce();
    const old = outputs()[0]!;
    askParamsMock.mockResolvedValue({ column: "A: M1", bins: "3", width: "", min: "", max: "", output: "Replace “scan — frequency of M2”" });
    expect(open()).toBe(true);
    await vi.waitFor(() => expect(outputs()[0]!.data.time).toHaveLength(3)); // the run finished: new binning landed
    expect(fieldDefault("column")).toBe("B: M2");
    expect(fieldDefault("bins")).toBe("2");
    expect(fieldDefault("min")).toBe("5");
    expect(fieldDefault("max")).toBe("45");
    expect(fieldDefault("width")).toBe("");
    expect(fieldDefault("output")).toBe("Replace “scan — frequency of M2”");
    expect(outputs()).toHaveLength(1);
    expect(outputs()[0]!.id).toBe(old.id);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(result().producer.version).toBe(2);
    expect(useToolReopen.getState().sessions["frequency-count"]).toBeUndefined(); // the session ended with the run
    useApp.getState().undo();
    expect(outputs()[0]!.data.time).toHaveLength(2);
    expect(useApp.getState().analysisResults).toHaveLength(1);
  });

  it("choosing 'Add as a new output' keeps the old output", async () => {
    await commitOnce();
    askParamsMock.mockResolvedValue({ column: "A: M1", bins: "3", width: "", min: "", max: "", output: "Add as a new output" });
    expect(open()).toBe(true);
    await vi.waitFor(() => expect(outputs()).toHaveLength(2));
    expect(useApp.getState().analysisResults).toHaveLength(2);
  });

  it("cancelling the prompt changes nothing and ends the session", async () => {
    await commitOnce();
    askParamsMock.mockResolvedValue(null);
    expect(open()).toBe(true);
    await vi.waitFor(() => expect(useToolReopen.getState().sessions["frequency-count"]).toBeUndefined());
    expect(askParamsMock.mock.calls).toHaveLength(1); // it was asked, and the cancel ended the session
    expect(outputs()).toHaveLength(1);
  });

  it("a result saved before the column was recorded (version 1) refuses and opens nothing", async () => {
    await commitOnce();
    useApp.setState((s) => ({ analysisResults: s.analysisResults.map((r) => ({ ...r, producer: { ...r.producer, version: 1 } })) }));
    expect(open()).toBe(false);
    expect(useApp.getState().status).toContain("saved before its settings were recorded");
    expect(askParamsMock).not.toHaveBeenCalled();
  });

  it("a moved column is NOT guessed: the prompt does not open", async () => {
    await commitOnce();
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "w" ? { ...d, data: { ...d.data, labels: ["M2", "M1"] } } : d)) }));
    expect(open()).toBe(false);
    expect(useApp.getState().status).toContain("“M2” is no longer at its place");
    expect(askParamsMock).not.toHaveBeenCalled();
    expect(useToolReopen.getState().sessions["frequency-count"]).toBeUndefined();
  });

  it("a deleted source does not open the prompt", async () => {
    await commitOnce();
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "w") }));
    expect(open()).toBe(false);
    expect(askParamsMock).not.toHaveBeenCalled();
  });

  it("a recorded column that is no longer a numeric value column refuses", async () => {
    await commitOnce();
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "w" ? { ...d, data: { ...d.data, cat_levels: { 1: ["a", "b"] } } } : d)) }));
    expect(open()).toBe(true);
    await vi.waitFor(() => expect(useApp.getState().status).toContain("no longer a numeric value column"));
    expect(askParamsMock).not.toHaveBeenCalled();
    expect(useToolReopen.getState().sessions["frequency-count"]).toBeUndefined();
  });

  it("the worksheet's own X is a recordable pick", async () => {
    askParamsMock.mockResolvedValue({ column: "x: T", bins: "", width: "", min: "", max: "" });
    await runFrequencyCount();
    useApp.getState().setActive("w");
    askParamsMock.mockClear();
    askParamsMock.mockResolvedValue(null);
    expect(open()).toBe(true);
    await vi.waitFor(() => expect(useToolReopen.getState().sessions["frequency-count"]).toBeUndefined());
    expect(fieldDefault("column")).toBe("x: T");
  });
});

describe("session ownership", () => {
  it("a finished run does not end the session of a LATER reopen (another result's prompt)", async () => {
    await commitOnce();
    let release: ((v: Record<string, string> | null) => void) | null = null;
    askParamsMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    expect(open()).toBe(true); // run A, prompt pending
    await vi.waitFor(() => expect(release).not.toBeNull()); // A is waiting on its prompt
    const first = useToolReopen.getState().sessions["frequency-count"]!.nonce;
    useToolReopen.getState().start("frequency-count", { ...useToolReopen.getState().sessions["frequency-count"]!, resultId: "other" }); // B replaces the session
    const second = useToolReopen.getState().sessions["frequency-count"]!.nonce;
    expect(second).not.toBe(first);
    release!(null); // A's prompt is cancelled and its run finishes
    await new Promise((r) => setTimeout(r, 20)); // let A's finally run
    expect(useToolReopen.getState().sessions["frequency-count"]?.nonce).toBe(second);
  });
});

describe("frequencyCountSeed is strict", () => {
  const bad: [Record<string, number | string | null>, string][] = [
    [{ column: 1, bins: null, width: null, min: null }, "max missing"],
    [{ column: 1.5, bins: null, width: null, min: null, max: null }, "fractional column"],
    [{ column: -2, bins: null, width: null, min: null, max: null }, "below the X column"],
    [{ column: 1, bins: "3", width: null, min: null, max: null }, "text bins"],
  ];
  it.each(bad)("rejects %j (%s)", (settings) => {
    expect(frequencyCountSeed(settings)).toBeNull();
  });
  it("reads a complete record", () => {
    expect(frequencyCountSeed({ column: -1, bins: 4, width: null, min: 0, max: null })).toEqual({ column: -1, bins: 4, width: null, min: 0, max: null });
  });
});
