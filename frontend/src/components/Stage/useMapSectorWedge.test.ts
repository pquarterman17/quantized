// Mocked-hook tests for useMapSectorWedge.ts (RSM_CUTS_PLAN item 12), same
// style as useMapRoi.test.ts/useMapRuler.test.ts: mock the backend
// wrappers, drive the hook's own onDown/onMove/onUp directly (px inputs
// derived from the SAME dataToPx the hook uses via pxToData).
//
// The sector's authoritative fields live in `store.mapSector` (MAIN_PLAN
// item 41 — see useMapSectorWedge.ts's header), re-primed to a dataset-
// derived DEFAULT (full circle, q-range from the data) by useRoiCuts.ts's
// per-active-dataset effect, which this hook still mounts internally. Each
// test "primes" the sector with one unambiguous drag (moving phiMin away
// from the coincident phiMin===phiMax point at the full circle's seam)
// before exercising the handle under test — this is exactly the kind of
// interactive shaping a real user does with the mouse, not a test-only
// shortcut. The underlying PURE geometry (classifySectorHit/applySectorDrag
// precedence, wrap survival) already has its own exhaustive unit tests in
// lib/roiSector.test.ts; this file's job is the hook's integration
// behaviour: isolated field changes through the real gesture machine, Esc
// revert, preview/commit separation, the angular-axes disable, and (below)
// that a drag here is visible to a separately-mounted `useRoiCuts()`.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rsmBoxCut, rsmBoxStats, rsmChiProfile, rsmSector } from "../../lib/api/rsm";
import { cancelActiveGesture } from "../../lib/gestureCancel";
import type { MapPayload } from "../../lib/mapdata";
import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { useRoiCuts } from "../workshops/roicuts/useRoiCuts";
import { dataToPx } from "./mapRender";
import { useMapSectorWedge } from "./useMapSectorWedge";

vi.mock("../../lib/api/rsm", () => ({
  rsmBoxCut: vi.fn(),
  rsmBoxStats: vi.fn(),
  rsmSector: vi.fn(),
  rsmChiProfile: vi.fn(),
}));

const W = 400;
const H = 400;

// Q-space payload: equal, non-angular units on both axes -> plotRect LOCKS
// equal aspect (lib/mapAspect.ts, item 17), the precondition the wedge's
// polar hit-test relies on (useMapSectorWedge.ts's own header).
const PAYLOAD: MapPayload = {
  xAxis: Array.from({ length: 11 }, (_, i) => i - 5),
  yAxis: Array.from({ length: 11 }, (_, i) => i - 5),
  zGrid: Array.from({ length: 11 }, () => Array.from({ length: 11 }, () => 1)),
  xLabel: "Qx",
  xUnit: "Ang^-1",
  yLabel: "Qz",
  yUnit: "Ang^-1",
  zLabel: "Intensity",
  zUnit: "cps",
  zMin: 0,
  zMax: 1,
};

// |Q| spans exactly [2, 4] -> useRoiCuts primes secMin=2/secMax=4 as the
// sector card's default q-range (Resolved decisions: "q-range from data").
const DS: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [60, 30, 100, 2, 0],
    [61, 30, 200, 0, 3],
    [60, 31, 150, 3, 0],
    [61, 31, 300, 0, 4],
  ],
  labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"],
  units: ["deg", "deg", "cps", "Ang^-1", "Ang^-1"],
  metadata: { is2D: true, map_shape: [2, 2], axis1_name: "Omega" },
};

const ACTIVE = { id: "d1", name: "d1.xrdml", data: DS };

function setActive(): void {
  useApp.setState({ datasets: [ACTIVE], activeId: ACTIVE.id });
}

/** Data -> px via the SAME projector the hook uses, so a chosen data point
 *  round-trips exactly through the hook's own pxToData. */
function px(x: number, y: number): [number, number] {
  const p = dataToPx(PAYLOAD, W, H, x, y);
  if (!p) throw new Error(`(${x}, ${y}) projects outside the plot rect`);
  return p;
}

/** A point at radius r, azimuth phiDeg (data coords) — the same convention
 *  applySectorDrag/classifySectorHit use. */
