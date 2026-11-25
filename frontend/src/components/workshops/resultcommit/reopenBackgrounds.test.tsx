// "Open in Magnetometry (Background)" and "Open in Hysteresis" (OPEN_ITEMS row 12,
// reopen-seven lane): both background subtractions record the channels they ran
// on beside their settings (producer version 2), reopen on the recorded source
// with the recorded routine / channels, and REPLACE their output in one undo
// step. FAIL CLOSED: a version-1 result refuses; a moved channel, an incomplete
// record and a deleted source open without settings and with Replace off.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hysteresisAnalysis, subtractHysteresisBackground, subtractMagBackground } from "../../../lib/api/magnetometry";
import type { AnalysisResult } from "../../../lib/analysisResult";
import type { Dataset } from "../../../lib/types";
import { seedAnalysisSelection, useAnalysisSelection } from "../../../store/analysisSelection";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import { useHysteresis } from "../hysteresis/useHysteresis";
import { useMagTools } from "../magtools/useMagTools";

vi.mock("../../../lib/api/magnetometry", () => ({
  subtractMagBackground: vi.fn(), subtractHysteresisBackground: vi.fn(), hysteresisAnalysis: vi.fn(),
}));

const N = 24;
const ramp = Array.from({ length: N }, (_, i) => i - N / 2);
const source = (labels = ["M1", "M2"], x = { name: "Magnetic Field", unit: "Oe" }): Dataset => ({
  id: "src", name: "loop.dat",
  data: {
    time: ramp, values: ramp.map((v) => [v / 2, v / 3]), labels, units: ["emu", "emu"],
    metadata: { x_column_name: x.name, x_column_unit: x.unit },
  },
});

const realResolveDataset = useApp.getState().resolveDataset;
const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "src");
const results = () => useApp.getState().analysisResults;
const resultId = () => results()[0]!.id;
const session = (tool: string) => useToolReopen.getState().sessions[tool]!;
const reopen = (): boolean => { let ok = false; act(() => { ok = openCommittedResultInTool(resultId()); }); return ok; };

function load(ds: Dataset): void {
  useToolReopen.setState({ sessions: {} });
  useAnalysisSelection.getState().clear();
  useApp.setState({
    datasets: [ds], activeId: "src", xKey: null, yKeys: [1], seriesOrder: null, status: "", analysisResults: [],
    history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual", magToolsOpen: false, hysteresisOpen: false,
    resolveDataset: realResolveDataset,
  });
}

/** The contract both tools meet once one result is committed. */
function contract(tool: string, label: string, open: "magToolsOpen" | "hysteresisOpen") {
  it("records producer version 2, the settings and the channels it ran on", () => {
    const result = results()[0]!;
    expect(result.producer.version).toBe(2);
    expect(result.parameters!["settings"]).toMatchObject({ xKey: null, yKey: 1 });
    const record = result.parameters!["reopen"] as { extra: { channels: { yLabel: string; yIndex: number; xIndex: number | null } } };
    expect(record.extra.channels).toMatchObject({ yLabel: "M2", yIndex: 1, xIndex: null });
  });

  it("a result saved before the channels were recorded refuses with the existing reason", () => {
    useApp.setState((s) => ({ analysisResults: s.analysisResults.map((r) => ({ ...r, producer: { ...r.producer, version: 1 } })) }));
    expect(reopen()).toBe(false);
    expect(useApp.getState().status).toContain(`Open in ${label}`);
    expect(useApp.getState().status).toContain("saved before its settings were recorded, so it cannot be reopened");
    expect(useToolReopen.getState().sessions[tool]).toBeUndefined();
    expect(useApp.getState()[open]).toBe(false);
  });

  it("a deleted source opens the tool with no settings, a notice and no Replace", () => {
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "src") }));
    expect(reopen()).toBe(true);
    expect(session(tool).seed).toBeNull();
    expect(session(tool).notice).toContain("no longer exists");
    expect(session(tool).mode).toBe("new");
  });

  it("a moved channel is NOT guessed: no settings, no replot, the reason names it, Replace off", () => {
    useApp.setState((s) => ({
      yKeys: [0],
      datasets: s.datasets.map((d) => ({ ...d, data: { ...d.data, labels: ["M2", "M1"] } })),
    }));
    expect(reopen()).toBe(true);
    expect(session(tool).seed).toBeNull();
    expect(session(tool).replaceBlocked).toContain("“M2” is no longer at its place");
    expect(session(tool).mode).toBe("new");
    expect(useApp.getState().yKeys).not.toEqual([1]);
    expect(useApp.getState().history.at(-1)?.label ?? "").not.toContain("plot the recorded");
  });

  it("an incomplete record is NOT guessed: no settings, Replace off", () => {
    useApp.setState((s) => ({
      analysisResults: s.analysisResults.map((r) => {
        const settings = { ...(r.parameters!["settings"] as Record<string, unknown>) };
        delete settings["yKey"];
        return { ...r, parameters: { ...r.parameters, settings } as AnalysisResult["parameters"] };
      }),
    }));
    expect(reopen()).toBe(true);
    expect(session(tool).seed).toBeNull();
    expect(session(tool).replaceBlocked).toContain("incomplete");
    expect(session(tool).mode).toBe("new");
  });

  it("settings that disagree with the recorded channels are NOT guessed", () => {
    useApp.setState((s) => ({
      analysisResults: s.analysisResults.map((r) => ({ ...r, parameters: { ...r.parameters, settings: { ...(r.parameters!["settings"] as object), yKey: 0 } } })),
    }));
    expect(reopen()).toBe(true);
    expect(session(tool).seed).toBeNull();
    expect(session(tool).mode).toBe("new");
  });
}

