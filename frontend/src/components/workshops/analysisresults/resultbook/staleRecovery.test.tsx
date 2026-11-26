// Stale-result recovery through the real result book path (acceptance finding
// A5): the visible guidance and the one action must agree in every freshness
// state, and following the visible path must reopen the tool on the CURRENT
// data while the saved result stays untouched.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseWorkspace, serializeWorkspace } from "../../../../lib/workspace";
import { snapshotRecovery } from "../../../../lib/snapshotRecovery";
import type { SnapshotResultState } from "../../../../lib/analysisResultFreshness";
import type { Dataset } from "../../../../lib/types";
import { useDistributionRequestStore } from "../../../../store/distribution";
import { useApp } from "../../../../store/useApp";
import { distribution, source, variability, variabilitySource } from "../resultBook.testkit";
import AnalysisResultPanel from "../AnalysisResultPanel";

vi.mock("../../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

beforeEach(() => {
  useDistributionRequestStore.setState({ request: null });
  useApp.setState({
    datasets: [], activeId: null, analysisResults: [], openAnalysisResultId: null,
    staleDatasets: [], staleFits: [], history: [], future: [], editableFigures: [], plotWindows: [],
    focusedWindowId: null, stageTab: "plot", distributionOpen: false,
  });
});

function openBook() {
  render(<AnalysisResultPanel />);
  fireEvent.click(screen.getByRole("tab", { name: "Result book" }));
  return screen.getByRole("tabpanel");
}

/** Save the workspace, change a source's values in the saved file, reload. */
function saveEditReload(sourceId: string, edit: (data: Dataset["data"]) => Dataset["data"]): void {
  const doc = JSON.parse(serializeWorkspace({ ...useApp.getState() })) as { datasets: { id: string; data: Dataset["data"] }[] };
  const target = doc.datasets.find((d) => d.id === sourceId)!;
  target.data = edit(target.data);
  useApp.getState().loadWorkspace(parseWorkspace(JSON.stringify(doc)));
}

describe("stale result recovery", () => {
  it("save, edit the source, reopen, review and rerun: current data, saved settings, prior result kept", () => {
    const saved = distribution();
    useApp.setState({ datasets: [source], analysisResults: [saved], activeId: "source" });
    saveEditReload("source", (data) => ({ ...data, values: [[9], [2], [4]] }));
    const reloaded = useApp.getState().analysisResults[0];
    useApp.setState({ openAnalysisResultId: reloaded.id });
    const panel = openBook();
    expect(within(panel).getByText("Out of date", { selector: ".qz-analysis-status" })).toBeInTheDocument();
    // The guidance names the visible action, and that action is enabled.
    expect(within(panel).getByRole("note")).toHaveTextContent(/Review and rerun reopens the tool/);
    const action = within(panel).getByRole("button", { name: "Review and rerun" });
    expect(action).toBeEnabled();
    expect(action).toHaveAttribute("title", expect.stringMatching(/creates a new result; this one is kept/));
    fireEvent.click(action);
    expect(useDistributionRequestStore.getState().request).toMatchObject({ col: 0, fitDist: "none", percentileInput: 90 });
    const after = useApp.getState();
    expect(after).toMatchObject({ activeId: "source", distributionOpen: true, openAnalysisResultId: null });
    expect(after.datasets.find((d) => d.id === "source")!.data.values).toEqual([[9], [2], [4]]); // the CURRENT input
    expect(after.analysisResults).toHaveLength(1);
    expect(after.analysisResults[0]).toBe(reloaded); // not overwritten, not republished
  });

  it("keeps the stale-publication guard while offering the rerun", () => {
    const edited = { ...source, data: { ...source.data, values: [[9], [2], [4]] } };
    useApp.setState({ datasets: [edited], analysisResults: [distribution()], openAnalysisResultId: "distribution" });
    const panel = openBook();
    expect(within(panel).getByRole("button", { name: "Send to report: Summary" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "Copy table: Summary" })).toBeEnabled();
  });

  it("an incompatible recipe: says the saved settings no longer fit, offers no reopen, leaves the tool untouched", () => {
    const saved = variability();
    const narrowed = { ...variabilitySource, data: { ...variabilitySource.data, values: [[1], [2], [4]], labels: ["Signal"], units: ["V"] } };
    useApp.setState({ datasets: [narrowed], analysisResults: [saved], openAnalysisResultId: saved.id });
    const panel = openBook();
    expect(within(panel).getByRole("note")).toHaveTextContent(/no longer fit “Raw trace”.*analysis launcher.*stays available/);
    const action = within(panel).getByRole("button", { name: "Reopen in tool" });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute("title", expect.stringMatching(/no longer fit/));
    fireEvent.click(action);
    expect(useApp.getState().distributionOpen).toBe(false);
    expect(useApp.getState().analysisResults).toEqual([saved]);
  });

  it("a missing source: names the problem, the action is disabled, the saved values stay readable", () => {
    useApp.setState({ datasets: [], analysisResults: [distribution()], openAnalysisResultId: "distribution" });
    const panel = openBook();
    expect(within(panel).getByRole("note")).toHaveTextContent(/source worksheet is missing.*Restore or re-import/);
    expect(within(panel).getByRole("button", { name: "Reopen in tool" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "Copy table: Summary" })).toBeEnabled();
  });

  it("Cancel: abandoning the reviewed tool leaves the saved result and the data as they were", () => {
    const edited = { ...source, data: { ...source.data, values: [[9], [2], [4]] } };
    const saved = distribution();
    useApp.setState({ datasets: [edited], analysisResults: [saved], openAnalysisResultId: saved.id });
    fireEvent.click(within(openBook()).getByRole("button", { name: "Review and rerun" }));
    // The tool is cancelled without running.
    useApp.setState({ distributionOpen: false });
    useDistributionRequestStore.setState({ request: null });
    expect(useApp.getState().analysisResults).toEqual([saved]);
    expect(useApp.getState().datasets).toEqual([edited]);
  });
});

describe("snapshotRecovery: note and action agree in every state", () => {
  const cases: [SnapshotResultState, boolean, string, boolean, RegExp | null][] = [
    ["current", true, "reopen", true, null],
    ["pending", true, "reopen", true, /still loading/],
    ["out-of-date", true, "review-rerun", true, /Review and rerun/],
    ["out-of-date", false, "unbindable", false, /no longer fit/],
    ["source-missing", true, "source-missing", false, /missing/],
    ["source-missing", false, "source-missing", false, /missing/],
  ];
  it.each(cases)("%s, recipe ready %s", (state, ready, kind, canReopen, note) => {
    const r = snapshotRecovery(state, ready, "Tool", "S");
    expect(r.kind).toBe(kind);
    expect(r.canReopen).toBe(canReopen);
    if (note) expect(r.note).toMatch(note); else expect(r.note).toBeNull();
    // Guidance may only point at an action that is enabled.
    if (!r.canReopen) expect(r.note ?? "").not.toMatch(/Review and rerun|reopen in the tool/i);
  });
});