function polar(r: number, phiDeg: number): [number, number] {
  const rad = (phiDeg * Math.PI) / 180;
  return [r * Math.cos(rad), r * Math.sin(rad)];
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// jsdom's requestAnimationFrame never fires on its own — capture (don't
// auto-fire), same convention as useMapRoi.test.ts.
let rafCb: FrameRequestCallback | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ mapRoi: null, mapRuler: null, savedRois: [], selectedIds: [] });
  // `mapSector` is shared store state now (MAIN_PLAN item 41) — clear its
  // `primedFor` marker so useRoiCuts.ts's per-active-dataset effect re-primes
  // fresh for every test instead of skipping (already primed for "d1" by a
  // PRIOR test) and leaking that test's dragged values into this one.
  useApp.getState().setMapSector({ primedFor: null });
  setActive();
  rafCb = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCb = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    rafCb = null;
  });
});

/** Arm the tool and drag the phiMin handle from the full-circle default's
 *  coincident seam (phiMin=0, phiMax=360, both physically at angle 0) out to
 *  90deg — the one drag that is UNAMBIGUOUS straight from the dataset-primed
 *  default (see this file's header). Leaves phiMax untouched at 360, so
 *  every subsequent handle in the same test is then individually reachable
 *  without ties. */
function primeToQuarter(result: { current: ReturnType<typeof useMapSectorWedge> }): void {
  act(() => result.current.setMode("sector"));
  act(() => result.current.onDown(PAYLOAD, W, H, px(...polar(3, 0))));
  act(() => result.current.onMove(PAYLOAD, W, H, px(...polar(3, 90))));
  act(() => result.current.onUp(px(...polar(3, 90))));
}

describe("useMapSectorWedge — priming + each handle changes only its own field", () => {
  it("priming drag moves phiMin only", () => {
    const { result } = renderHook(() => useMapSectorWedge(ACTIVE, "q"));
    expect(result.current.sector).toEqual({ qMin: 2, qMax: 4, phiMin: 0, phiMax: 360 });
    primeToQuarter(result);
    const s = result.current.sector!;
    expect(s.phiMin).toBeCloseTo(90);
    expect(s.phiMax).toBe(360);
    expect(s.qMin).toBe(2);
    expect(s.qMax).toBe(4);
  });

  it("phiMax handle changes only phiMax", () => {
    const { result } = renderHook(() => useMapSectorWedge(ACTIVE, "q"));
    primeToQuarter(result);
    const before = result.current.sector!;

    act(() => result.current.onDown(PAYLOAD, W, H, px(...polar(3, 0)))); // phiMax's edge (phiMin moved to 90)
    act(() => result.current.onMove(PAYLOAD, W, H, px(...polar(3, -30))));
    act(() => result.current.onUp(px(...polar(3, -30))));

    const after = result.current.sector!;
    expect(after.phiMax).toBeCloseTo(-30);
    expect(after.phiMin).toBeCloseTo(before.phiMin);
    expect(after.qMin).toBe(before.qMin);
    expect(after.qMax).toBe(before.qMax);
  });

  it("qMin handle changes only qMin", () => {
    const { result } = renderHook(() => useMapSectorWedge(ACTIVE, "q"));
    primeToQuarter(result); // phiMin=90, phiMax=360 -> span 270, mid-angle 225
    const before = result.current.sector!;

    act(() => result.current.onDown(PAYLOAD, W, H, px(...polar(2, 225))));
    act(() => result.current.onMove(PAYLOAD, W, H, px(...polar(2.5, 225))));
    act(() => result.current.onUp(px(...polar(2.5, 225))));

    const after = result.current.sector!;
    expect(after.qMin).toBeCloseTo(2.5);
    expect(after.qMax).toBe(before.qMax);
    expect(after.phiMin).toBeCloseTo(before.phiMin);
    expect(after.phiMax).toBe(before.phiMax);
  });

  it("qMax handle changes only qMax", () => {
    const { result } = renderHook(() => useMapSectorWedge(ACTIVE, "q"));
    primeToQuarter(result);
    const before = result.current.sector!;

    act(() => result.current.onDown(PAYLOAD, W, H, px(...polar(4, 225))));
    act(() => result.current.onMove(PAYLOAD, W, H, px(...polar(4.5, 225))));
    act(() => result.current.onUp(px(...polar(4.5, 225))));

    const after = result.current.sector!;
    expect(after.qMax).toBeCloseTo(4.5);
    expect(after.qMin).toBe(before.qMin);
    expect(after.phiMin).toBeCloseTo(before.phiMin);
    expect(after.phiMax).toBe(before.phiMax);
  });
});

