// "Open in Signal Processing (Spectrogram)" (OPEN_ITEMS row 12, writer 12, reopen
// gaps lane): the recorded request and the signal column come back exactly, and
// a Replace rewrites the map worksheet in one undo step. FAIL CLOSED: a version-1
// result, a moved signal column, an incomplete record and a deleted source open
// without settings and with Replace off.

import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { spectrogramSeed } from "../../../lib/spectrogramReopenSeed";
import type { DataStruct, Dataset } from "../../../lib/types";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import SignalProcessingPanel from "../signalprocessing/SignalProcessingPanel";

vi.mock("../../../lib/api/spectrogram", () => ({ runSpectrogram: vi.fn() }));
vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
}));
const { runSpectrogram } = await import("../../../lib/api/spectrogram");

const N = 64;
const dataset = (labels = ["V1", "V2"]): Dataset => ({
  id: "src", name: "scope",
  data: {
    time: Array.from({ length: N }, (_, i) => i / 100), values: Array.from({ length: N }, (_, i) => [Math.sin(i), Math.cos(i)]),
    labels, units: ["mV", "mV"], metadata: { xUnit: "s" },
  },
});

function fakeMap(tag = 1): DataStruct {
  const time: number[] = [];
  const values: number[][] = [];
  for (let s = 0; s < 3; s++) for (let f = 0; f < 9; f++) { time.push(0.08 + s * 0.08); values.push([f * 6.25, s + f + tag]); }
  return {
    time, values, labels: ["Frequency", "V2 · Spectrogram"], units: ["1/s", "mV²·s"],
    metadata: { spectralAnalysis: { version: 1, operation: "spectrogram", parameters: { segments: 3, frequencies: 9 } } },
  };
}

const results = () => useApp.getState().analysisResults;
const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "src");
const session = () => useToolReopen.getState().sessions["signal-spectrogram"]!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runSpectrogram).mockImplementation(() => Promise.resolve(fakeMap()));
  useToolReopen.setState({ sessions: {} });
  useApp.setState({
    datasets: [dataset()], activeId: "src", yKeys: [0], signalProcessingOpen: true, history: [], future: [], analysisResults: [],
    staleDatasets: [], recalcMode: "manual", status: "",
  });
});

