// Project trash (MAIN_PLAN #32; extended to every deletable object type by
// PRIMARY_SOFTWARE_AUDIT_PLAN P3.7). Trash is NOT undo: undo is a
// session-scoped edit history, trash answers "I deleted that and only noticed
// later". The eviction rules are pure so the policy is testable without a
// store.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Review finding on #292: a purge can land while a non-dataset restore is
// still awaiting its dynamically imported chunk. This gate lets a test HOLD
// that import boundary deterministically: `arm()` before the restore, purge
// while it is held, `release()`, then observe the outcome. Hoisted so the
// `vi.mock` factory below can see it; the factory is a pass-through to the
// real module whenever the gate is not armed.
const restoreGate = vi.hoisted(() => {
  let release: () => void = () => {};
  let held: Promise<void> | null = null;
  return {
    arm(): void {
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release(): void {
      release();
      held = null;
    },
    get held(): Promise<void> | null {
      return held;
    },
  };
});
vi.mock("./trashRestoreOther", async (importOriginal) => {
  if (restoreGate.held) await restoreGate.held;
  return importOriginal();
});

import { createFigureDocument } from "../lib/figureDocument";
import type { FigureDoc } from "../lib/figuredoc";
import { createPageDocument } from "../lib/pageDocumentActions";
import { defaultPlotView } from "../lib/plotview";
import type { ReportEntry } from "../lib/report";
import type { Dataset } from "../lib/types";
import {
  byteSize,
  datasetByteEstimate,
  evictTrash,
  trashEntryId,
  TRASH_MAX_AGE_MS,
  TRASH_MAX_ENTRIES,
  type DatasetTrashEntry,
  type TrashEntry,
} from "./trash";
import { useApp } from "./useApp";

const ds = (id: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
});

const dsEntry = (id: string, at: number, bytes = 10): DatasetTrashEntry => ({
  kind: "dataset",
  at,
  bytes,
  dataset: ds(id),
});

describe("evictTrash", () => {
  it("keeps everything inside every cap", () => {
    expect(evictTrash([dsEntry("a", 100), dsEntry("b", 90)], 100)).toHaveLength(2);
  });

  it("drops entries past the age limit", () => {
    const now = TRASH_MAX_AGE_MS * 2;
    const kept = evictTrash([dsEntry("old", 0), dsEntry("new", now)], now);
    expect(kept.map((e) => (e as DatasetTrashEntry).dataset.id)).toEqual(["new"]);
  });

  it("keeps the newest N when the count cap bites", () => {
    const many = Array.from({ length: TRASH_MAX_ENTRIES + 5 }, (_, i) => dsEntry(`d${i}`, i));
    const kept = evictTrash(many, TRASH_MAX_ENTRIES + 5);
    expect(kept).toHaveLength(TRASH_MAX_ENTRIES);
    expect((kept[0] as DatasetTrashEntry).dataset.id).toBe(`d${TRASH_MAX_ENTRIES + 4}`); // newest first
  });

  it("returns newest-first regardless of input order", () => {
    const kept = evictTrash([dsEntry("a", 1), dsEntry("c", 3), dsEntry("b", 2)], 3);
    expect(kept.map((e) => (e as DatasetTrashEntry).dataset.id)).toEqual(["c", "b", "a"]);
  });

  it("is empty for empty input", () => {
    expect(evictTrash([], 0)).toEqual([]);
  });

  it("caps total bytes, dropping the oldest first to fit", () => {
    const entries = [dsEntry("a", 1, 50), dsEntry("b", 2, 50), dsEntry("c", 3, 50)];
    // newest-first: c(50) fits, +b(50)=100 fits exactly, +a would be 150 > 100
    const kept = evictTrash(entries, 3, TRASH_MAX_ENTRIES, TRASH_MAX_AGE_MS, 100);
    expect(kept.map((e) => (e as DatasetTrashEntry).dataset.id)).toEqual(["c", "b"]);
  });

  it("ALWAYS keeps the newest entry even when it alone exceeds the byte cap", () => {
    const entries = [dsEntry("a", 1, 50), dsEntry("b", 2, 50), dsEntry("c", 3, 500)];
    const kept = evictTrash(entries, 3, TRASH_MAX_ENTRIES, TRASH_MAX_AGE_MS, 100);
    expect(kept.map((e) => (e as DatasetTrashEntry).dataset.id)).toEqual(["c"]);
  });
});

