// Export must never mix a PENDING draw with the current grouping. After a pick
// changes, `groups`/`mode` already describe the new picks while the draw is
// still the old one (or not set yet); exporting in that window posted a flat
// figure for a faceted plot, nothing at all for a bar plot, and a box figure
// without its empty slots. Export now waits for the fresh draw
// (`useStatStageExport`). Each test holds the box-stats request open with a
// promise it controls, so the pending state is forced, not raced.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox } from "../../lib/api";
import { exportCategoricalFigure, exportStatplotFigure } from "../../lib/api/figures";
import type { DataStruct, Dataset } from "../../lib/types";
import { usePendingOps } from "../../store/pendingOps";
import { useStatStage } from "./useStatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
}));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
  exportCategoricalFigure: vi.fn(),
}));

// grp: A/B. fac: X/Y plus a declared level Z no row uses (an empty slot when
// grouping by fac). y: the value.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7],
  values: [
    [0, 0, 1], [0, 1, 2], [1, 0, 3], [1, 1, 4],
    [0, 0, 5], [0, 1, 6], [1, 0, 7], [1, 1, 8],
  ],
  labels: ["grp", "fac", "y"],
  units: ["", "", ""],
  metadata: {},
  cat_levels: { 0: ["A", "B"], 1: ["X", "Y", "Z"] },
};
const DS: Dataset = { id: "pending", name: "pending.csv", data: DATA };

/** Box stats answer only when released (then fail over to the client stats). */
let hold: Promise<void> | null = null;
let release: () => void = () => {};
function holdBoxStats() {
  hold = new Promise<void>((r) => {
    release = r;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  hold = null;
  vi.mocked(statsBox).mockImplementation(async () => {
    if (hold) await hold;
    throw new Error("offline");
  });
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
  vi.mocked(exportCategoricalFigure).mockResolvedValue(undefined);
});

async function settledStage() {
  const hook = renderHook(() =>
    useStatStage({ active: DS, yKeys: null, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: () => {} }),
  );
  await waitFor(() => {
    const d = hook.result.current.draw;
    expect(d?.mode === "box" && d.slots != null).toBe(true);
  });
  return hook;
}

/** Let any already-queued promise work run (an unguarded export would post here). */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

describe("Stat Stage export while a recompute is pending", () => {
  it("box: waits for the fresh draw and exports its slots, empty level included", async () => {
    const { result } = await settledStage();
    holdBoxStats();
    act(() => result.current.setGroupCol(1));
    let p!: Promise<boolean>;
    act(() => {
      p = result.current.exportFigure("svg");
    });
    await flush();
    expect(exportStatplotFigure).not.toHaveBeenCalled();

    await act(async () => release());
    let ok = false;
    await act(async () => {
      ok = await p;
    });
    expect(ok).toBe(true);
    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    const draw = result.current.draw;
    if (draw?.mode !== "box" || !draw.slots) throw new Error("expected a slotted box draw");
    expect(spec.labels).toEqual(draw.slots.map((s) => s.label));
    expect(spec.labels).toHaveLength(3);
    expect((spec.data as number[][]).map((g) => g.length)).toEqual([4, 4, 0]);
    expect(spec.y_domain).not.toBeNull();
  });

  it("faceted: waits for the facet draws instead of falling through to the flat figure", async () => {
    const { result } = await settledStage();
    holdBoxStats();
    act(() => result.current.setFacetCol(1));
    let p!: Promise<boolean>;
    act(() => {
      p = result.current.exportFigure("svg");
    });
    await flush();
    expect(exportStatplotFigure).not.toHaveBeenCalled();

    await act(async () => release());
    await act(async () => {
      await p;
    });
    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    expect(spec.facets?.map((f) => f.label)).toEqual(result.current.drawFacets?.map((f) => f.label));
    expect(spec.facets).toHaveLength(2);
  });

  it("bar: an Export bound during the pending render still exports the bar figure", async () => {
    let pendingExport: ((fmt: string) => Promise<boolean>) | null = null;
    const hook = renderHook(() => {
      const st = useStatStage({
        active: DS, yKeys: null, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: () => {},
      });
      if (st.mode === "bar" && st.draw?.mode !== "bar") pendingExport = st.exportFigure;
      return st;
    });
    await waitFor(() => expect(hook.result.current.draw?.mode).toBe("box"));
    act(() => hook.result.current.setMode("bar"));
    expect(pendingExport).not.toBeNull();
    let ok = false;
    await act(async () => {
      ok = await pendingExport!("svg");
    });
    expect(ok).toBe(true);
    expect(exportCategoricalFigure).toHaveBeenCalledTimes(1);
    expect(vi.mocked(exportCategoricalFigure).mock.calls[0][0].groups).toEqual(["A", "B"]);
  });

  it("Cancel during the wait exports nothing, even once the draw lands", async () => {
    const { result } = await settledStage();
    holdBoxStats();
    act(() => result.current.setGroupCol(1));
    let p!: Promise<boolean>;
    act(() => {
      p = result.current.exportFigure("svg");
    });
    const op = usePendingOps.getState().ops.at(-1);
    expect(op?.label).toBe("Exporting statistical plot…");
    act(() => op?.cancel?.());
    let ok = true;
    await act(async () => {
      ok = await p;
    });
    expect(ok).toBe(false);
    await act(async () => release());
    await flush();
    expect(exportStatplotFigure).not.toHaveBeenCalled();
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("unmounting during the wait rejects instead of hanging", async () => {
    const { result, unmount } = await settledStage();
    holdBoxStats();
    act(() => result.current.setGroupCol(1));
    let p!: Promise<boolean>;
    act(() => {
      p = result.current.exportFigure("svg");
    });
    unmount();
    await expect(p).rejects.toThrow("plot closed before export");
    expect(exportStatplotFigure).not.toHaveBeenCalled();
  });
});
