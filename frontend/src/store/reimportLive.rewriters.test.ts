// Auto-update vs the features that rewrite a worksheet's `data` WITHOUT an edit
// (third review, R1): a fit()/fitval() column refreshed after a refit, a
// sheet() (or any) formula column recomputed, a background-subtraction recalc.
// None of them is the user's edit, so growth must stay quiet -- no "replaced
// your edits" step, no toast -- while a real hand edit still diverges.
// Divergence is decided on the file's rows (lib/reimport.holdsFileRows).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { importLive, statSources, type LiveRead, type SourceStat } from "../lib/api/sourceWatch";
import { createWatcher, type Watcher } from "../lib/sourceWatch";
import type { DataStruct, Dataset, FitSpec } from "../lib/types";
import { addDerivedColumn } from "./derivedColumnRun";
import { setColumnHeader } from "./worksheetColumns";
import { growAndSetCell } from "./worksheetGrow";
import { renameLevel } from "./levelRename";
import { useLevelOrder } from "./levelOrder";
import { liveReimport } from "./reimportLive";
import { toast } from "./toasts";
import { useApp } from "./useApp";

vi.mock("../lib/api/sourceWatch", () => ({ importLive: vi.fn(), statSources: vi.fn() }));
// The corrections chokepoint: subtract 0.5 from channel 1 (a constant background).
const corrected = (raw: DataStruct): DataStruct => ({ ...raw, values: raw.values.map((r) => [r[0], r[1] - 0.5, ...r.slice(2)]) });
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  fetchBookData: vi.fn(() => new Promise(() => {})),
  applyCorrections: vi.fn(async (req: { dataset: DataStruct }) => corrected(req.dataset)),
}));
vi.mock("./toasts", () => ({ toast: vi.fn() }));
vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const PATH = "/data/run.dat";
// Column 2 is categorical (codes into `cat_levels`), as an instrument's state column would be.
const rows = (n: number): DataStruct => ({
  time: Array.from({ length: n }, (_, i) => i),
  values: Array.from({ length: n }, (_, i) => [i * 10, 2 * i + 1, i % 2]),
  labels: ["T", "m", "G"],
  units: ["K", "emu", ""],
  metadata: {},
  cat_levels: { 2: ["A", "B"] },
});
let n = 3;
const stampOf = (k: number): string => `${k}000000000:${k * 10}:7:${k}`;
const read = (): LiveRead => ({ data: rows(n), stamp: stampOf(n), mtime: 1_731_000_000 + n, size: n * 10, checksum: `sha256:${n}`, held: false });

const app = () => useApp.getState();
const live = () => app().datasets.find((d) => d.id === "d1")!;
let w: Watcher;
const settle = async () => {
  for (let i = 0; i < 3; i++) await w.tick();
};
const labels = () => app().history.map((e) => e.label);
const replaced = () => vi.mocked(toast).mock.calls.filter(([m]) => /replaced your edits/.test(String(m)));

beforeEach(async () => {
  vi.clearAllMocks();
  n = 3;
  vi.mocked(statSources).mockImplementation(async (paths): Promise<SourceStat[]> => paths.map((path) => ({ path, state: "ok", stamp: stampOf(n) })));
  vi.mocked(importLive).mockImplementation(async () => read());
  const ds: Dataset = { id: "d1", name: "run.dat", data: rows(3), source: { kind: "path", path: PATH } };
  useApp.setState({ datasets: [ds], activeId: "d1", selectedIds: [], history: [], future: [], macroSteps: [], status: "", recalcMode: "manual" });
  w = createWatcher(
    {
      stat: (p) => statSources(p),
      dataset: (id) => app().datasets.find((d) => d.id === id),
      reimport: (id, shared, opts) => liveReimport(useApp.setState, useApp.getState, id, shared, opts),
      status: (m) => app().setStatus(m),
      notify: () => {},
      visible: () => true,
      now: () => 0,
      epoch: () => app().docEpoch,
    },
    { timers: false },
  );
  w.enable("d1");
  await settle(); // first read: the worksheet equals the file -> adopted quietly
  expect(app().history).toHaveLength(0);
});

/** The file gains a row; returns how many labelled auto-update steps that took. */
async function grow(): Promise<number> {
  const before = labels().filter((l) => l.startsWith("Auto-update")).length;
  n += 1;
  await settle();
  expect(live().data.time).toHaveLength(n);
  return labels().filter((l) => l.startsWith("Auto-update")).length - before;
}

describe("data rewrites that are not edits keep growth quiet", () => {
  it("a fitval() residual column refreshed after every refit (the real fit-ref refresh)", async () => {
    const lin: FitSpec = { model: "Linear", params: [2, 1], exitFlag: 1 };
    useApp.setState({ datasets: [{ ...live(), fitSpec: lin }] });
    await addDerivedColumn("d1", { name: "res", expr: 'B - fitval("Linear", x)', propagate: false });
    expect(await grow()).toBe(0);
    const beforeRefit = live().data;
    app().setFitSpec("d1", { ...lin, params: [2.1, 0.9] }); // the refit
    await vi.waitFor(() => expect(live().data).not.toBe(beforeRefit)); // refreshFitRefsFor rewrote data
    expect(await grow()).toBe(0);
    expect(await grow()).toBe(0);
    expect(replaced()).toHaveLength(0);
  });

  it("a formula column recomputed in place (sheet() and every other formula column)", async () => {
    await addDerivedColumn("d1", { name: "twice", expr: "B * 2", propagate: false });
    const ds = live();
    // What a sheet() column's recompute writes: a new `data`, file columns untouched.
    useApp.setState({ datasets: [{ ...ds, data: { ...ds.data, values: ds.data.values.map((r) => [...r.slice(0, -1), r[r.length - 1] + 1]) } }] });
    expect(await grow()).toBe(0);
    expect(replaced()).toHaveLength(0);
  });

  it("a background-subtraction recalc (corrections: the file's rows are `raw`, which it never writes)", async () => {
    const ds = live();
    useApp.setState({ datasets: [{ ...ds, raw: ds.data, data: corrected(ds.data), corrections: { bgSubtract: 0.5 } as never }] });
    await settle();
    expect(await grow()).toBe(0);
    const cur = live();
    useApp.setState({ datasets: [{ ...cur, data: corrected(cur.raw!) }] }); // the recalc: new data, same raw
    expect(await grow()).toBe(0);
    expect(live().data.values[n - 1][1]).toBe(2 * (n - 1) + 1 - 0.5); // corrections applied to the new rows
    expect(replaced()).toHaveLength(0);
  });
});

