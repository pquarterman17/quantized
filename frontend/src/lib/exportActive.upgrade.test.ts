// Payload-seam audit findings 1 and 4: exportActive ships a large baseline and
// a large fit at full resolution, drops a baseline it could not upgrade (with
// the "overlay dropped" notice), and stops when a slot changed mid-fetch.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { postJSON } from "./api/http";
import { displayColumn } from "./api/resultArrays";
import { exportActive } from "./exportActive";
import { placeAnalysisOverlays, type OverlaySources, type OverlayView } from "./figureSpecOverlays";
import type { FigureSpec } from "./api/figures";
import type { BaselineOverlay, Dataset, FitOverlay } from "./types";
import { rememberBaselineFull } from "../store/fitOverlayUpgrade";
import { useApp } from "../store/useApp";
import { SINGLE_X } from "../test/overlayBinding";

vi.mock("./api/http", async (orig) => ({ ...(await orig<typeof import("./api/http")>()), postJSON: vi.fn() }));

const N = 40_000;
const time = Array.from({ length: N }, (_, i) => i);
const DS: Dataset = {
  id: "d1",
  name: "big.csv",
  data: { time, values: time.map((t) => [Math.sin(t / 500) + 2]), labels: ["I"], units: [""], metadata: {} },
};
const VIEW: OverlayView & OverlaySources = {
  fitOverlay: null, baselineOverlay: null, peakOverlay: null, plotTemplate: "screen", defaultLineWidth: 1.5,
  xKey: null, yKeys: null, seriesOrder: null, hiddenChannels: [], seriesStyles: {}, waterfall: 0,
  facetKey: null, stackMode: false, polarMode: false, statMode: false, groupKey: null,
};
const spec = (): FigureSpec => ({ dataset: DS.data, y_keys: [0], series_styles: [{ color: "#111111", width: 1.5 }], fmt: "svg" });

/** What callBaselinePreview stores for a >20k-row SNIP: ~2 rows per bucket. */
function leanOverlay(): BaselineOverlay {
  const rows: number[] = [];
  for (let b = 0; b < 4096; b++) rows.push(Math.floor((b * N) / 4096));
  const y = displayColumn({ rows, y: rows.map(() => 1) }, N);
  return { datasetId: "d1", binding: SINGLE_X, y, lean: true };
}
const FULL = time.map(() => 1);
const real = (o: BaselineOverlay | null): number => (o?.y ?? []).filter((v) => v != null).length;

beforeEach(() => {
  vi.mocked(postJSON).mockReset();
  useApp.setState({
    datasets: [DS], activeId: "d1", fitOverlay: null, baselineOverlay: null, status: "",
    resolveDataset: (id: string) => Promise.resolve(id === "d1" ? DS : undefined),
  } as never);
});

describe("exportActive: a lean baseline preview (finding 1)", () => {
  it("hands the export the FULL baseline, not the display column", async () => {
    const lean = leanOverlay();
    rememberBaselineFull(lean, () => Promise.resolve(FULL));
    useApp.setState({ baselineOverlay: lean });
    let seen: BaselineOverlay | null = null;
    await exportActive(useApp.getState, () => {
      seen = useApp.getState().baselineOverlay;
      return Promise.resolve();
    });
    expect(real(seen)).toBe(N);
    expect(seen).not.toHaveProperty("lean");
  });

  it("drops a lean baseline it cannot fetch, and names it as dropped", async () => {
    const lean = leanOverlay(); // nothing remembered: no id, no rerun
    useApp.setState({ baselineOverlay: lean });
    let placed: ReturnType<typeof placeAnalysisOverlays> | null = null;
    await exportActive(useApp.getState, () => {
      const s = useApp.getState();
      const view = { ...VIEW, baselineOverlay: s.baselineOverlay };
      placed = placeAnalysisOverlays(spec(), DS, view, view);
      return Promise.resolve();
    });
    expect(placed!.dropped).toEqual(["baseline"]);
    expect(placed!.spec.dataset.labels).not.toContain("baseline");
  });

  it("drops a lean baseline whose fetch fails", async () => {
    const lean = leanOverlay();
    rememberBaselineFull(lean, () => Promise.reject(new Error("offline")));
    useApp.setState({ baselineOverlay: lean });
    const view = { ...VIEW, baselineOverlay: lean };
    await exportActive(useApp.getState, () => Promise.resolve());
    expect(placeAnalysisOverlays(spec(), DS, view, view).dropped).toEqual(["baseline"]);
  });
});

describe("exportActive: a slot that changes mid-fetch (finding 4)", () => {
  const FIT = (id: string): FitOverlay => ({
    datasetId: "d1", binding: SINGLE_X, curveFit: true, y: [1, undefined, 5] as unknown as (number | null)[],
    full: { resultId: id, model: "Linear", params: [2, 1], rows: [0, 1, 2], x: [0, 1, 2] },
  });

  it("stops with a clear message instead of exporting the new display fit", async () => {
    let release: (v: unknown) => void = () => {};
    let started = false;
    vi.mocked(postJSON).mockImplementation(() => { started = true; return new Promise((r) => { release = r; }); });
    useApp.setState({ fitOverlay: FIT("a") });
    const fn = vi.fn(() => Promise.resolve());
    const done = exportActive(useApp.getState, fn);
    await vi.waitFor(() => expect(started).toBe(true));
    useApp.setState({ fitOverlay: FIT("b") }); // the user re-ran Fit
    release({ yFit: [1, 3, 5] });
    await done;
    expect(fn).not.toHaveBeenCalled();
    expect(useApp.getState().status).toMatch(/fit changed while exporting — try again/);
  });

  it("stops when the baseline preview was replaced by another lean one", async () => {
    const first = leanOverlay();
    let release: (v: (number | null)[]) => void = () => {};
    let started = false;
    rememberBaselineFull(first, () => { started = true; return new Promise((r) => { release = r; }); });
    useApp.setState({ baselineOverlay: first });
    const fn = vi.fn(() => Promise.resolve());
    const done = exportActive(useApp.getState, fn);
    await vi.waitFor(() => expect(started).toBe(true));
    useApp.setState({ baselineOverlay: leanOverlay() });
    release(FULL);
    await done;
    expect(fn).not.toHaveBeenCalled();
    expect(useApp.getState().status).toMatch(/baseline changed while exporting — try again/);
  });
});
