// Profiler as a saved result (owner decision 2026-11-25): a profile is saved
// against a SAVED Fit Model result (never a live, unsaved fit), offers the
// book's table actions, and a Library reopen restores its settings.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsProfile, type ProfilerModel } from "../../../lib/api/modelEvaluate";
import { PROFILER_RESULT, fitModelDigest } from "../../../lib/toolResultKinds";
import { PROFILE, fitResult, fitSource } from "../../../lib/toolResultKinds.testkit";
import { useProfilerStore } from "../../../store/profiler";
import { useToolResultRequest } from "../../../store/toolResultRequest";
import { useApp } from "../../../store/useApp";
import { ProfilerPanel } from "./ProfilerPanel";

vi.mock("../../../lib/api/modelEvaluate", () => ({ statsProfile: vi.fn(), statsContour: vi.fn(), statsDesirability: vi.fn() }));
const { reportInline, copyTextMock, sent } = vi.hoisted(() => ({ reportInline: vi.fn(), copyTextMock: vi.fn(), sent: [] as [string, number][] }));
vi.mock("../../../store/analysisResultActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../store/analysisResultActions")>()),
  sendAnalysisInlineTableToReport: reportInline,
}));
vi.mock("../../../lib/clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/clipboard")>()), copyText: copyTextMock,
}));

class MockResizeObserver { observe(): void {} disconnect(): void {} }
const fit = fitResult();
const MODEL = fit.parameters!.model as unknown as ProfilerModel;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  sent.length = 0;
  reportInline.mockImplementation(async (id: string, index: number) => { sent.push([id, index]); return true; });
  copyTextMock.mockResolvedValue(true);
  vi.mocked(statsProfile).mockImplementation((body) => Promise.resolve({ ...PROFILE, alpha: body.alpha ?? 0.05, current: { ...PROFILE.current, settings: body.current } }));
  useApp.setState({ datasets: [fitSource], activeId: fitSource.id, analysisResults: [fit], status: "", history: [], future: [], staleDatasets: [], staleFits: [] });
  useProfilerStore.setState({ open: true, request: null });
  useToolResultRequest.setState({ timeSeries: null, doe: null, profiler: null });
});

const book = () => screen.getByRole("region", { name: "Profile result" });

describe("Profiler result book", () => {
  it("saves a profile of a saved Fit Model result with its reference, settings and provenance, then offers the book's actions", async () => {
    render(<ProfilerPanel />);
    const save = await waitFor(() => { const b = within(book()).getByRole("button", { name: "Save result" }); expect(b).toBeEnabled(); return b; });
    fireEvent.click(save);
    await waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(2));
    const saved = useApp.getState().analysisResults[1]!;
    expect(saved).toMatchObject({ producer: { id: PROFILER_RESULT }, sources: [{ datasetId: "film" }], sourceFingerprint: fit.sourceFingerprint,
      parameters: { recipe: { fitResultId: "fit-1", fitDigest: fitModelDigest(fit), settings: { T: 600 }, alpha: 0.05, goal: null },
        algorithm: { id: "profile-model", version: 1 }, inputs: { items: [{ datasetId: "film" }] } } });
    expect(saved.tables!.map((t) => t.title)).toEqual(["Current prediction", "Factor settings", "Prediction trace: T"]);
    expect(within(book()).getByRole("button", { name: "Save result" })).toBeDisabled();
    fireEvent.click(within(book()).getByRole("button", { name: "Send to report: Current prediction" }));
    await waitFor(() => expect(sent).toEqual([[saved.id, 0]]));
    fireEvent.click(within(book()).getByRole("button", { name: "Copy table: Prediction trace: T" }));
    await waitFor(() => expect(useApp.getState().status).toMatch(/^copied /));
    expect(copyTextMock).toHaveBeenCalledWith(expect.stringContaining("2.9"));
    fireEvent.click(within(book()).getByRole("button", { name: "Open as worksheet: Prediction trace: T" }));
    await waitFor(() => expect(useApp.getState().datasets.some((d) => d.name.endsWith("Prediction trace: T (frozen)"))).toBe(true));
  });

  it("references the saved Fit Model result when Fit Model hands over the same model", async () => {
    useProfilerStore.setState({ request: { model: MODEL, label: "y" } });
    render(<ProfilerPanel />);
    await waitFor(() => expect(within(book()).getByRole("button", { name: "Save result" })).toBeEnabled());
  });

  it("refuses to save a profile of a live fit that was never saved (fail closed)", async () => {
    useApp.setState({ analysisResults: [] });
    useProfilerStore.setState({ request: { model: MODEL, label: "y" } });
    render(<ProfilerPanel />);
    await screen.findByText(/y = 2\.6/);
    const save = within(book()).getByRole("button", { name: "Save result" });
    expect(save).toBeDisabled();
    expect(save.getAttribute("title")).toMatch(/Save the Fit Model result first/);
  });

  it("refuses to save while the Fit Model result is out of date", async () => {
    useApp.setState({ analysisResults: [{ ...fit, stale: true }] });
    render(<ProfilerPanel />);
    await screen.findByText(/y = 2\.6/);
    expect(within(book()).getByRole("button", { name: "Save result" }).getAttribute("title")).toMatch(/out of date/);
  });

  it("restores the saved settings and confidence from a Library reopen", async () => {
    act(() => useToolResultRequest.getState().request({ profiler: { fitResultId: "fit-1", fitDigest: fitModelDigest(fit), settings: { T: 750, Gone: 1 }, alpha: 0.01, goal: null } }));
    render(<ProfilerPanel />);
    await waitFor(() => expect(vi.mocked(statsProfile).mock.calls.at(-1)![0]).toMatchObject({ current: { T: 750 }, alpha: 0.01 }));
    expect(vi.mocked(statsProfile).mock.calls.at(-1)![0].current).not.toHaveProperty("Gone");
    expect(useToolResultRequest.getState().profiler).toBeNull();
  });
});