describe("a real hand edit still diverges", () => {
  it("is replaced at the next change as one labelled step, with its toast", async () => {
    await addDerivedColumn("d1", { name: "twice", expr: "B * 2", propagate: false });
    app().setCellValue("d1", 0, 1, 999);
    expect(await grow()).toBe(1);
    expect(labels().at(-1)).toBe("Auto-update replaced your edits");
    expect(replaced()).toHaveLength(1);
  });
});

describe("header, unit and text edits are edits too (H2)", () => {
  const cases: [string, () => void][] = [
    ["a column unit", () => setColumnHeader("d1", 1, { unit: "A m2" })],
    ["a column name", () => setColumnHeader("d1", 1, { label: "moment" })],
    ["the X column's unit", () => setColumnHeader("d1", -1, { unit: "C" })],
    ["a text cell (row-indexed sidecar)", () => {
      const ds = live();
      app().recordHistory("edit text cell");
      useApp.setState({ datasets: [{ ...ds, data: { ...ds.data, metadata: { ...ds.data.metadata, text_columns: { 2: ["note"] } } } }] });
    }],
  ];
  for (const [kind, edit] of cases) {
    it(`${kind}: replaced only as a labelled, undoable step`, async () => {
      edit();
      const edited = live().data;
      expect(await grow()).toBe(1);
      expect(labels().at(-1)).toBe("Auto-update replaced your edits");
      expect(replaced()).toHaveLength(1);
      app().undo();
      expect(live().data).toBe(edited); // the edit comes back: its snapshot was not rebased
    });
  }
});

describe("history composes with the other history writers (H1)", () => {
  it("growAndSetCell after an auto-update step folds only its own entries", async () => {
    for (const name of ["a", "b", "c"]) app().renameDataset("d1", name);
    app().setCellValue("d1", 0, 1, 999);
    expect(await grow()).toBe(1); // "Auto-update replaced your edits"
    const before = labels();
    growAndSetCell("d1", live().data.time.length + 1, 1, 5);
    expect(labels().slice(0, before.length)).toEqual(before); // the renames and the step survive
    expect(labels()).toHaveLength(before.length + 1);
    expect(app().history.every((e) => e.seq > 0)).toBe(true);
  });
});

describe("older file data is not 'your edits' (undo past a formula-column add)", () => {
  it("is replaced as a labelled step without the edits toast", async () => {
    await addDerivedColumn("d1", { name: "twice", expr: "B * 2", propagate: false });
    expect(await grow()).toBe(0);
    app().undo(); // removes the column: back to the older rows of the file, no edits of the user's
    expect(await grow()).toBe(1);
    expect(labels().at(-1)).toBe("Auto-update (newer file data)");
    expect(replaced()).toHaveLength(0);
  });
});

describe("categorical levels (M1)", () => {
  const reorder = () => {
    useLevelOrder.getState().openLevelOrder("d1", 2);
    useLevelOrder.getState().moveDown(0); // [1, 0]
    expect(useLevelOrder.getState().commit()).toBe(true);
  };

  it("a level rename is an edit: replaced only as a labelled step that undo reverses", async () => {
    expect(renameLevel("d1", 2, 0, "Alpha")).toBe(true);
    const renamed = live().data;
    expect(await grow()).toBe(1);
    expect(labels().at(-1)).toBe("Auto-update replaced your edits");
    app().undo();
    expect(live().data).toBe(renamed);
    expect(live().data.cat_levels?.[2]).toEqual(["Alpha", "B"]);
  });

  it("a level ORDER is presentation: kept across quiet growth, and its undo still works", async () => {
    reorder();
    expect(live().data.level_order).toEqual({ 2: [1, 0] });
    expect(await grow()).toBe(0); // not an edit of the file's data: no step
    expect(live().data.level_order).toEqual({ 2: [1, 0] }); // carried over, like the view
    expect(await grow()).toBe(0);
    app().undo(); // "reorder levels": its snapshot was rebased with ITS OWN (absent) order
    expect(live().data.level_order).toBeUndefined();
    expect(live().data.time).toHaveLength(n); // ...and the fresh rows
    expect(replaced()).toHaveLength(0);
  });

  it("the review's repro: rename, reorder, growth -- both survive or are one undo away", async () => {
    expect(renameLevel("d1", 2, 0, "Alpha")).toBe(true);
    reorder();
    expect(await grow()).toBe(1);
    expect(live().data.level_order).toEqual({ 2: [1, 0] }); // the order is kept even here
    app().undo();
    expect(live().data.cat_levels?.[2]).toEqual(["Alpha", "B"]);
    expect(live().data.level_order).toEqual({ 2: [1, 0] });
    app().undo();
    expect(live().data.level_order).toBeUndefined();
    expect(live().data.cat_levels?.[2]).toEqual(["Alpha", "B"]);
  });
});