describe("byteSize / trashEntryId", () => {
  it("byteSize is a plain JSON.stringify(...).length", () => {
    expect(byteSize({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length);
  });

  it("trashEntryId is `${kind}:${objectId}`, stable across every kind", () => {
    expect(trashEntryId(dsEntry("a", 0))).toBe("dataset:a");
    expect(
      trashEntryId({
        kind: "folder",
        at: 0,
        bytes: 0,
        folders: [{ id: "f1", name: "F", parentId: null, order: 0 }],
        datasets: [],
        workbooks: [],
        childFolders: [],
      }),
    ).toBe("folder:f1");
  });
});

describe("trash slice — dataset (unchanged behaviour, P3.7 return-envelope update)", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [ds("a"), ds("b")], activeId: "a", selectedIds: [], trash: [] });
  });

  it("captures a removed dataset instead of dropping it", () => {
    useApp.getState().removeDataset("a");
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["b"]);
    expect((useApp.getState().trash as DatasetTrashEntry[]).map((e) => e.dataset.id)).toEqual(["a"]);
  });

  it("captures a bulk removal", () => {
    useApp.getState().removeDatasets(["a", "b"]);
    expect(useApp.getState().datasets).toHaveLength(0);
    expect((useApp.getState().trash as DatasetTrashEntry[]).map((e) => e.dataset.id).sort()).toEqual(["a", "b"]);
  });

  it("captures a Delete-key removal, which delegates to removeDatasets", () => {
    useApp.setState({ selectedIds: ["b"] });
    useApp.getState().removeSelected();
    expect((useApp.getState().trash as DatasetTrashEntry[]).map((e) => e.dataset.id)).toEqual(["b"]);
  });

  it("restores a dataset back into the library", async () => {
    useApp.getState().removeDataset("a");
    await expect(useApp.getState().restoreFromTrash("dataset:a")).resolves.toEqual({ ok: true });
    expect(useApp.getState().datasets.map((d) => d.id).sort()).toEqual(["a", "b"]);
    expect(useApp.getState().trash).toHaveLength(0);
  });

  it("reports ok:false when restoring something not in the trash", async () => {
    await expect(useApp.getState().restoreFromTrash("dataset:nope")).resolves.toEqual({
      ok: false,
      reason: "that entry is no longer in the trash",
    });
  });

  it("never creates a duplicate if the id came back some other way", async () => {
    // e.g. an undo, or a re-import, while the entry sat in the trash.
    useApp.getState().removeDataset("a");
    useApp.setState({ datasets: [...useApp.getState().datasets, ds("a")] });
    await useApp.getState().restoreFromTrash("dataset:a");
    expect(useApp.getState().datasets.filter((d) => d.id === "a")).toHaveLength(1);
  });

  it("purges one entry, and purges all when given no id", () => {
    useApp.getState().removeDatasets(["a", "b"]);
    useApp.getState().purgeTrash("dataset:a");
    expect((useApp.getState().trash as DatasetTrashEntry[]).map((e) => e.dataset.id)).toEqual(["b"]);
    useApp.getState().purgeTrash();
    expect(useApp.getState().trash).toEqual([]);
  });

  it("leaves the trash alone when nothing was removed", () => {
    useApp.getState().removeDatasets([]);
    expect(useApp.getState().trash).toEqual([]);
  });

  it("stores bytes computed once at trash time — a dimension ESTIMATE for datasets, never a full stringify", () => {
    useApp.getState().removeDataset("a");
    const entry = useApp.getState().trash[0] as DatasetTrashEntry;
    expect(entry.bytes).toBe(datasetByteEstimate(ds("a")));
    // The estimate is dimension-based (cells × ~14 chars + label text), so it
    // must NOT equal the exact serialization — the exact figure is what costs
    // ~1.2 s on a 1M-row dataset (measured; see datasetByteEstimate's doc).
    expect(entry.bytes).not.toBe(byteSize(ds("a")));
    expect(datasetByteEstimate(ds("a"))).toBeGreaterThan(0);
  });

  it("undo after a restore never removes the restored object again (restore is not an undo step)", async () => {
    // `trash` is not in the history snapshot, so if restore recorded history,
    // Ctrl+Z after it would remove the dataset AGAIN with its trash entry
    // already consumed — the one sequence that makes the trash lose data.
    useApp.getState().removeDataset("a");
    const historyAfterDelete = useApp.getState().history.length;
    await useApp.getState().restoreFromTrash("dataset:a");
    expect(useApp.getState().history).toHaveLength(historyAfterDelete); // no new step
    useApp.getState().undo();
    expect(useApp.getState().datasets.map((d) => d.id).sort()).toEqual(["a", "b"]);
  });
});

