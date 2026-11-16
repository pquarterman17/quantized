// Auto-update from source, end to end over the REAL store: the watcher
// (lib/sourceWatch.ts) driving store/reimportLive.ts, with only the two wire
// calls faked. The undo/redo contract it must keep (F1 of the review):
//   a) a live update never clears redo; a growing update is quiet and rebases
//      the history AND redo snapshots holding the rows it replaced;
//   b) an undo that crosses an auto-update is not re-read until the file
//      really changes again;
//   c) a file change while the worksheet differs from its file (hand edit,
//      undo) is ONE labelled step that keeps redo, and a hand-edited cell does
//      not reset the view, styles or excluded rows of a growing file.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { importLive, statSources, type LiveRead, type SourceStat } from "../lib/api/sourceWatch";
import { HttpError } from "../lib/api/http";
import { createWatcher, STABLE_PARTIAL_POLLS, type Watcher } from "../lib/sourceWatch";
import type { DataStruct, Dataset } from "../lib/types";
import { askConfirm } from "../components/overlays/ConfirmDialog";
import { liveReimport } from "./reimportLive";
import { toast } from "./toasts";
import { useApp } from "./useApp";

vi.mock("../lib/api/sourceWatch", () => ({ importLive: vi.fn(), statSources: vi.fn() }));
vi.mock("./toasts", () => ({ toast: vi.fn() }));
vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const PATH = "/data/run.dat";
const rows = (n: number): DataStruct => ({
  time: Array.from({ length: n }, (_, i) => i),
  values: Array.from({ length: n }, (_, i) => [i * 10, i]),
  labels: ["T", "m"],
  units: ["K", "emu"],
  metadata: {},
});
/** The file as the server would read it: stamp `n`, `rows(n)` (or `data`). */
let file: { n: number; data?: DataStruct; held?: boolean };
const stampOf = (n: number): string => `${n}000000000:${n * 10}:7:${n}`;
const read = (): LiveRead => ({
  data: file.data ?? rows(file.n),
  stamp: stampOf(file.n),
  mtime: 1_731_000_000.123456 + file.n,
  size: file.n * 10,
  checksum: `sha256:${file.n}`,
  held: file.held ?? false,
});

const app = () => useApp.getState();
const live = () => app().datasets.find((d) => d.id === "d1")!;
let w: Watcher;
const tick = () => w.tick();
/** Polls until the file's current stamp has settled and been read. */
const settle = async () => {
  for (let i = 0; i < 3; i++) await tick();
};

beforeEach(() => {
  vi.clearAllMocks();
  file = { n: 3 };
  vi.mocked(statSources).mockImplementation(async (paths): Promise<SourceStat[]> => paths.map((path) => ({ path, state: "ok", stamp: stampOf(file.n) })));
  vi.mocked(importLive).mockImplementation(async () => read());
  const ds: Dataset = { id: "d1", name: "run.dat", data: rows(3), source: { kind: "path", path: PATH }, importedAt: "2026-11-16T10:00:00.000Z", excludedRows: [1] };
  useApp.setState({
    datasets: [ds], activeId: "d1", selectedIds: [], history: [], future: [], macroSteps: [],
    hiddenChannels: [1], seriesStyles: { 0: { color: "#ff0000" } }, status: "",
  });
  w = createWatcher(
    {
      stat: (p) => statSources(p),
      dataset: (id) => app().datasets.find((d) => d.id === id),
      reimport: (id, shared, opts) => liveReimport(useApp.setState, useApp.getState, id, shared, opts),
      status: (m) => app().setStatus(m),
      notify: () => {},
      visible: () => true,
      now: () => 0,
    },
    { timers: false },
  );
  w.enable("d1");
});

/** Watch, let the first file change install (the one labelled first read), and clear the stacks. */
async function installed(): Promise<void> {
  await tick(); // baseline: the file matches the import time
  file = { n: 4 };
  await settle();
  expect(live().data.time).toHaveLength(4);
  useApp.setState({ history: [], future: [] });
}

