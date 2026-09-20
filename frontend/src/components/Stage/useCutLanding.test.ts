// BUG-020 — a landed cut must get a library-unique id.
//
// `useCutLanding` used to mint ids from a PRIVATE module counter
// (`let _seq = 0; … \`cut-${++_seq}\``). That counter resets on every page
// load, while the library does not: autosave restore runs at startup, so a
// session that reopens a workspace containing `cut-1` and then lands one new
// cut ends up with TWO datasets carrying that id. Nothing dedupes —
// `store/useApp.ts`'s `addDataset` appends, and `store/removeDatasets.ts`
// filters by id — so the collision is silently destructive:
//   * `activeId` resolves through `datasets.find(...)`, which returns the
//     FIRST match, so Apply plots the OLD cut's rows;
//   * deleting either one deletes BOTH.
// That reproduces the owner's "Apply made a new plot that was empty/wrong"
// symptom class independently of BUG-019's autosave stall.
//
// The fix is to draw from `store/idSeq.ts`, the shared sequence whose whole
// documented purpose is that ids never collide regardless of prefix.
//
// `vi.resetModules()` + a dynamic re-import is what makes the page-reload
// half real: it gives a FRESH copy of the hook's module, which is the only
// way to observe what a private module counter does at startup.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../lib/types";

vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

function cut(first: number): DataStruct {
  return {
    time: [0, 1, 2],
    values: [[first], [first + 1], [first + 2]],
    labels: ["Intensity"],
    units: ["counts"],
    metadata: { cut_label: `cut ${first}`, parser_name: "box_cut" },
  };
}

/** The id a RESTORED workspace carries for a cut landed in an earlier
 *  session — i.e. exactly what the old private counter reminted on the first
 *  cut of the next session. */
const RESTORED_CUT_ID = "cut-1";

/** Reload the app: a fresh module graph (so the hook's own counters start
 *  over, which is the whole point) whose store is then seeded with the
 *  library autosave restored — including last session's `cut-1`. The store
 *  is taken from the SAME fresh graph as the hook, or the hook would be
 *  writing into a different module instance than the assertions read. */
async function reloadWithRestoredCut() {
  vi.resetModules();
  const [{ useCutLanding }, { useApp }] = await Promise.all([
    import("./useCutLanding"),
    import("../../store/useApp"),
  ]);
  useApp.setState({
    datasets: [{ id: RESTORED_CUT_ID, name: "a cut from last session", data: cut(10) }],
    activeId: RESTORED_CUT_ID,
    selectedIds: [RESTORED_CUT_ID],
    history: [],
    future: [],
  });
  const { result } = renderHook(() => useCutLanding());
  const land = async (): Promise<string | null> => {
    let id: string | null = null;
    await act(async () => {
      id = await result.current.land(Promise.resolve(cut(99)));
    });
    return id;
  };
  return { useApp, land };
}

beforeEach(() => {
  vi.resetModules();
});

describe("BUG-020 — a landed cut never reuses an id already in the library", () => {
  it("lands beside a restored cut instead of colliding with it", async () => {
    const { useApp, land } = await reloadWithRestoredCut();
    const landedId = await land();

    const { datasets } = useApp.getState();
    expect(landedId).not.toBeNull();
    expect(datasets).toHaveLength(2);
    // The load-bearing property: ids are unique across the library.
    expect(new Set(datasets.map((d) => d.id)).size).toBe(datasets.length);
    expect(landedId).not.toBe(RESTORED_CUT_ID);
  });

  it("makes the NEW cut's rows the ones the plot resolves", async () => {
    const { useApp, land } = await reloadWithRestoredCut();
    await land();

    const s = useApp.getState();
    const active = s.datasets.find((d) => d.id === s.activeId);
    // Pre-fix `find` returned the RESTORED dataset (values[0] === [10]).
    expect(active?.data.values[0]).toEqual([99]);
  });

  it("deleting the landed cut leaves the restored one alive", async () => {
    const { useApp, land } = await reloadWithRestoredCut();
    const landedId = await land();

    useApp.getState().removeDatasets([landedId!]);
    // Pre-fix this removed BOTH (one id, two rows) and left an empty library.
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual([RESTORED_CUT_ID]);
  });
});
