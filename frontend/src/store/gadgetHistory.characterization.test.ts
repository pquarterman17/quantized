// Characterization tests for the ROI-gadget/quick-fit family's undo-history
// and status/toast contracts, written BEFORE extracting these actions out of
// useApp.ts (PRIMARY_SOFTWARE_AUDIT_PLAN "characterization tests before
// moves"). store/gadget.test.ts and store/quickfit.test.ts already pin the
// compute/debounce/overlay behavior exhaustively; what neither pins is the
// undo-history contract — these actions are TRANSIENT TOOL STATE (see
// history.ts's module doc: "Preferences and transient tool/selection state
// remain excluded") and must never push their own `recordHistory` entry,
// unlike a data-mutating action such as `setPlotTitle`. `commitGadgetFft` is
// the one exception worth pinning precisely: it never calls `recordHistory`
// itself, but it DOES call `addDataset`, which does — so committing an FFT
// preview to the library records exactly ONE undo entry, attributable to
// `addDataset`, not to the gadget action.
//
// Each test here must keep passing, unmodified, after the actions move to
// store/gadget.ts — they exercise ONLY the public `useApp`/`useToasts`
// surface, never the module the actions live in.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, DataStruct } from "../lib/types";
import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import { useApp } from "./useApp";
import { useToasts } from "./toasts";

const data = (): DataStruct => ({
  time: [0, 1, 2, 3, 4, 5],
  values: [[0], [2], [4], [6], [8], [10]],
  labels: ["I"],
  units: [""],
  metadata: {},
});

const ds = (id: string, over: Partial<Dataset> = {}): Dataset => ({
  id,
  name: id,
  data: data(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  useApp.setState({
    datasets: [ds("a")],
    activeId: "a",
    yKeys: null,
    xKey: null,
    hiddenChannels: [],
    seriesOrder: null,
    macroRecording: false,
    macroSteps: [],
    history: [],
    future: [],
    status: "starting…",
    qfitRoi: null,
    qfitModel: "Linear",
    qfitBusy: false,
    qfitResult: null,
    qfitError: null,
    fitOverlay: null,
    gadgetMode: "fit",
    gadgetBusy: false,
    gadgetError: null,
    gadgetIntegrateResult: null,
    gadgetStatsResult: null,
    gadgetDerivResult: null,
    derivOverlay: null,
    gadgetFftPreview: null,
    gadgetCursors: null,
    gadgetCursorResult: null,
  });
  useToasts.setState({ toasts: [] });
});

describe("ROI-gadget / quick-fit undo-history contract", () => {
  it("setQfitRoi, setGadgetMode, setGadgetCursors, and clearQfit never push an undo entry", () => {
    vi.useFakeTimers(); // never advanced — any scheduled debounced fetch stays pending, then is discarded
    expect(useApp.getState().history).toHaveLength(0);

    useApp.getState().setQfitRoi([1, 3]);
    useApp.getState().setQfitRoi(null);
    useApp.getState().setGadgetMode("integrate");
    useApp.getState().setGadgetMode("cursors"); // clears the armed ROI internally
    useApp.getState().setGadgetCursors([1, 3]);
    useApp.getState().setGadgetCursors(null);
    useApp.getState().clearQfit();

    expect(useApp.getState().history).toHaveLength(0);

    // Sabotage-immunity self-check: prove `history` actually grows when a
    // known undo-recording action runs, so the zero-growth assertions above
    // are not vacuously true (e.g. because `history` was never wired up).
    useApp.getState().setPlotTitle("probe");
    expect(useApp.getState().history).toHaveLength(1);
    vi.useRealTimers();
  });

  it("commitQfit records a macro step but not an undo entry", async () => {
    vi.useFakeTimers();
    // Manufacture a committable qfit result without hitting the network —
    // commitQfit only reads qfitResult/qfitModel, never (re)computes them.
    useApp.setState({ qfitRoi: [1, 3], qfitResult: { params: [2, 0], R2: 1 } });

    useApp.getState().commitQfit();

    expect(useApp.getState().datasets[0].fitSpec).toBeDefined();
    expect(useApp.getState().history).toHaveLength(0);
    vi.useRealTimers();
  });

  it("commitGadgetFft with no live preview is a total no-op (no history, no status change, no toast)", () => {
    const before = useApp.getState().status;
    useApp.getState().commitGadgetFft();
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().status).toBe(before);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  // Lane RL2 (deliberate change, with its own tests in gadget.test.ts): the
  // commit goes through the shared contract, so its one undo entry now carries
  // the contract's label and a Library result lands with it. The preview must
  // carry the source stamp the compute puts on it.
  it("commitGadgetFft records exactly ONE undo entry (the shared commit's) plus status + an ok toast", async () => {
    const source = { id: "a", computedOn: analysisDataFingerprint(useApp.getState().datasets[0]), roi: [0, 5] as [number, number], xKey: null, yKey: null };
    useApp.setState({
      gadgetFftPreview: { freq: [0, 1, 2], magnitude: [0, 5, 1], df: 1, nfft: 4, fs: 4, windowName: "hanning", source },
    });
    expect(useApp.getState().history).toHaveLength(0);

    useApp.getState().commitGadgetFft();
    await vi.dynamicImportSettled();

    const s = useApp.getState();
    expect(s.datasets).toHaveLength(2); // addDataset ran
    expect(s.history).toHaveLength(1); // exactly one entry, not zero and not two
    expect(s.history.at(-1)?.label).toBe("add Gadget FFT output");
    expect(s.analysisResults).toHaveLength(1);
    expect(s.status).toBe("FFT spectrum added to library");
    expect(useToasts.getState().toasts.at(-1)).toEqual(
      expect.objectContaining({ msg: "FFT spectrum added to library", kind: "ok" }),
    );
  });
});