describe("quiet growth (F1 a)", () => {
  it("the first read after turning it on is one labelled step; growth after it is quiet and keeps the view", async () => {
    await tick();
    file = { n: 4 };
    await settle();
    expect(app().history.map((e) => e.label)).toEqual(["Auto-update (first read of the file)"]);
    file = { n: 6 };
    await settle();
    expect(live().data.time).toHaveLength(6);
    expect(app().history).toHaveLength(1); // no step per refresh
    expect(app().macroSteps).toHaveLength(0);
    expect(askConfirm).not.toHaveBeenCalled();
    expect(live().excludedRows).toEqual([1]);
    expect(app().hiddenChannels).toEqual([1]);
    expect(app().seriesStyles).toEqual({ 0: { color: "#ff0000" } });
  });

  it("never clears redo, and rebases the history AND redo snapshots holding the replaced rows", async () => {
    await installed();
    app().renameDataset("d1", "renamed"); // an unrelated edit...
    app().undo(); // ...undone: redo holds it
    expect(app().future).toHaveLength(1);
    file = { n: 7 };
    await settle();
    expect(app().future).toHaveLength(1); // redo survived the update
    expect(app().future[0].snapshot.datasets[0].data.time).toHaveLength(7); // and was rebased
    app().redo();
    expect(live().name).toBe("renamed");
    expect(live().data.time).toHaveLength(7); // redo did not bring stale rows back
    app().undo();
    expect(live().data.time).toHaveLength(7);
    expect(live().source?.mtime).toBe(1_731_000_000.123456 + 7); // the rebased baseline too
  });

  it("a first read that finds the worksheet already equal to its file adopts it quietly", async () => {
    const before = live().data;
    await settle();
    expect(importLive).toHaveBeenCalledTimes(1);
    expect(live().data).toBe(before); // nothing rewritten
    expect(app().history).toHaveLength(0);
    expect(live().source?.checksum).toBe("sha256:3");
    file = { n: 5 };
    await settle();
    expect(live().data.time).toHaveLength(5);
    expect(app().history).toHaveLength(0); // already installed: quiet
  });
});

describe("a worksheet that differs from its file (F1 b, c)", () => {
  it("a hand edit is replaced at the next file change as one labelled step that keeps redo and the view", async () => {
    await installed();
    app().renameDataset("d1", "r2");
    app().undo(); // something to redo
    app().setCellValue("d1", 0, 1, 999); // a hand edit clears redo itself (the user's own edit)...
    app().renameDataset("d1", "r3");
    app().undo(); // ...so make a fresh redo entry after it
    expect(app().future).toHaveLength(1);
    await settle();
    expect(live().data.values[0][1]).toBe(999); // unchanged file: the edit is kept
    file = { n: 5 };
    await settle();
    expect(live().data.values[0][1]).toBe(0); // the file's data replaced the edit...
    expect(app().history.at(-1)?.label).toBe("Auto-update replaced your edits"); // ...as one step
    expect(app().future).toHaveLength(1); // redo kept
    expect(live().excludedRows).toEqual([1]); // an edited cell is not a reshape
    expect(app().hiddenChannels).toEqual([1]);
    expect(vi.mocked(toast)).toHaveBeenCalledWith(expect.stringMatching(/replaced your edits.*Undo/), "info");
    app().undo();
    expect(live().data.values[0][1]).toBe(999); // the edit is one Ctrl+Z away
  });

  it("an undo across an auto-update is not reverted while the file is unchanged", async () => {
    await installed();
    app().setCellValue("d1", 0, 1, 999);
    file = { n: 5 };
    await settle(); // labelled replacement
    app().undo(); // the user deliberately goes back to the edit
    expect(live().data.values[0][1]).toBe(999);
    const reads = vi.mocked(importLive).mock.calls.length;
    for (let i = 0; i < 6; i++) await tick(); // ~12 s of polls, no file change
    expect(vi.mocked(importLive).mock.calls.length).toBe(reads); // no re-read
    expect(live().data.values[0][1]).toBe(999);
    expect(app().future).toHaveLength(1);
    app().redo(); // redo still works
    expect(live().data.values[0][1]).toBe(0);
  });

  it("after an undo, the next REAL change is one labelled step, and redo survives it", async () => {
    await installed();
    app().setCellValue("d1", 0, 1, 999);
    file = { n: 5 };
    await settle();
    app().undo();
    expect(app().future).toHaveLength(1);
    file = { n: 6 };
    await settle();
    expect(live().data.time).toHaveLength(6);
    expect(app().history.at(-1)?.label).toBe("Auto-update replaced your edits");
    expect(app().future).toHaveLength(1);
    expect(app().future[0].snapshot.datasets[0].data.time).toHaveLength(6); // it held the installed rows: rebased
  });

  it("undoing the hand edit itself makes the worksheet match again: growth is quiet", async () => {
    await installed();
    app().setCellValue("d1", 0, 1, 999);
    app().undo();
    await tick();
    file = { n: 5 };
    await settle();
    expect(app().history).toHaveLength(0);
    expect(app().future).toHaveLength(1); // the edit is still redoable
  });

  it("a reshape is a labelled step and keeps redo", async () => {
    await installed();
    app().renameDataset("d1", "r2");
    app().undo();
    file = { n: 2 }; // shrunk: a different file
    await settle();
    expect(app().history.at(-1)?.label).toBe("Auto-update (the file's shape changed)");
    expect(app().future).toHaveLength(1);
    expect(live().excludedRows).toBeUndefined();
  });
});

