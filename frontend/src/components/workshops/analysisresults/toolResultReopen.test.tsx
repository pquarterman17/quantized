// The Library side of the Time series, DOE and Profiler result kinds (owner
// decision 2026-11-25): each shows as a result book with its status, reopens
// into its tool with the recorded settings on the recorded source, goes out
// of date with its source, and a profile whose Fit Model result is deleted
// reads "Source missing".

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import type { AnalysisResult } from "../../../lib/analysisResult";
import type { Dataset } from "../../../lib/types";
import {
  designResult, designSource, effectsResult, fitResult, fitSource, profileResult, tsRecipe, tsResult, tsSource,
} from "../../../lib/toolResultKinds.testkit";
import { removeAnalysisResult } from "../../../store/analysisResultActions";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { useDoeStore } from "../../../store/doe";
import { useProfilerStore } from "../../../store/profiler";
import { useToolResultRequest } from "../../../store/toolResultRequest";
import { useApp } from "../../../store/useApp";
import AnalysisResultPanel from "./AnalysisResultPanel";

beforeEach(() => {
  useToolResultRequest.setState({ timeSeries: null, doe: null, profiler: null });
  useAnalysisExtras.setState({ open: [] });
  useDoeStore.setState({ open: false });
  useProfilerStore.setState({ open: false, request: null });
  useApp.setState({ activeId: null, staleDatasets: [], staleFits: [], history: [], future: [], editableFigures: [], plotWindows: [], focusedWindowId: null, stageTab: "plot", status: "" });
});

function openBook(result: AnalysisResult, datasets: Dataset[], results: AnalysisResult[] = [result]) {
  useApp.setState({ datasets, analysisResults: results, openAnalysisResultId: result.id });
  render(<AnalysisResultPanel />);
  fireEvent.click(screen.getByRole("tab", { name: "Result book" }));
  return screen.getByRole("tabpanel");
}

const filled = designSource([5, 11, 6, 12]);

describe("reopen in tool", () => {
  it("Time series: the tool opens on the source with the saved tool, channel and options", () => {
    const panel = openBook(tsResult(), [tsSource]);
    expect(within(panel).getByText("Time series: ACF / PACF")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Reopen in tool" }));
    expect(useApp.getState().activeId).toBe("log");
    expect(useAnalysisExtras.getState().open).toContain("time-series");
    expect(useToolResultRequest.getState().timeSeries).toEqual(tsRecipe);
  });

  it("DOE design: the workshop opens on the design worksheet with the saved setup", () => {
    const panel = openBook(designResult(), [designSource()]);
    fireEvent.click(within(panel).getByRole("button", { name: "Reopen in tool" }));
    expect(useApp.getState().activeId).toBe("design");
    expect(useDoeStore.getState().open).toBe(true);
    expect(useToolResultRequest.getState().doe?.setup).toMatchObject({ design: "full_factorial", k: 2 });
  });

  it("DOE effects: the workshop opens on the design worksheet", () => {
    const panel = openBook(effectsResult(filled), [filled]);
    fireEvent.click(within(panel).getByRole("button", { name: "Reopen in tool" }));
    expect(useApp.getState().activeId).toBe("design");
    expect(useDoeStore.getState().open).toBe(true);
  });

  it("Profiler: the profiler opens on the saved Fit Model result with the saved settings", () => {
    const panel = openBook(profileResult(), [fitSource], [fitResult(), profileResult()]);
    expect(within(panel).getByText("Current")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Reopen in tool" }));
    expect(useProfilerStore.getState().open).toBe(true);
    expect(useToolResultRequest.getState().profiler).toMatchObject({ fitResultId: "fit-1", settings: { T: 600 } });
  });
});

describe("freshness in the Library", () => {
  it("a changed source makes the saved result out of date and withholds reopen and report", () => {
    const changed = { ...tsSource, data: { ...tsSource.data, values: tsSource.data.values.map((r) => [r[0]! * 2, r[1]!]) } };
    const panel = openBook(tsResult(), [changed]);
    expect(within(panel).getByText("Out of date")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Reopen in tool" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "Send to report: Correlogram" })).toBeDisabled();
  });

  it("deleting the Fit Model result leaves the profile Source missing", () => {
    const profile = profileResult();
    const panel = openBook(profile, [fitSource], [fitResult(), profile]);
    expect(within(panel).getByText("Current")).toBeInTheDocument();
    act(() => removeAnalysisResult("fit-1"));
    expect(useApp.getState().analysisResults.map((r) => r.id)).toEqual(["profile-1"]);
    expect(screen.getAllByText("Source missing").length).toBeGreaterThan(0);
    expect(within(screen.getByRole("tabpanel")).getByRole("button", { name: "Reopen in tool" })).toBeDisabled();
  });
});
