// Characterization tests for the report-sheet and figure-document lifecycle
// (audit P4.1 — "characterization tests first" before a god-module
// decomposition; the SECOND domain out of store/useApp.ts).
//
// These pin the CURRENT, pre-extraction behaviour of every action that writes
// the two library-document collections — `reports`/`openReportId` and
// `figureDocs`/`figureDocSeed` — through the REAL composed store: which fields
// each one writes (and, with a poisoned snapshot, which it does NOT), whether
// it pushes an undo entry (none of them do — pinned deliberately), whether it
// records a macro step, what it sends to the trash, and one edge case each
// (empty store, unknown id, missing dataset, frozen doc, a session already
// open). They are the safety net for moving this cluster out of
// store/useApp.ts into store/reportsFigureDocs.ts — nothing in this file may
// change with that move (it imports only `./useApp`, so nothing has to).
//
// Deliberately NOT a duplicate of store/useApp.test.ts or
// store/figureLifecycle.test.ts: the latter covers the CANONICAL editable
// FigureDocument (`editableFigures`), a different collection with a different
// slice. This file covers the legacy publication-preview `FigureDoc` and the
// report sheets.
//
// Ids: `addReport` and `duplicateFigureDoc` mint from a process-wide sequence
// shared with `nextDatasetId`/`nextFolderId`/`addSmartFolder`, which keeps
// climbing across the whole file, so every assertion checks the PREFIX and
// uniqueness (and, in one spec, that the sequence is SHARED), never a literal
// `rep-1`.

import { beforeEach, describe, expect, it } from "vitest";

import type { FigureConfig, FigureDoc } from "../lib/figuredoc";
import type { ReportSheet } from "../lib/report";
import type { Dataset, DataStruct } from "../lib/types";
import { nextDatasetId, useApp, type AppState } from "./useApp";

const data: DataStruct = {
  time: [1, 2, 3],
  values: [
    [10, 100, 1000],
    [20, 200, 2000],
  ],
  labels: ["a", "b"],
  units: ["", ""],
  metadata: {},
};

const ds = (id: string): Dataset => ({ id, name: id, data });

const cfg = (over: Partial<FigureConfig> = {}): FigureConfig => ({
  xKey: null,
  yKeys: null,
  xScale: "linear",
  yScale: "linear",
  title: "",
  xLabel: "",
  yLabel: "",
  style: "screen",
  fmt: "png",
  dpi: 300,
  overrides: null,
  seriesStyles: null,
  ...over,
});

const fdoc = (id: string, over: Partial<FigureDoc> = {}): FigureDoc => ({
  id,
  name: id,
  datasetId: "d1",
  config: cfg(),
  live: true,
  ...over,
});

const sheet = (title = "fit"): ReportSheet => ({ title, sections: [] });

/** Every field these writers touch (plus the bookkeeping ones), reset to the
 *  store's own initial value so a test never inherits a neighbour's state. */
function resetDocs(): void {
  useApp.setState({
    datasets: [],
    activeId: null,
    worksheetId: null,
    selectedIds: [],
    reports: [],
    openReportId: null,
    figureDocs: [],
    figureDocSeed: null,
    figureBuilderOpen: false,
    figurePublicationSession: null,
    trash: [],
    status: "",
    history: [],
    future: [],
    macroSteps: [],
    macroRecording: false,
    projectDirty: false,
    plotWindows: [],
    focusedWindowId: null,
    stageTab: "plot",
    xKey: null,
    yKeys: null,
    groupKey: null,
    xScale: "linear",
    yScale: "linear",
    plotTitle: "",
    xAxisLabel: "",
    yAxisLabel: "",
  });
}

beforeEach(resetDocs);

const labels = (): string[] => useApp.getState().history.map((h) => h.label);
const macroCodes = (): string[] => useApp.getState().macroSteps.map((s) => s.code);

