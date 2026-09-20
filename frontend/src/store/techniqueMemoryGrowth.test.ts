// BUG-019 reproduction, at the layer the defect actually lives on: the
// store's dataset-switch path.
//
// Owner report (2026-09-19): "when I did a xrdml 3d data set and a box
// integration, the preview looked good, but then when I hit apply, it made a
// new plot that was empty, and when I toggled to previously plotted data,
// they are also blank."
//
// The mechanism is not in the ROI path at all. `captureTechniqueView`
// (lib/techniqueViewMemory.ts) took its capture source as a `LiveViewSource`
// and spread it whole. `store/windows.ts`'s `focusedRebindPatch` — the
// shared body of `setActive` and `rebindWindow`'s focused branch — passes
// the ENTIRE `AppState` there, which carries `datasets`, `plotWindows` and
// the PREVIOUS `techniqueViewMemory`. So every genuine dataset switch stored
// a full copy of the library AND of the map built by the switch before it,
// and the map's serialized size compounded each time (Fibonacci-like when
// alternating two techniques, ratio -> phi ~ 1.62). Autosave
// (`useWorkspaceAutosave`) `JSON.stringify`s that map on an 800 ms debounce
// after every switch, so a few toggles on a library holding one real 3-D RSM
// stall the main thread long enough that no plot — the new cut's or any
// previously plotted one's — ever repaints.
//
// WHAT THIS FILE ASSERTS, and what it does not: the blank canvas is a
// main-thread stall, which jsdom cannot show. What it CAN pin, and what
// actually decides whether the stall happens, is the size and shape of the
// state the switch leaves behind — so these tests assert that, plus that
// the cut still lands and both datasets stay drawable. The user-visible half
// was measured against the running app; see the BUG-019 entry in
// plans/BUGS_AND_ISSUES.md for those numbers.

import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildColumns, effectiveChannels } from "../lib/plotdata";
import type { Dataset, DataStruct } from "../lib/types";
import { useCutLanding } from "../components/Stage/useCutLanding";
import { useApp } from "./useApp";

vi.mock("../components/overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const NF = 12;
const NP = 20;

/** An XRDML reciprocal-space map, the shape `io/xrdml.py::_build_2d` emits:
 *  a scattered (2Theta, axis1, Intensity, Qx, Qz) cloud plus the `is2D` /
 *  `map_shape` / `axis1_name` grid metadata the box cut keys off. */
function rsmData(): DataStruct {
  const time: number[] = [];
  const values: number[][] = [];
  for (let r = 0; r < NF; r++) {
    const om = 16 + (4 * r) / (NF - 1);
    for (let c = 0; c < NP; c++) {
      const tt = 30 + (8 * c) / (NP - 1);
      time.push(r * NP + c);
      values.push([tt, om, 1000 * Math.exp(-(((tt - 34) / 0.8) ** 2 + ((om - 18) / 0.4) ** 2)) + 5, 0.01 * c, 2 + 0.01 * r]);
    }
  }
  return {
    time,
    values,
    labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"],
    units: ["deg", "deg", "counts", "Ang^-1", "Ang^-1"],
    metadata: {
      source: "map.xrdml",
      parser_name: "import_xrdml",
      x_column_name: "2-Theta",
      x_column_unit: "deg",
      technique: "xrd.rsm",
      is2D: true,
      mesh_kind: "mesh",
      map_shape: [NF, NP],
      axis1_name: "Omega",
      axis2_name: "2Theta",
    },
  };
}

/** What `POST /api/rsm/box` actually returns for that map — the exact wire
 *  shape measured against the live route (`calc/boxcut.py::box_cut`'s grid
 *  path): x is the collapsed axis, two channels, `is2D` cleared. */
function boxCutData(): DataStruct {
  const time: number[] = [];
  const values: number[][] = [];
  for (let i = 0; i < 9; i++) {
    time.push(32 + (4 * i) / 8);
    values.push([1600 + 120 * i, 6]);
  }
  return {
    time,
    values,
    labels: ["Intensity", "N points"],
    units: ["counts", ""],
    metadata: {
      source: "map.xrdml",
      parser_name: "box_cut",
      x_column_name: "2Theta",
      x_column_unit: "deg",
      technique: "xrd.powder",
      cut_label: "Box x=[32, 36] y=[17, 19] sum→x",
      is2D: false,
      cut_kind: "box",
      cut_space: "angular",
      reduce: "sum",
      collapse: "x",
    },
  };
}

/** A previously plotted 1-D XRD scan — same technique family as the map, so
 *  it shares a technique-memory slot with it. */
function priorScan(): Dataset {
  return {
    id: "prior",
    name: "prior scan.xrdml",
    data: {
      time: Array.from({ length: 400 }, (_, i) => 20 + i * 0.1),
      values: Array.from({ length: 400 }, (_, i) => [100 + i]),
      labels: ["Intensity"],
      units: ["counts"],
      metadata: { source: "prior.xrdml", parser_name: "import_xrdml", technique: "xrd.powder", x_column_name: "2-Theta", x_column_unit: "deg", is2D: false },
    },
  };
}

/** Finite points the plot would actually draw for the ACTIVE dataset, built
 *  through the same `effectiveChannels` + column packing the stage uses. */
function drawablePoints(): number {
  const s = useApp.getState();
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds) return 0;
  const plotted = effectiveChannels(ds.data, s.yKeys, s.xKey, ds.channelRoles, s.seriesOrder);
  const payload = buildColumns(ds.data, s.y2Keys, s.xKey, plotted);
  const cols = payload.data as (number | null)[][];
  let n = 0;
  for (let c = 1; c < cols.length; c++) {
    for (const v of cols[c]) if (v != null && Number.isFinite(v)) n++;
  }
  return n;
}