describe("restoreFromTrash — workbook self-heal (P1 fix: dangling workbookId)", () => {
  const wbDs = (id: string, workbookId: string): Dataset => ({ ...ds(id), workbookId });

  beforeEach(() => {
    useApp.setState({
      datasets: [], activeId: null, selectedIds: [], trash: [], folders: [], workbooks: [],
      expandedWorkbookIds: [],
    });
  });

  it("restoring a dataset whose workbook no longer exists re-derives a fresh LIVE workbook (no dangling id)", async () => {
    useApp.setState({
      datasets: [wbDs("a", "wb1")],
      workbooks: [{ id: "wb1", name: "Book" }],
    });
    useApp.getState().removeDataset("a"); // to Trash
    useApp.setState({ workbooks: [] }); // the workbook id "a" names is gone
    expect(useApp.getState().workbooks).toHaveLength(0);

    await expect(useApp.getState().restoreFromTrash("dataset:a")).resolves.toEqual({ ok: true });
    const restored = useApp.getState().datasets.find((d) => d.id === "a")!;
    expect(restored.workbookId).toBeTruthy();
    expect(restored.workbookId).not.toBe("wb1"); // the deleted id never comes back
    const live = useApp.getState().workbooks.find((w) => w.id === restored.workbookId);
    expect(live).toBeDefined(); // no dangling reference
    expect(useApp.getState().expandedWorkbookIds).toContain(restored.workbookId);
  });

  it("restoring a dataset trashed alone (its workbook still exists) keeps its original membership, no new workbook", async () => {
    useApp.setState({
      datasets: [wbDs("a", "wb1"), wbDs("b", "wb1")],
      workbooks: [{ id: "wb1", name: "Book" }],
    });
    useApp.getState().removeDataset("a"); // plain delete — the workbook is untouched
    expect(useApp.getState().workbooks).toHaveLength(1);

    await expect(useApp.getState().restoreFromTrash("dataset:a")).resolves.toEqual({ ok: true });
    const restored = useApp.getState().datasets.find((d) => d.id === "a")!;
    expect(restored.workbookId).toBe("wb1"); // membership preserved
    expect(useApp.getState().workbooks).toHaveLength(1); // no new workbook created
  });
});

// ── editableFigure / figureDoc: capture + dependency-aware restore ─────────

const editableDoc = (id: string, datasetId: string | null) =>
  createFigureDocument({ id, name: `Fig ${id}`, datasetId, view: defaultPlotView() });

const legacyDoc = (id: string, datasetId: string | null): FigureDoc => ({
  id,
  name: `Legacy ${id}`,
  datasetId,
  live: true,
  config: {
    xKey: null, yKeys: [0], xScale: "linear", yScale: "linear",
    title: "T", xLabel: "X", yLabel: "Y",
    style: "default", fmt: "pdf", dpi: 300, overrides: null, seriesStyles: null,
  },
});

describe("deleteEditableFigure — captures into trash", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [ds("d1")], editableFigures: [editableDoc("f1", "d1")], trash: [], history: [], future: [],
    });
  });

  it("moves the deleted document into trash and out of the library", () => {
    useApp.getState().deleteEditableFigure("f1");
    expect(useApp.getState().editableFigures).toHaveLength(0);
    expect(trashEntryId(useApp.getState().trash[0])).toBe("editableFigure:f1");
  });
});