describe("Magnetometry Background: reopen, adjust, replace", () => {
  async function runBackground(fraction: number, kind: "mh" | "mt") {
    const hook = renderHook(() => useMagTools());
    act(() => hook.result.current.setBgMode(kind));
    act(() => (kind === "mh" ? hook.result.current.setHiFraction(fraction) : hook.result.current.setAutoFraction(fraction)));
    await act(async () => { await hook.result.current.subtractBackground(); });
    hook.unmount();
  }
  const x = (kind: "mh" | "mt") => (kind === "mh" ? { name: "Magnetic Field", unit: "Oe" } : { name: "Temperature", unit: "K" });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(subtractHysteresisBackground).mockImplementation(async (b) => ({ corrected: b.m.map((v) => v - 1), slope: 0.1, offset: 0.2 }));
    vi.mocked(subtractMagBackground).mockImplementation(async (b) => ({ corrected: b.moment.map((v) => v - 1), slope: 0.1, intercept: 0.2 }));
  });

  describe("an M(H) loop at a non-default high-field fraction", () => {
    beforeEach(async () => {
      load(source());
      await runBackground(0.5, "mh");
      expect(outputs()).toHaveLength(1);
    });
    contract("mag-background", "Magnetometry (Background)", "magToolsOpen");

    it("reopens with the recorded routine and fraction (the other path keeps its default), Replace preselected", () => {
      const plain = renderHook(() => useMagTools());
      expect(plain.result.current.bgMode).toBe("auto");
      expect(plain.result.current.hiFraction).toBe(0.7);
      plain.unmount();
      expect(reopen()).toBe(true);
      expect(useApp.getState().magToolsOpen).toBe(true);
      const { result } = renderHook(() => useMagTools());
      expect(result.current.bgMode).toBe("mh");
      expect(result.current.hiFraction).toBe(0.5);
      expect(result.current.autoFraction).toBe(0.1);
      expect(result.current.tab).toBe("background");
      expect(session("mag-background").mode).toBe("replace");
    });

    it("Replace commits into the old output: one result, the same output id, one undo step", async () => {
      const outputId = outputs()[0]!.id;
      expect(reopen()).toBe(true);
      const before = useApp.getState().history.length;
      const { result } = renderHook(() => useMagTools());
      act(() => result.current.setHiFraction(0.6));
      await act(async () => { await result.current.subtractBackground(); });
      expect(results()).toHaveLength(1);
      expect(outputs().map((d) => d.id)).toEqual([outputId]);
      expect(results()[0]!.parameters!["settings"]).toMatchObject({ path: "mh", fraction: 0.6 });
      expect(useApp.getState().history.length - before).toBe(1);
    });
  });

  describe("an M(T) curve at a non-default high-T fraction", () => {
    beforeEach(async () => {
      load(source(["M1", "M2"], x("mt")));
      await runBackground(0.3, "mt");
      expect(outputs()).toHaveLength(1);
    });

    it("reopens on the M(T) routine with the recorded fraction", () => {
      expect(reopen()).toBe(true);
      const { result } = renderHook(() => useMagTools());
      expect(result.current.bgMode).toBe("mt");
      expect(result.current.autoFraction).toBe(0.3);
      expect(result.current.hiFraction).toBe(0.7);
    });

    it("an unreadable fraction is NOT guessed: the tool opens at its defaults and Replace is off", () => {
      useApp.setState((s) => ({
        analysisResults: s.analysisResults.map((r) => ({ ...r, parameters: { ...r.parameters, settings: { ...(r.parameters!["settings"] as object), fraction: 7 } } })),
      }));
      expect(reopen()).toBe(true);
      const { result } = renderHook(() => useMagTools());
      expect(result.current.bgMode).toBe("auto");
      expect(result.current.autoFraction).toBe(0.1);
      expect(session("mag-background").mode).toBe("new");
    });
  });

  it("reopening plots the recorded channel again, as one undoable view change", async () => {
    load(source());
    await runBackground(0.5, "mh");
    useApp.setState({ yKeys: [0] });
    expect(reopen()).toBe(true);
    expect(useApp.getState().yKeys).toEqual([1]);
    expect(useApp.getState().history.at(-1)?.label).toContain("plot the recorded");
  });
});