const memorySize = (): number => JSON.stringify(useApp.getState().techniqueViewMemory).length;

beforeEach(() => {
  useApp.setState({
    datasets: [priorScan(), { id: "map", name: "map.xrdml", data: rsmData() }],
    activeId: "prior",
    selectedIds: ["prior"],
    techniqueViewMemory: {},
    history: [],
    future: [],
  });
});

describe("BUG-019 — an ROI box-cut apply followed by toggling back must not bloat the store", () => {
  it("lands the cut, keeps both plots drawable, and leaves the technique memory bounded", async () => {
    useApp.getState().setActive("prior");
    expect(drawablePoints()).toBeGreaterThan(0);

    // The owner's flow: work on the map, then hit the commit bar's ∫ button.
    // `useCutLanding.land` is the ONE addDataset path every cut commit
    // shares (canvas bar, ROI panel Run, batch Apply to selected).
    useApp.getState().setActive("map");
    const { result } = renderHook(() => useCutLanding());
    await act(async () => {
      await result.current.land(Promise.resolve(boxCutData()));
    });

    expect(useApp.getState().datasets).toHaveLength(3);
    expect(drawablePoints()).toBeGreaterThan(0); // the new cut's own plot

    // ...then toggle back to a previously plotted dataset.
    useApp.getState().setActive("prior");
    expect(drawablePoints()).toBeGreaterThan(0);

    // Guard the guard: a capture must actually have happened, or every
    // assertion below would hold vacuously on an empty map.
    const captured = useApp.getState().techniqueViewMemory;
    expect(Object.keys(captured).length).toBeGreaterThan(0);

    // The capture that switch performed must hold a VIEW, not the library.
    for (const entry of Object.values(captured)) {
      expect(entry).not.toHaveProperty("datasets");
      expect(entry).not.toHaveProperty("plotWindows");
      expect(entry).not.toHaveProperty("techniqueViewMemory");
    }
    expect(memorySize()).toBeLessThan(4_000);
  });

  it("repeated dataset switches do not compound the technique memory", () => {
    const sizes: number[] = [];
    for (let i = 0; i < 10; i++) {
      useApp.getState().setActive(i % 2 === 0 ? "map" : "prior");
      sizes.push(memorySize());
    }
    // Guard the guard, as above — both technique slots must be populated.
    expect(Object.keys(useApp.getState().techniqueViewMemory).sort()).toEqual(["xrd.powder", "xrd.rsm"]);
    // Pre-fix this sequence measured 0.5 MB -> 74 MB over ten switches.
    // Alternating two techniques is Fibonacci-like, not doubling: only the
    // slot being written is replaced, so each slot absorbs the other one
    // generation late (`size(k) ~ size(k-1) + size(k-2) + C`) and the ratio
    // tends to phi ~ 1.62. The invariant is that it stops growing once every
    // technique present has a slot — not merely that it grows "slowly".
    expect(sizes[sizes.length - 1]).toBeLessThan(4_000);
    expect(sizes[sizes.length - 1]).toBe(sizes[sizes.length - 2]);
  });
});