describe("useMapSectorWedge — interior rotate preserves span", () => {
  it("rotates both bounds by the same delta", () => {
    const { result } = renderHook(() => useMapSectorWedge(ACTIVE, "q"));
    primeToQuarter(result); // phiMin=90, phiMax=360 -> span 270
    const before = result.current.sector!;
    const spanBefore = ((before.phiMax - before.phiMin) % 360 + 360) % 360 || 360;

    act(() => result.current.onDown(PAYLOAD, W, H, px(...polar(3, 225)))); // interior
    act(() => result.current.onMove(PAYLOAD, W, H, px(...polar(3, 245)))); // +20deg
    act(() => result.current.onUp(px(...polar(3, 245))));

    const after = result.current.sector!;
    expect(after.phiMin).toBeCloseTo(before.phiMin + 20);
    expect(after.phiMax).toBeCloseTo(before.phiMax + 20);
    const spanAfter = ((after.phiMax - after.phiMin) % 360 + 360) % 360 || 360;
    expect(spanAfter).toBeCloseTo(spanBefore);
  });

  it("a seam-crossing sector stays seam-crossing after a rotate", () => {
    const { result } = renderHook(() => useMapSectorWedge(ACTIVE, "q"));
    act(() => result.current.setMode("sector"));
    // Prime phiMin -> 170 (from the default full-circle seam at angle 0).
    act(() => result.current.onDown(PAYLOAD, W, H, px(...polar(3, 0))));
    act(() => result.current.onMove(PAYLOAD, W, H, px(...polar(3, 170))));
    act(() => result.current.onUp(px(...polar(3, 170))));
    // Drag phiMax (still at its original seam, angle 0/360) past the seam to -170.
    act(() => result.current.onDown(PAYLOAD, W, H, px(...polar(3, 0))));
    act(() => result.current.onMove(PAYLOAD, W, H, px(...polar(3, -170))));
    act(() => result.current.onUp(px(...polar(3, -170))));

    const seam = result.current.sector!;
    expect(seam.phiMin).toBeCloseTo(170);
    expect(seam.phiMax).toBeCloseTo(-170);

    // Rotate by +10deg from inside [170, 190].
    act(() => result.current.onDown(PAYLOAD, W, H, px(...polar(3, 180))));
    act(() => result.current.onMove(PAYLOAD, W, H, px(...polar(3, -170)))); // physically 190
    act(() => result.current.onUp(px(...polar(3, -170))));

    const rotated = result.current.sector!;
    // Still seam-crossing in the same raw sense — never silently renormalized.
    expect(rotated.phiMin).toBeGreaterThan(rotated.phiMax);
    expect(rotated.phiMin).toBeCloseTo(180, 4);
    expect(rotated.phiMax).toBeCloseTo(-160, 4);
  });
});

describe("useMapSectorWedge — Esc restores the pre-gesture sector", () => {
  it("cancelActiveGesture reverts a mid-drag phiMin change", () => {
    const { result } = renderHook(() => useMapSectorWedge(ACTIVE, "q"));
    act(() => result.current.setMode("sector"));
    const original = result.current.sector;

    act(() => result.current.onDown(PAYLOAD, W, H, px(...polar(3, 0))));
    act(() => result.current.onMove(PAYLOAD, W, H, px(...polar(3, 90))));
    expect(result.current.sector).not.toEqual(original);

    act(() => {
      expect(cancelActiveGesture()).toBe(true);
    });
    expect(result.current.sector).toEqual(original);
  });

  it("leaving the canvas mid-drag aborts it the same way Esc does", () => {
    const { result } = renderHook(() => useMapSectorWedge(ACTIVE, "q"));
    act(() => result.current.setMode("sector"));
    const original = result.current.sector;

    act(() => result.current.onDown(PAYLOAD, W, H, px(...polar(3, 0))));
    act(() => result.current.onMove(PAYLOAD, W, H, px(...polar(3, 90))));
    act(() => result.current.onLeave());
    expect(result.current.sector).toEqual(original);
  });
});

