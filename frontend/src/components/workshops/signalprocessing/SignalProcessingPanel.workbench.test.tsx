// Lane WB characterization: the Signal Processing preview contract that the
// shared workbench shell (components/workshops/workbench) was extracted from.
// Written against the pre-shell panel; it must keep passing after migration.
// Races are FORCED (deferred promises + fake timers), never waited out.
import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, DataStruct } from "../../../lib/types";
import { useSignalOperationSeed } from "../../../store/signalOperationSeed";
import { useApp } from "../../../store/useApp";
import SignalProcessingPanel from "./SignalProcessingPanel";

const { correctionMock, createSignalMock } = vi.hoisted(() => ({ correctionMock: vi.fn(), createSignalMock: vi.fn() }));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  applyCorrections: correctionMock,
}));
vi.mock("../../../lib/api/spectralWorkbench", () => ({ runSpectralWorkbench: vi.fn() }));
vi.mock("../../../store/signalWorksheetCommand", () => ({ createSignalWorksheetFromApp: createSignalMock }));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
}));

const data: DataStruct = {
  time: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  values: Array.from({ length: 12 }, (_, i) => [i, i * i]),
  labels: ["primary", "secondary"],
  units: ["V", "A"],
  metadata: { xUnit: "s" },
};
const dataset: Dataset = { id: "signal-source", name: "scan", data };

interface Call { signal: AbortSignal; resolve: (d: DataStruct) => void; reject: (e: unknown) => void }
let calls: Call[];
const labelled = (label: string): DataStruct => ({ ...structuredClone(data), labels: ["primary", label] });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  calls = [];
  correctionMock.mockImplementation((_body: unknown, signal: AbortSignal) =>
    new Promise<DataStruct>((resolve, reject) => { calls.push({ signal, resolve, reject }); }));
  useSignalOperationSeed.setState({ op: null, nonce: 0 });
  useApp.setState({ datasets: [dataset], activeId: dataset.id, yKeys: [1], signalProcessingOpen: true, history: [], future: [] });
});
afterEach(() => vi.useRealTimers());

const flush = () => act(async () => { await Promise.resolve(); });
const create = () => screen.getByRole("button", { name: "Create new worksheet" });
const setHalfWindow = (v: string) => fireEvent.change(screen.getByLabelText("Half-window"), { target: { value: v } });

describe("Signal Processing preview contract (characterization, lane WB)", () => {
  it("debounces: no request before 180 ms, exactly one after", () => {
    render(<SignalProcessingPanel />);
    act(() => { vi.advanceTimersByTime(179); });
    expect(calls).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(1); });
    expect(calls).toHaveLength(1);
  });

  it("an edit inside the debounce window restarts it (one request for the final settings)", () => {
    render(<SignalProcessingPanel />);
    act(() => { vi.advanceTimersByTime(100); });
    setHalfWindow("3");
    act(() => { vi.advanceTimersByTime(100); });
    expect(calls).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(80); });
    expect(calls).toHaveLength(1);
  });

  it("forces the stale-response race: an older response arriving last is never shown", async () => {
    render(<SignalProcessingPanel />);
    act(() => { vi.advanceTimersByTime(180); });
    setHalfWindow("3");
    act(() => { vi.advanceTimersByTime(180); });
    expect(calls).toHaveLength(2);
    expect(calls[0].signal.aborted).toBe(true); // the input change aborted the first request
    calls[1].resolve(labelled("NEW"));
    await flush();
    calls[0].resolve(labelled("OLD")); // the stale response lands AFTER the current one
    await flush();
    expect(screen.getByText("Preview: NEW")).toBeInTheDocument();
    expect(screen.queryByText("Preview: OLD")).not.toBeInTheDocument();
    expect(create()).toBeEnabled();
  });

  it("an edit while a request is in flight hides the old preview and disables Create", async () => {
    render(<SignalProcessingPanel />);
    act(() => { vi.advanceTimersByTime(180); });
    calls[0].resolve(labelled("FIRST"));
    await flush();
    expect(create()).toBeEnabled();
    setHalfWindow("3");
    expect(screen.queryByText("Preview: FIRST")).not.toBeInTheDocument();
    expect(create()).toBeDisabled();
  });

  it("aborts the in-flight preview on unmount", () => {
    const { unmount } = render(<SignalProcessingPanel />);
    act(() => { vi.advanceTimersByTime(180); });
    unmount();
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("shows a failed preview's message as an alert and keeps Create disabled", async () => {
    render(<SignalProcessingPanel />);
    act(() => { vi.advanceTimersByTime(180); });
    calls[0].reject(new Error("backend refused the window"));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("backend refused the window");
    expect(create()).toBeDisabled();
  });

  it("an aborted request's AbortError is not shown as an error", async () => {
    render(<SignalProcessingPanel />);
    act(() => { vi.advanceTimersByTime(180); });
    setHalfWindow("3");
    calls[0].reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await flush();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Cancel after a preview leaves no scientific state (no dataset, no history, no commit)", async () => {
    render(<SignalProcessingPanel />);
    act(() => { vi.advanceTimersByTime(180); });
    calls[0].resolve(labelled("FIRST"));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const s = useApp.getState();
    expect(s.signalProcessingOpen).toBe(false);
    expect(s.datasets).toEqual([dataset]);
    expect(s.history).toEqual([]);
    expect(createSignalMock).not.toHaveBeenCalled();
  });
});