/** Run `fn` with the macro recorder armed, and return the codes it emitted. */
function withMacro(fn: () => void): string[] {
  useApp.setState({ macroRecording: true, macroSteps: [] });
  fn();
  const codes = macroCodes();
  useApp.setState({ macroRecording: false, macroSteps: [] });
  return codes;
}

/** Poison every field this cluster could plausibly (and wrongly) write with a
 *  NON-default value, so a sabotage that "clears" one back to its own default
 *  produces a visible diff instead of byte-identical state. Returns the
 *  snapshot taken immediately afterwards. */
function poisonedSnapshot(after: Partial<AppState> = {}): Record<string, unknown> {
  useApp.setState({
    status: "sentinel-status",
    openReportId: "rep-sentinel",
    figureDocSeed: fdoc("seed-sentinel"),
    figureBuilderOpen: true,
    stageTab: "worksheet",
    xKey: 7,
    yKeys: [7],
    groupKey: 7,
    xScale: "log",
    yScale: "log",
    plotTitle: "sentinel-title",
    xAxisLabel: "sentinel-x",
    yAxisLabel: "sentinel-y",
  });
  // `after` un-poisons the one or two fields whose WRITE the caller is about to
  // measure (a field poisoned to the value the action would write is invisible
  // in the diff — openFigureDraft's `figureBuilderOpen: true` is the case).
  useApp.setState(after);
  return { ...useApp.getState() } as Record<string, unknown>;
}

/** Top-level store keys whose value identity changed between `before` and now. */
function changedKeys(before: Record<string, unknown>): string[] {
  const after = useApp.getState() as unknown as Record<string, unknown>;
  return Object.keys(after)
    .filter((k) => after[k] !== before[k])
    .sort();
}

// ── Report sheets (#36) ─────────────────────────────────────────────────────