/** Commit a non-default spectrogram (channel V2, blackman, 25 % overlap, an X range) through the panel, then close it. */
async function commitOnce() {
  const view = render(<SignalProcessingPanel />);
  fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "spectrogram" } });
  fireEvent.change(screen.getByLabelText("Signal column"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Segment length"), { target: { value: "16" } });
  fireEvent.change(screen.getByLabelText("Overlap"), { target: { value: "25" } });
  fireEvent.change(screen.getByLabelText("Window"), { target: { value: "blackman" } });
  fireEvent.change(screen.getByLabelText("Scaling"), { target: { value: "amplitude" } });
  fireEvent.change(screen.getByLabelText("Detrend each segment"), { target: { value: "linear" } });
  fireEvent.click(screen.getByLabelText("Limit output to an X range"));
  fireEvent.change(screen.getByLabelText("X minimum"), { target: { value: "0.1" } });
  fireEvent.change(screen.getByLabelText("X maximum"), { target: { value: "0.5" } });
  const add = screen.getByRole("button", { name: "Add as map worksheet" });
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  await waitFor(() => expect(outputs()).toHaveLength(1));
  view.unmount();
  useToolReopen.setState({ sessions: {} });
  useApp.setState({ signalProcessingOpen: false, activeId: "src" });
}

const reopen = (): boolean => { let ok = false; act(() => { ok = openCommittedResultInTool(results()[0]!.id); }); return ok; };

describe("Spectrogram reopens in Signal Processing", () => {
  it("restores the exact recorded request, with Replace preselected", async () => {
    await commitOnce();
    expect(results()[0]!.producer.version).toBe(2);
    expect(reopen()).toBe(true);
    expect(useApp.getState().signalProcessingOpen).toBe(true);
    render(<SignalProcessingPanel />);
    await waitFor(() => expect(screen.getByLabelText("Signal column")).toHaveValue("1"));
    expect(screen.getByLabelText("Segment length")).toHaveValue("16");
    expect(screen.getByLabelText("Overlap")).toHaveValue("25");
    expect(screen.getByLabelText("Window")).toHaveValue("blackman");
    expect(screen.getByLabelText("Scaling")).toHaveValue("amplitude");
    expect(screen.getByLabelText("Detrend each segment")).toHaveValue("linear");
    expect(screen.getByLabelText("X minimum")).toHaveValue("0.1"); // the recorded range, not the data extent
    expect(screen.getByLabelText("X maximum")).toHaveValue("0.5");
    expect(screen.getByRole("radio", { name: /Replace “scope \(spectrogram\)”/ })).toBeChecked();
    await waitFor(() => expect(vi.mocked(runSpectrogram).mock.calls.at(-1)![0]).toMatchObject({
      channel: 1, segment_len: 16, window: "blackman", overlap: 0.25, scaling: "amplitude", detrend: "linear", x_min: 0.1, x_max: 0.5,
    }));
  });

  it("Replace rewrites the old map worksheet in ONE undo step", async () => {
    await commitOnce();
    const old = outputs()[0]!;
    reopen();
    render(<SignalProcessingPanel />);
    await waitFor(() => expect(screen.getByLabelText("Window")).toHaveValue("blackman"));
    fireEvent.change(screen.getByLabelText("Window"), { target: { value: "hamming" } });
    vi.mocked(runSpectrogram).mockImplementation(() => Promise.resolve(fakeMap(100)));
    const replace = await screen.findByRole("button", { name: "Replace “scope (spectrogram)”" });
    await waitFor(() => expect(replace).toBeEnabled());
    fireEvent.click(replace);
    await waitFor(() => expect(outputs()[0]!.data.values[0]![1]).toBe(100));
    expect(outputs()).toHaveLength(1);
    expect(outputs()[0]!.id).toBe(old.id);
    expect(results()).toHaveLength(1);
    act(() => useApp.getState().undo());
    expect(outputs()[0]!.data.values[0]![1]).toBe(1);
  });

  it("a version-1 result (no signal column recorded) refuses and opens nothing", async () => {
    await commitOnce();
    useApp.setState((s) => ({ analysisResults: s.analysisResults.map((r) => ({ ...r, producer: { ...r.producer, version: 1 } })) }));
    expect(reopen()).toBe(false);
    expect(useApp.getState().signalProcessingOpen).toBe(false);
    expect(useApp.getState().status).toContain("saved before its settings were recorded");
  });

  it("a moved signal column is NOT guessed: no settings, the reason, Replace off", async () => {
    await commitOnce();
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "src" ? dataset(["V2", "V1"]) : d)) }));
    expect(reopen()).toBe(true);
    expect(session().seed).toBeNull();
    expect(session().replaceBlocked).toContain("“V2” is no longer at its place");
    expect(session().mode).toBe("new");
    render(<SignalProcessingPanel />);
    await waitFor(() => expect(screen.getByLabelText("Segment length")).toHaveValue("256")); // the defaults, not the record
  });

  it("an incomplete record is not seeded", async () => {
    await commitOnce();
    const r = results()[0]!;
    const settings = { ...(r.parameters!["settings"] as Record<string, unknown>) };
    delete settings["scaling"];
    useApp.setState((s) => ({ analysisResults: s.analysisResults.map((x) => (x.id === r.id ? { ...x, parameters: { ...x.parameters, settings } as typeof x.parameters } : x)) }));
    expect(reopen()).toBe(true);
    expect(session().seed).toBeNull();
    expect(session().replaceBlocked).toContain("incomplete");
  });

  it("a deleted source opens without settings and cannot replace", async () => {
    await commitOnce();
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "src") }));
    expect(reopen()).toBe(true);
    expect(session().seed).toBeNull();
    expect(session().replaceBlocked).toContain("source worksheet is missing");
  });
});

describe("spectrogramSeed is strict", () => {
  const ok = { channel: 1, segment_len: 16, window: "hann", overlap: 0.35, scaling: "psd", detrend: "mean", resample: false };
  it("reads a complete record and turns the overlap back into the form's percent", () => {
    expect(spectrogramSeed(ok)).toMatchObject({ channel: 1, segmentLen: 16, overlapPct: 35, range: null });
    expect(spectrogramSeed({ ...ok, x_min: 1, x_max: 2 })).toMatchObject({ range: { xMin: 1, xMax: 2 } });
  });
  it.each([
    [{ ...ok, window: "kaiser" }], [{ ...ok, overlap: 1 }], [{ ...ok, channel: -1 }], [{ ...ok, resample: "no" }],
    [{ ...ok, x_min: 1 }], [{ ...ok, x_min: 1, x_max: "2" }], [{ ...ok, segment_len: 16.5 }],
  ])("rejects %j", (record) => {
    expect(spectrogramSeed(record)).toBeNull();
  });
});