describe("removeFigureDoc — captures into trash (records no undo entry)", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [ds("d1")], figureDocs: [legacyDoc("g1", "d1")], trash: [], history: [], future: [] });
  });

  it("moves the deleted doc into trash and out of the library, without touching undo history", () => {
    useApp.getState().removeFigureDoc("g1");
    expect(useApp.getState().figureDocs).toHaveLength(0);
    expect(trashEntryId(useApp.getState().trash[0])).toBe("figureDoc:g1");
    expect(useApp.getState().history).toHaveLength(0);
  });
});

describe("restoreFromTrash — editableFigure dependency rule (both branches)", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [ds("d1")], editableFigures: [editableDoc("f1", "d1")], trash: [], history: [], future: [],
    });
  });

  it("branch A — bound dataset ALSO in trash: restores it too, in the same call, and says so", async () => {
    // Order matters: delete the FIGURE first, while "d1" is still live, so
    // the captured document keeps its intact binding — deleting the dataset
    // afterwards only prunes LIVE editableFigures (removeDatasetsPatch's
    // pruneEditableFigureRefs), and "f1" is no longer among them by then.
    useApp.getState().deleteEditableFigure("f1"); // to trash, binding intact
    useApp.getState().removeDataset("d1"); // to trash
    expect(useApp.getState().datasets).toHaveLength(0);
    expect(useApp.getState().editableFigures).toHaveLength(0);

    const result = await useApp.getState().restoreFromTrash("editableFigure:f1");
    expect(result).toEqual({ ok: true, note: 'restored with its dataset "d1.dat"' });
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["d1"]);
    const restored = useApp.getState().editableFigures.find((f) => f.id === "f1")!;
    expect(restored.bindings.datasetId).toBe("d1");
    // the dataset's own trash entry was consumed too — not left behind
    expect(useApp.getState().trash).toHaveLength(0);
  });

  it("branch B — bound dataset gone entirely: restores the document with the binding nulled, and says so", async () => {
    useApp.getState().deleteEditableFigure("f1"); // to trash
    useApp.setState({ datasets: [] }); // "d1" is gone for good, not merely trashed

    const result = await useApp.getState().restoreFromTrash("editableFigure:f1");
    expect(result).toEqual({
      ok: true,
      note: "restored; its dataset is gone, so it renders frozen/disabled until relinked",
    });
    const restored = useApp.getState().editableFigures.find((f) => f.id === "f1")!;
    expect(restored.bindings.datasetId).toBeNull();
  });

  it("a frozen document's own snapshot means no dependency note at all", async () => {
    const frozen = createFigureDocument({
      id: "fz1", name: "Frozen", datasetId: "d1", view: defaultPlotView(),
      data: { mode: "frozen", snapshot: ds("d1").data },
    });
    useApp.setState({ editableFigures: [frozen] });
    useApp.getState().deleteEditableFigure("fz1");
    useApp.setState({ datasets: [] }); // dataset gone — irrelevant to a frozen doc
    await expect(useApp.getState().restoreFromTrash("editableFigure:fz1")).resolves.toEqual({ ok: true });
  });

  it("guards against a duplicate id that came back some other way", async () => {
    useApp.getState().deleteEditableFigure("f1");
    useApp.setState({ editableFigures: [editableDoc("f1", "d1")] }); // re-created while trashed
    await useApp.getState().restoreFromTrash("editableFigure:f1");
    expect(useApp.getState().editableFigures.filter((f) => f.id === "f1")).toHaveLength(1);
  });
});

describe("restoreFromTrash — legacy figureDoc dependency rule", () => {
  it("branch A — bound dataset also in trash restores it too", async () => {
    useApp.setState({
      datasets: [ds("d1")], figureDocs: [legacyDoc("g1", "d1")], trash: [], history: [], future: [],
    });
    // Same ordering requirement as the editableFigure case above.
    useApp.getState().removeFigureDoc("g1");
    useApp.getState().removeDataset("d1");

    const result = await useApp.getState().restoreFromTrash("figureDoc:g1");
    expect(result).toEqual({ ok: true, note: 'restored with its dataset "d1.dat"' });
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["d1"]);
    expect(useApp.getState().figureDocs.find((f) => f.id === "g1")!.datasetId).toBe("d1");
  });
});