describe("the read itself", () => {
  it("records the read's baseline exactly (the probe's mtime float, size and checksum)", async () => {
    await installed();
    expect(live().source).toEqual({ kind: "path", path: PATH, mtime: 1_731_000_000.123456 + 4, size: 40, checksum: "sha256:4" });
  });

  it("a read during which the file changed (409) writes nothing and is retried", async () => {
    await installed();
    const before = live();
    vi.mocked(importLive).mockRejectedValueOnce(new HttpError(409, "the file changed while it was being read"));
    file = { n: 5 };
    await tick();
    await tick(); // settled: read -> 409
    expect(live()).toBe(before);
    expect(w.phase("d1")).toBe("waiting");
    await tick(); // retried
    expect(live().data.time).toHaveLength(5);
  });

  it("a held last line is read in full once the file holds still (no starvation)", async () => {
    await installed();
    file = { n: 5, data: rows(4), held: true }; // the 5th row is half-written
    await tick();
    await tick();
    expect(live().data.time).toHaveLength(4);
    expect(vi.mocked(importLive).mock.lastCall).toEqual([PATH, true]);
    file = { n: 5 }; // nothing changes on disk; the server would now return all of it unheld
    for (let i = 3; i < STABLE_PARTIAL_POLLS; i++) await tick();
    expect(live().data.time).toHaveLength(4); // a pause mid-line is held for a good while...
    await tick(); // ...but not forever
    expect(vi.mocked(importLive).mock.lastCall).toEqual([PATH, false]);
    expect(live().data.time).toHaveLength(5);
    expect(app().history).toHaveLength(0);
  });

  it("a row read after a long pause mid-line, then completed by the writer, is corrected quietly", async () => {
    await installed();
    const half = rows(5);
    half.values[4] = [4, 0.4]; // "40" flushed as "4"
    file = { n: 5, data: rows(4), held: true };
    await tick();
    await tick();
    file = { n: 5, data: half };
    for (let i = 3; i <= STABLE_PARTIAL_POLLS; i++) await tick();
    expect(live().data.values[4]).toEqual([4, 0.4]);
    file = { n: 6 }; // the writer finishes the row and adds one
    await settle();
    expect(live().data.values[4]).toEqual([40, 4]);
    expect(app().history).toHaveLength(0); // quiet: an append, not a reshape
    expect(live().excludedRows).toEqual([1]);
  });
});