describe("report sheets — addReport", () => {
  it("appends an entry, opens it in the viewer, and reports it in the status bar", () => {
    useApp.getState().addReport("peak table", sheet("Peaks"), "d1");
    const s = useApp.getState();
    expect(s.reports).toHaveLength(1);
    expect(s.reports[0].name).toBe("peak table");
    expect(s.reports[0].datasetId).toBe("d1");
    expect(s.reports[0].report).toEqual({ title: "Peaks", sections: [] });
    expect(s.openReportId).toBe(s.reports[0].id);
    expect(s.status).toBe('report "peak table" created');
  });

  it("mints a fresh `rep-` id per call and keeps existing reports", () => {
    useApp.getState().addReport("a", sheet());
    useApp.getState().addReport("b", sheet());
    const ids = useApp.getState().reports.map((r) => r.id);
    expect(ids).toHaveLength(2);
    ids.forEach((id) => expect(id).toMatch(/^rep-[0-9a-z]+-\d+$/));
    expect(new Set(ids).size).toBe(2);
    expect(useApp.getState().reports.map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("defaults a missing datasetId to null (never undefined)", () => {
    useApp.getState().addReport("loose", sheet());
    expect(useApp.getState().reports[0].datasetId).toBeNull();
    expect("datasetId" in useApp.getState().reports[0]).toBe(true);
  });

  it("an explicit null datasetId stays null", () => {
    useApp.getState().addReport("loose", sheet(), null);
    expect(useApp.getState().reports[0].datasetId).toBeNull();
  });

  it("records NO undo entry and NO macro step (reports are artifacts, not view state)", () => {
    const codes = withMacro(() => useApp.getState().addReport("a", sheet()));
    expect(labels()).toEqual([]);
    expect(codes).toEqual([]);
    expect(useApp.getState().projectDirty).toBe(false);
  });

  it("writes ONLY reports/openReportId/status", () => {
    const before = poisonedSnapshot();
    useApp.getState().addReport("a", sheet());
    expect(changedKeys(before)).toEqual(["openReportId", "reports", "status"]);
  });
});

describe("report sheets — removeReport", () => {
  it("drops exactly the named report and sends it to the trash", () => {
    useApp.getState().addReport("a", sheet("A"), "d1");
    useApp.getState().addReport("b", sheet("B"));
    const [a] = useApp.getState().reports;
    useApp.getState().removeReport(a.id);
    expect(useApp.getState().reports.map((r) => r.name)).toEqual(["b"]);
    const trash = useApp.getState().trash;
    expect(trash).toHaveLength(1);
    expect(trash[0].kind).toBe("report");
  });

  it("closes the viewer when the OPEN report is the one removed", () => {
    useApp.getState().addReport("a", sheet());
    const id = useApp.getState().reports[0].id;
    expect(useApp.getState().openReportId).toBe(id);
    useApp.getState().removeReport(id);
    expect(useApp.getState().openReportId).toBeNull();
  });

  it("leaves the viewer alone when a DIFFERENT report is removed", () => {
    useApp.getState().addReport("a", sheet());
    const a = useApp.getState().reports[0].id;
    useApp.getState().addReport("b", sheet());
    const b = useApp.getState().reports[1].id;
    expect(useApp.getState().openReportId).toBe(b);
    useApp.getState().removeReport(a);
    expect(useApp.getState().openReportId).toBe(b);
  });

  it("an unknown id changes no report and trashes nothing (empty store included)", () => {
    useApp.getState().removeReport("nope");
    expect(useApp.getState().reports).toEqual([]);
    expect(useApp.getState().trash).toEqual([]);
    useApp.getState().addReport("a", sheet());
    useApp.getState().removeReport("nope");
    expect(useApp.getState().reports.map((r) => r.name)).toEqual(["a"]);
    expect(useApp.getState().trash).toEqual([]);
  });

  it("records no undo entry — the trash IS the recovery path", () => {
    useApp.getState().addReport("a", sheet());
    useApp.setState({ history: [], future: [] });
    useApp.getState().removeReport(useApp.getState().reports[0].id);
    expect(labels()).toEqual([]);
  });

  it("writes ONLY reports and trash (the filter re-creates the array either way)", () => {
    useApp.getState().addReport("a", sheet());
    const before = poisonedSnapshot();
    useApp.getState().removeReport(useApp.getState().reports[0].id);
    expect(changedKeys(before)).toEqual(["reports", "trash"]);
  });
});

describe("report sheets — renameReport / setOpenReport", () => {
  it("renameReport renames in place and keeps id, datasetId and sheet", () => {
    useApp.getState().addReport("old", sheet("S"), "d1");
    const { id } = useApp.getState().reports[0];
    useApp.getState().renameReport(id, "new");
    const r = useApp.getState().reports[0];
    expect(r).toEqual({ id, name: "new", datasetId: "d1", report: { title: "S", sections: [] } });
  });

  it("renameReport with an unknown id leaves every entry's contents alone", () => {
    useApp.getState().addReport("a", sheet());
    useApp.getState().renameReport("nope", "x");
    expect(useApp.getState().reports.map((r) => r.name)).toEqual(["a"]);
  });

  it("renameReport writes ONLY reports", () => {
    useApp.getState().addReport("a", sheet());
    const before = poisonedSnapshot();
    useApp.getState().renameReport(useApp.getState().reports[0].id, "b");
    expect(changedKeys(before)).toEqual(["reports"]);
  });

  // F7 (2026-09-17 review): the specs above only ever check the field that
  // moved, never the exact stored string — a future move that normalises the
  // name (e.g. `name.trim()`) would silently drop a user's leading/trailing
  // spaces and every spec here would still pass. Pin the string verbatim.
  it("stores the name EXACTLY as given, with no trim/normalisation", () => {
    useApp.getState().addReport("old", sheet(), "d1");
    const { id } = useApp.getState().reports[0];
    useApp.getState().renameReport(id, "  padded  ");
    expect(useApp.getState().reports[0].name).toBe("  padded  ");
  });

  it("setOpenReport opens and closes the viewer without touching the list", () => {
    useApp.getState().addReport("a", sheet());
    const { id } = useApp.getState().reports[0];
    useApp.getState().setOpenReport(null);
    expect(useApp.getState().openReportId).toBeNull();
    useApp.getState().setOpenReport(id);
    expect(useApp.getState().openReportId).toBe(id);
    expect(useApp.getState().reports).toHaveLength(1);
  });

  it("setOpenReport accepts an id that is not in the list (no validation today)", () => {
    useApp.getState().setOpenReport("rep-ghost");
    expect(useApp.getState().openReportId).toBe("rep-ghost");
  });

  it("setOpenReport writes ONLY openReportId", () => {
    const before = poisonedSnapshot();
    useApp.getState().setOpenReport("rep-x");
    expect(changedKeys(before)).toEqual(["openReportId"]);
  });
});

// ── Figure documents (#12) ──────────────────────────────────────────────────

describe("figure documents — addFigureDoc / renameFigureDoc", () => {
  it("addFigureDoc appends the doc as given and reports it in the status bar", () => {
    const d = fdoc("f1", { name: "my figure" });
    useApp.getState().addFigureDoc(d);
    expect(useApp.getState().figureDocs).toEqual([d]);
    expect(useApp.getState().figureDocs[0]).toBe(d);
    expect(useApp.getState().status).toBe('figure "my figure" saved');
  });

  it("addFigureDoc appends (never replaces) and does not open the builder", () => {
    useApp.getState().addFigureDoc(fdoc("f1"));
    useApp.getState().addFigureDoc(fdoc("f2"));
    expect(useApp.getState().figureDocs.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(useApp.getState().figureBuilderOpen).toBe(false);
    expect(useApp.getState().figureDocSeed).toBeNull();
  });

  it("addFigureDoc writes ONLY figureDocs and status", () => {
    const before = poisonedSnapshot();
    useApp.getState().addFigureDoc(fdoc("f1"));
    expect(changedKeys(before)).toEqual(["figureDocs", "status"]);
  });

  it("addFigureDoc records no undo entry and no macro step", () => {
    const codes = withMacro(() => useApp.getState().addFigureDoc(fdoc("f1")));
    expect(labels()).toEqual([]);
    expect(codes).toEqual([]);
  });

  it("renameFigureDoc renames in place and keeps the config", () => {
    useApp.getState().addFigureDoc(fdoc("f1", { name: "old", config: cfg({ title: "T" }) }));
    useApp.getState().renameFigureDoc("f1", "new");
    const f = useApp.getState().figureDocs[0];
    expect(f.name).toBe("new");
    expect(f.id).toBe("f1");
    expect(f.config.title).toBe("T");
  });

  it("renameFigureDoc with an unknown id leaves every doc's contents alone", () => {
    useApp.getState().addFigureDoc(fdoc("f1", { name: "keep" }));
    useApp.getState().renameFigureDoc("nope", "x");
    expect(useApp.getState().figureDocs.map((f) => f.name)).toEqual(["keep"]);
  });

  it("renameFigureDoc writes ONLY figureDocs (status is untouched)", () => {
    useApp.getState().addFigureDoc(fdoc("f1"));
    const before = poisonedSnapshot();
    useApp.getState().renameFigureDoc("f1", "new");
    expect(changedKeys(before)).toEqual(["figureDocs"]);
  });
});

describe("figure documents — removeFigureDoc", () => {
  it("drops exactly the named doc and sends it to the trash", () => {
    useApp.getState().addFigureDoc(fdoc("f1"));
    useApp.getState().addFigureDoc(fdoc("f2"));
    useApp.getState().removeFigureDoc("f1");
    expect(useApp.getState().figureDocs.map((f) => f.id)).toEqual(["f2"]);
    expect(useApp.getState().trash).toHaveLength(1);
    expect(useApp.getState().trash[0].kind).toBe("figureDoc");
  });

  it("an unknown id drops nothing and trashes nothing (empty store included)", () => {
    useApp.getState().removeFigureDoc("nope");
    expect(useApp.getState().figureDocs).toEqual([]);
    expect(useApp.getState().trash).toEqual([]);
    useApp.getState().addFigureDoc(fdoc("f1"));
    useApp.getState().removeFigureDoc("nope");
    expect(useApp.getState().figureDocs.map((f) => f.id)).toEqual(["f1"]);
    expect(useApp.getState().trash).toEqual([]);
  });

  it("does NOT clear a seed pointing at the removed doc (a live draft survives)", () => {
    const d = fdoc("f1");
    useApp.getState().addFigureDoc(d);
    useApp.setState({ figureDocSeed: d });
    useApp.getState().removeFigureDoc("f1");
    expect(useApp.getState().figureDocSeed).toBe(d);
  });

  it("writes ONLY figureDocs and trash", () => {
    useApp.getState().addFigureDoc(fdoc("f1"));
    const before = poisonedSnapshot();
    useApp.getState().removeFigureDoc("f1");
    expect(changedKeys(before)).toEqual(["figureDocs", "trash"]);
  });
});

describe("figure documents — duplicateFigureDoc", () => {
  it("appends a ` copy` with a fresh `figd-` id, everything else carried over", () => {
    const src = fdoc("f1", { name: "spectrum", datasetId: "d9", live: false, dataSnapshot: data });
    useApp.getState().addFigureDoc(src);
    useApp.getState().duplicateFigureDoc("f1");
    const docs = useApp.getState().figureDocs;
    expect(docs).toHaveLength(2);
    expect(docs[0]).toBe(src);
    expect(docs[1].name).toBe("spectrum copy");
    expect(docs[1].id).toMatch(/^figd-[0-9a-z]+-\d+$/);
    expect(docs[1].id).not.toBe("f1");
    expect(docs[1].datasetId).toBe("d9");
    expect(docs[1].live).toBe(false);
    expect(docs[1].dataSnapshot).toBe(data);
    expect(docs[1].config).toBe(src.config);
  });

  it("duplicating twice mints two distinct ids and stacks ` copy copy`", () => {
    useApp.getState().addFigureDoc(fdoc("f1", { name: "a" }));
    useApp.getState().duplicateFigureDoc("f1");
    const second = useApp.getState().figureDocs[1].id;
    useApp.getState().duplicateFigureDoc(second);
    const docs = useApp.getState().figureDocs;
    expect(docs.map((f) => f.name)).toEqual(["a", "a copy", "a copy copy"]);
    expect(new Set(docs.map((f) => f.id)).size).toBe(3);
  });

  it("an unknown id is a total no-op — not even the array identity moves", () => {
    useApp.getState().addFigureDoc(fdoc("f1"));
    const before = poisonedSnapshot();
    useApp.getState().duplicateFigureDoc("nope");
    expect(changedKeys(before)).toEqual([]);
  });

  it("writes ONLY figureDocs (no status line, unlike addFigureDoc)", () => {
    useApp.getState().addFigureDoc(fdoc("f1"));
    const before = poisonedSnapshot();
    useApp.getState().duplicateFigureDoc("f1");
    expect(changedKeys(before)).toEqual(["figureDocs"]);
  });

  it("records no undo entry and no macro step", () => {
    useApp.getState().addFigureDoc(fdoc("f1"));
    useApp.setState({ history: [], future: [] });
    const codes = withMacro(() => useApp.getState().duplicateFigureDoc("f1"));
    expect(labels()).toEqual([]);
    expect(codes).toEqual([]);
  });
});

describe("the process-wide id sequence", () => {
  it("addReport, duplicateFigureDoc, addSmartFolder and nextDatasetId share ONE counter", () => {
    const tail = (id: string): number => Number(id.slice(id.lastIndexOf("-") + 1));
    useApp.getState().addReport("a", sheet());
    const rep = tail(useApp.getState().reports[0].id);
    const dsId = tail(nextDatasetId());
    useApp.getState().addFigureDoc(fdoc("f1"));
    useApp.getState().duplicateFigureDoc("f1");
    const fig = tail(useApp.getState().figureDocs[1].id);
    useApp.getState().addSmartFolder("sf", "q");
    const smf = tail(useApp.getState().smartFolders.at(-1)?.id ?? "-0");
    expect([dsId, fig, smf]).toEqual([rep + 1, rep + 2, rep + 3]);
  });
});

// ── Opening a figure document ───────────────────────────────────────────────

describe("figure documents — openFigureDraft", () => {
  it("seeds the builder and opens it", () => {
    const d = fdoc("f1", { datasetId: null, live: false, dataSnapshot: data });
    useApp.getState().openFigureDraft(d);
    expect(useApp.getState().figureDocSeed).toBe(d);
    expect(useApp.getState().figureBuilderOpen).toBe(true);
  });

  it("a LIVE doc also activates its dataset first", () => {
    useApp.setState({ datasets: [ds("d1"), ds("d2")], activeId: "d2" });
    useApp.getState().openFigureDraft(fdoc("f1", { datasetId: "d1" }));
    expect(useApp.getState().activeId).toBe("d1");
    expect(useApp.getState().figureDocSeed?.id).toBe("f1");
  });

  it("refuses while a Publication Preview session is open — status set, no seed", () => {
    useApp.setState({
      figurePublicationSession: { id: "sess" } as unknown as ReturnType<typeof useApp.getState>["figurePublicationSession"],
    });
    useApp.getState().openFigureDraft(fdoc("f1", { datasetId: null, live: false, dataSnapshot: data }));
    expect(useApp.getState().figureDocSeed).toBeNull();
    expect(useApp.getState().figureBuilderOpen).toBe(false);
    expect(useApp.getState().status).toBe("finish or cancel the current Publication Preview first");
  });

  it("a LIVE doc whose dataset is gone is not renderable — total no-op", () => {
    const before = poisonedSnapshot();
    useApp.getState().openFigureDraft(fdoc("f1", { datasetId: "ghost" }));
    expect(changedKeys(before)).toEqual([]);
  });

  it("a FROZEN doc with no snapshot is not renderable — total no-op", () => {
    const before = poisonedSnapshot();
    useApp.getState().openFigureDraft(fdoc("f1", { live: false }));
    expect(changedKeys(before)).toEqual([]);
  });

  it("a FROZEN doc with a snapshot opens even with no datasets loaded", () => {
    useApp.getState().openFigureDraft(fdoc("f1", { datasetId: "ghost", live: false, dataSnapshot: data }));
    expect(useApp.getState().figureDocSeed?.id).toBe("f1");
    expect(useApp.getState().figureBuilderOpen).toBe(true);
  });

  it("writes ONLY figureDocSeed and figureBuilderOpen when no activation is needed", () => {
    const before = poisonedSnapshot({ figureBuilderOpen: false });
    useApp.getState().openFigureDraft(fdoc("f1", { datasetId: null, live: false, dataSnapshot: data }));
    expect(changedKeys(before)).toEqual(["figureBuilderOpen", "figureDocSeed"]);
  });
});

describe("figure documents — openFigureDoc", () => {
  it("looks the doc up by id and routes through openFigureDraft", () => {
    const d = fdoc("f1", { datasetId: null, live: false, dataSnapshot: data });
    useApp.getState().addFigureDoc(d);
    useApp.getState().openFigureDoc("f1");
    expect(useApp.getState().figureDocSeed).toBe(d);
    expect(useApp.getState().figureBuilderOpen).toBe(true);
  });

  it("an unknown id is a total no-op (empty store included)", () => {
    const before = poisonedSnapshot();
    useApp.getState().openFigureDoc("nope");
    expect(changedKeys(before)).toEqual([]);
  });

  it("opens the SAVED doc object, not a copy of it", () => {
    const d = fdoc("f1", { datasetId: null, live: false, dataSnapshot: data });
    useApp.getState().addFigureDoc(d);
    useApp.getState().openFigureDoc("f1");
    expect(useApp.getState().figureDocSeed).toBe(useApp.getState().figureDocs[0]);
  });
});

describe("figure documents — openFigureDocInWindow", () => {
  const liveDoc = (over: Partial<FigureConfig> = {}): FigureDoc =>
    fdoc("f1", {
      name: "spectrum",
      datasetId: "d1",
      config: cfg({
        xKey: 0,
        yKeys: [1],
        xScale: "log",
        yScale: "log",
        title: "T",
        xLabel: "X",
        yLabel: "Y",
        ...over,
      }),
    });

  beforeEach(() => {
    useApp.setState({ datasets: [ds("d1")], activeId: "d1" });
  });

  it("creates a focused window titled after the doc and applies its config", () => {
    useApp.getState().addFigureDoc(liveDoc());
    useApp.getState().openFigureDocInWindow("f1");
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(1);
    expect(s.plotWindows[0].title).toBe("spectrum");
    expect(s.focusedWindowId).toBe(s.plotWindows[0].id);
    expect(s.xKey).toBe(0);
    expect(s.yKeys).toEqual([1]);
    expect(s.xScale).toBe("log");
    expect(s.yScale).toBe("log");
    expect(s.plotTitle).toBe("T");
    expect(s.xAxisLabel).toBe("X");
    expect(s.yAxisLabel).toBe("Y");
    expect(s.stageTab).toBe("plot");
  });

  it("carries the doc's groupCol into the live groupKey, and absent means null", () => {
    useApp.getState().addFigureDoc(liveDoc({ groupCol: 1 }));
    useApp.getState().openFigureDocInWindow("f1");
    expect(useApp.getState().groupKey).toBe(1);

    useApp.setState({ groupKey: 5 });
    useApp.getState().addFigureDoc(fdoc("f2", { datasetId: "d1", config: cfg() }));
    useApp.getState().openFigureDocInWindow("f2");
    expect(useApp.getState().groupKey).toBeNull();
  });

  it("dedupes the window title against the titles already on screen", () => {
    useApp.getState().addFigureDoc(liveDoc());
    useApp.getState().openFigureDocInWindow("f1");
    useApp.getState().openFigureDocInWindow("f1");
    expect(useApp.getState().plotWindows.map((w) => w.title)).toEqual(["spectrum", "spectrum (2)"]);
  });

  it("records a macro step naming the doc", () => {
    useApp.getState().addFigureDoc(liveDoc());
    const codes = withMacro(() => useApp.getState().openFigureDocInWindow("f1"));
    expect(codes).toEqual(['qz.openFigureDocInWindow("f1")']);
  });

  it("pushes exactly the window slice's own undo entry (this action adds none)", () => {
    useApp.getState().addFigureDoc(liveDoc());
    useApp.setState({ history: [], future: [] });
    useApp.getState().openFigureDocInWindow("f1");
    expect(labels()).toEqual(["create window"]);
  });

  it("an unknown id, a FROZEN doc and a doc with no datasetId are all no-ops", () => {
    useApp.getState().addFigureDoc(fdoc("frozen", { live: false, dataSnapshot: data }));
    useApp.getState().addFigureDoc(fdoc("loose", { datasetId: null }));
    const before = poisonedSnapshot();
    useApp.getState().openFigureDocInWindow("nope");
    useApp.getState().openFigureDocInWindow("frozen");
    useApp.getState().openFigureDocInWindow("loose");
    expect(changedKeys(before)).toEqual([]);
    expect(useApp.getState().plotWindows).toEqual([]);
  });

  it("a doc whose dataset is no longer loaded is a no-op", () => {
    useApp.getState().addFigureDoc(fdoc("gone", { datasetId: "ghost" }));
    const before = poisonedSnapshot();
    useApp.getState().openFigureDocInWindow("gone");
    expect(changedKeys(before)).toEqual([]);
  });

  // F3 (2026-09-17 review of the second P4.1 extraction): the other 11
  // writers in this file each have a "writes ONLY …" spec diffing the WHOLE
  // poisoned snapshot; this one — the largest, and the only one whose `set`
  // writes 10+ fields — did not, so an extra field carried along by a future
  // move (the review's sabotage: adding `showGrid: false` to the `set`) would
  // pass every other spec here silently. `history`/`future` are included
  // deliberately: `createWindow` pushes its own undo entry as part of this
  // action's effect (see "pushes exactly the window slice's own undo entry"
  // above), so both change identity even though `future` stays logically `[]`.
  it("writes ONLY the window/config fields it (and its createWindow/focusWindow delegates) declare", () => {
    useApp.getState().addFigureDoc(liveDoc());
    // Un-poison xScale/yScale to something OTHER than the doc's own "log":
    // poisonedSnapshot's default poison ("log") is the exact value this doc
    // writes, which would make that write invisible in the diff (the same
    // trap the helper's own docstring names for figureBuilderOpen). Pin
    // `showGrid` to `true` explicitly too — poisonedSnapshot does not poison
    // it, and an earlier spec in this describe block (via a shared, un-reset
    // module-level store) can leave it `false`; a stray `showGrid: false`
    // write must show up as a diff regardless of test execution order.
    const before = poisonedSnapshot({ xScale: "linear", yScale: "linear", showGrid: true });
    useApp.getState().openFigureDocInWindow("f1");
    expect(changedKeys(before).sort()).toEqual(
      [
        "plotWindows",
        "focusedWindowId",
        "history",
        "future",
        "stageTab",
        "xKey",
        "yKeys",
        "groupKey",
        "xScale",
        "yScale",
        "plotTitle",
        "xAxisLabel",
        "yAxisLabel",
        // _focusHandoff's dataset-switch-shaped "focusTransientReset" (windows.ts):
        // focusing a window whose dataset differs from the previously focused
        // window's clears the same transient tool/gadget/overlay state a real
        // dataset switch does.
        "selectedIds",
        "annotations",
        "refLines",
        "shapes",
        "regionShades",
        "hiddenChannels",
        "seriesStyles",
        "seriesLabels",
        "errKeys",
        "axisLabelStyles",
        "axisLabelOffsets",
        "xFmt",
        "yFmt",
      ].sort(),
    );
  });

  it("does NOT restore the doc's series styles (the export shape has no inverse)", () => {
    useApp.getState().addFigureDoc(
      fdoc("f1", {
        datasetId: "d1",
        config: cfg({ seriesStyles: [{ color: "#ff0000" } as unknown as null] }),
      }),
    );
    useApp.getState().openFigureDocInWindow("f1");
    expect(useApp.getState().seriesStyles).toEqual({});
  });
});

describe("figure documents — clearFigureDocSeed", () => {
  it("clears the seed and nothing else", () => {
    const before = poisonedSnapshot();
    useApp.getState().clearFigureDocSeed();
    expect(useApp.getState().figureDocSeed).toBeNull();
    expect(changedKeys(before)).toEqual(["figureDocSeed"]);
  });

  it("is idempotent on an already-empty seed", () => {
    useApp.getState().clearFigureDocSeed();
    const before = { ...useApp.getState() } as Record<string, unknown>;
    useApp.getState().clearFigureDocSeed();
    expect(changedKeys(before)).toEqual([]);
    expect(useApp.getState().figureBuilderOpen).toBe(false);
  });
});