// ── page: restore as-is; a missing panel is the existing F3 semantics ──────

describe("restoreFromTrash — a purge that lands mid-restore wins (review finding on #292)", () => {
  it("re-validates the entry inside the final transaction: a purged entry is never resurrected", async () => {
    useApp.setState({
      datasets: [ds("d1")], editableFigures: [editableDoc("f1", "d1")], trash: [], history: [], future: [],
    });
    useApp.getState().deleteEditableFigure("f1");
    expect(trashEntryId(useApp.getState().trash[0])).toBe("editableFigure:f1");

    // Force the NEXT dynamic import of the restore chunk to re-evaluate the
    // (gated) mock factory, then hold it open.
    vi.resetModules();
    restoreGate.arm();
    const pending = useApp.getState().restoreFromTrash("editableFigure:f1");
    // The "Sure?" click lands while the chunk is still loading.
    useApp.getState().purgeTrash("editableFigure:f1");
    expect(useApp.getState().trash).toHaveLength(0);
    restoreGate.release();

    await expect(pending).resolves.toEqual({ ok: false, reason: "that entry is no longer in the trash" });
    expect(useApp.getState().editableFigures).toHaveLength(0); // permanent stayed permanent
    expect(useApp.getState().trash).toHaveLength(0);
  });
});

describe("restoreFromTrash — page", () => {
  const pg = () => createPageDocument({
    id: "page-1", name: "Results", rows: 1, cols: 1,
    panels: [{ figureId: "gone-figure", label: null, title: null }],
  });

  it("captures a deleted page and restores it as-is", async () => {
    useApp.setState({ pages: [pg()], trash: [], history: [], future: [] });
    useApp.getState().deletePageDocument("page-1");
    expect(useApp.getState().pages).toHaveLength(0);
    expect(trashEntryId(useApp.getState().trash[0])).toBe("page:page-1");

    const result = await useApp.getState().restoreFromTrash("page:page-1");
    expect(result).toEqual({ ok: true });
    expect(useApp.getState().pages.map((p) => p.id)).toEqual(["page-1"]);
    // The referenced figure was never live — resolvePagePanel's own
    // {status:"missing"} fail-closed semantics apply, unchanged: nothing
    // extra to assert at the store level.
  });
});

// ── report: restore as-is ───────────────────────────────────────────────

describe("restoreFromTrash — report", () => {
  const rep = (): ReportEntry => ({
    id: "rep-1", name: "Report", datasetId: "d1", report: { title: "R", sections: [] },
  });

  it("captures a removed report (no undo entry) and restores it as-is", async () => {
    useApp.setState({ reports: [rep()], openReportId: "rep-1", trash: [], history: [], future: [] });
    useApp.getState().removeReport("rep-1");
    expect(useApp.getState().reports).toHaveLength(0);
    expect(useApp.getState().history).toHaveLength(0);
    expect(trashEntryId(useApp.getState().trash[0])).toBe("report:rep-1");

    await expect(useApp.getState().restoreFromTrash("report:rep-1")).resolves.toEqual({ ok: true });
    expect(useApp.getState().reports.map((r) => r.id)).toEqual(["rep-1"]);
  });
});

// `removeDatasets(ids, {permanent: true})` (explicit, warned Trash bypass) is
// covered by lib/datasetDeletePermanently.test.ts, alongside the Library
// context-action that drives it.

describe("sendEntriesToTrash", () => {
  it("is a no-op for an empty list", () => {
    useApp.setState({ trash: [] });
    useApp.getState().sendEntriesToTrash([]);
    expect(useApp.getState().trash).toEqual([]);
  });

  it("accepts any entry kind and evicts through the same pipeline as sendToTrash", () => {
    useApp.setState({ trash: [] });
    const entry: TrashEntry = { kind: "report", at: 5, bytes: 3, report: { id: "r", name: "R", datasetId: null, report: { title: "T", sections: [] } } };
    useApp.getState().sendEntriesToTrash([entry], 5);
    expect(trashEntryId(useApp.getState().trash[0])).toBe("report:r");
  });
});