describe("Hysteresis background: reopen and replace", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(hysteresisAnalysis).mockResolvedValue({ Hc: 0.1, Mr: 0.2, Ms: 1 });
    vi.mocked(subtractHysteresisBackground).mockImplementation(async (b) => ({ corrected: b.m.map((v) => v - 1), slope: 0.1, offset: 0.2 }));
    load(source());
    const hook = renderHook(() => useHysteresis());
    await waitFor(() => expect(hook.result.current.result).not.toBeNull());
    await act(async () => { await hook.result.current.subtractBackground(); });
    hook.unmount();
    expect(outputs()).toHaveLength(1);
  });
  contract("hysteresis-background", "Hysteresis", "hysteresisOpen");

  it("reopens the Hysteresis tool on the source with the recorded channel plotted, Replace preselected", () => {
    useApp.setState({ yKeys: [0] });
    expect(reopen()).toBe(true);
    expect(useApp.getState().hysteresisOpen).toBe(true);
    expect(useApp.getState().activeId).toBe("src");
    expect(useApp.getState().yKeys).toEqual([1]);
    expect(session("hysteresis-background").mode).toBe("replace");
  });

  it("a frozen reviewed selection is dropped so the tool opens on the recorded source", () => {
    seedAnalysisSelection("hysteresis", "library");
    expect(useAnalysisSelection.getState().toolId).toBe("hysteresis");
    expect(reopen()).toBe(true);
    expect(useAnalysisSelection.getState().toolId).toBeNull();
  });

  it("Replace commits into the old output: one result, the same output id", async () => {
    const outputId = outputs()[0]!.id;
    const before = outputs()[0]!.data.values[0]![0];
    vi.mocked(subtractHysteresisBackground).mockImplementation(async (b) => ({ corrected: b.m.map((v) => v - 5), slope: 0.1, offset: 0.2 }));
    expect(reopen()).toBe(true);
    const hook = renderHook(() => useHysteresis());
    await waitFor(() => expect(hook.result.current.result).not.toBeNull());
    await act(async () => { await hook.result.current.subtractBackground(); });
    expect(results()).toHaveLength(1);
    expect(outputs().map((d) => d.id)).toEqual([outputId]);
    // A commit that did nothing could not pass for a replace: the same output now holds the new numbers.
    expect(outputs()[0]!.data.values[0]![0]).toBe(before - 4);
  });
});