describe("useMapSectorWedge — preview vs commit separation", () => {
  it("a full drag gesture never calls the backend, only the rAF-coalesced preview compute runs", () => {
    const { result } = renderHook(() => useMapSectorWedge(ACTIVE, "q"));
    primeToQuarter(result);
    act(() => result.current.onDown(PAYLOAD, W, H, px(...polar(2, 225))));
    act(() => result.current.onMove(PAYLOAD, W, H, px(...polar(2.5, 225))));
    act(() => result.current.onUp(px(...polar(2.5, 225))));
    act(() => {
      rafCb?.(0); // flush the coalesced preview compute, if any
    });
    expect(rsmSector).not.toHaveBeenCalled();
    expect(rsmChiProfile).not.toHaveBeenCalled();
    expect(rsmBoxCut).not.toHaveBeenCalled();
    expect(rsmBoxStats).not.toHaveBeenCalled();
  });

  it("runRadial commits via the backend (the SAME call the panel's own button makes)", async () => {
    vi.mocked(rsmSector).mockResolvedValue({
      time: [0],
      values: [[1, 1]],
      labels: ["Intensity", "N points"],
      units: ["cps", ""],
      metadata: {},
    });
    const { result } = renderHook(() => useMapSectorWedge(ACTIVE, "q"));
    primeToQuarter(result);

    act(() => result.current.runRadial());
    await flush();

    expect(rsmSector).toHaveBeenCalledTimes(1);
  });
});

describe("useMapSectorWedge — angular axes disable the interaction", () => {
  it("sector is null and dragging never starts when the displayed axes are angular", () => {
    const { result } = renderHook(() => useMapSectorWedge(ACTIVE, "angular"));
    expect(result.current.sector).toBeNull();

    act(() => result.current.setMode("sector"));
    act(() => result.current.onDown(PAYLOAD, W, H, px(...polar(3, 0))));
    expect(result.current.dragging).toBe(false);
    expect(result.current.sector).toBeNull();
  });
});

// MAIN_PLAN item 41: the sector's fields moved out of useRoiCuts.ts's own
// local useState into store.mapSector, specifically so a SECOND,
// independently-mounted useRoiCuts() (e.g. an actually open RoiCutsPanel)
// sees a drag made on this wedge, and vice versa — that was the bug this
// item fixes (RSM_CUTS_PLAN #25/MAIN_PLAN #41's own description). Both
// hooks are mounted here as two SEPARATE instances, exactly like the real
// app would (wedge inside MapStage, panel inside its own ToolWindow).
describe("useMapSectorWedge — cross-instance sync (MAIN_PLAN item 41)", () => {
  it("a wedge drag is visible to a separately-mounted useRoiCuts() instance", () => {
    const wedge = renderHook(() => useMapSectorWedge(ACTIVE, "q"));
    const panel = renderHook(() => useRoiCuts());

    primeToQuarter(wedge.result);

    expect(panel.result.current.phiMin).toBeCloseTo(90);
    expect(panel.result.current.phiMax).toBe(360);
    expect(panel.result.current.secMin).toBe(2);
    expect(panel.result.current.secMax).toBe(4);
  });

  it("a numeric edit from useRoiCuts() is visible on the wedge's own derived sector", () => {
    const wedge = renderHook(() => useMapSectorWedge(ACTIVE, "q"));
    const panel = renderHook(() => useRoiCuts());

    act(() => panel.result.current.setPhiMax(200));

    expect(wedge.result.current.sector?.phiMax).toBeCloseTo(200);
  });
});
