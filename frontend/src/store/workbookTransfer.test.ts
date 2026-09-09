// Red-first store tests for PR I (LIBRARY_WORKBOOK_UX_PLAN L0.23/L0.24) —
// cross-instance workbook transfer, against the real `useApp` store
// (undo/history included). Clipboard is mocked (jsdom has none by default);
// two independent `useApp` "processes" are simulated by snapshotting and
// restoring the store's raw state between the copy and paste halves of a
// round trip — the whole point of a serialized-text package (frozen-scope
// item 2) is that it never depends on a shared in-memory object graph, so a
// same-process round trip through a plain string is a faithful test of the
// cross-process contract.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../lib/types";
import type { WorkbookNode } from "../lib/workbooks";
import { useApp, type AppState } from "./useApp";
import { useToasts } from "./toasts";

const wb = (id: string, name: string, extra: Partial<WorkbookNode> = {}): WorkbookNode => ({ id, name, ...extra });
const ds = (id: string, name: string, workbookId: string | undefined, extra: Partial<Dataset> = {}): Dataset => ({
  id,
  name,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
  workbookId,
  ...extra,
});

function resetState(): void {
  useApp.setState({
    datasets: [ds("d1", "run1.dat", "w1", { source: { kind: "path", path: "/x/run1.dat" } })],
    workbooks: [wb("w1", "run1")],
    folders: [],
    originFigures: [],
    editableFigures: [],
    figureDocs: [],
    reports: [],
    pages: [],
    quickPlotTemplates: [],
    activeId: null,
    selectedIds: [],
    trash: [],
    history: [],
    future: [],
    status: "",
  });
}

function mockClipboard(): { write: ReturnType<typeof vi.fn>; contents: { text: string | null } } {
  const contents = { text: null as string | null };
  const write = vi.fn(async (text: string) => {
    contents.text = text;
  });
  Object.assign(navigator, {
    clipboard: {
      writeText: write,
      readText: async () => {
        if (contents.text === null) throw new Error("clipboard empty");
        return contents.text;
      },
    },
  });
  return { write, contents };
}

describe("workbookTransfer slice — copy/paste round trip", () => {
  beforeEach(resetState);

  it("copies a workbook to the clipboard as parseable text carrying the format envelope", async () => {
    const { contents } = mockClipboard();
    await useApp.getState().copyWorkbookToClipboard("w1");
    expect(contents.text).not.toBeNull();
    const parsed = JSON.parse(contents.text!);
    expect(parsed.format).toBe("quantized-workbook-transfer");
    expect(parsed.datasets).toHaveLength(1);
  });

  it("reports a clear reason and copies nothing when the workbook is empty", async () => {
    useApp.setState({ workbooks: [wb("w-empty", "Empty")], datasets: [] });
    const { contents, write } = mockClipboard();
    await useApp.getState().copyWorkbookToClipboard("w-empty");
    expect(write).not.toHaveBeenCalled();
    expect(contents.text).toBeNull();
    expect(useApp.getState().status).toMatch(/unavailable/);
  });

  it("round-trips into a SEPARATE 'destination' with zero id collision and one undo entry", async () => {
    const { contents } = mockClipboard();
    await useApp.getState().copyWorkbookToClipboard("w1");
    const sourceText = contents.text!;

    // Simulate a second, independently-running instance/project: a
    // completely different dataset/workbook id universe, reached only
    // through the clipboard text above — never through shared JS state.
    resetState();
    useApp.setState({
      datasets: [ds("dest-1", "existing.dat", "dest-wb")],
      workbooks: [wb("dest-wb", "Existing")],
      history: [],
      future: [],
    });
    const before = useApp.getState();

    await useApp.getState().pasteWorkbookFromClipboard();
    const after = useApp.getState();

    expect(after.workbooks).toHaveLength(2);
    const pasted = after.workbooks.find((w) => w.id !== "dest-wb")!;
    expect(pasted).toBeDefined();
    expect(pasted.id).not.toBe("w1"); // fresh id, never the source's
    expect(pasted.name).toBe("run1");

    const pastedDataset = after.datasets.find((d) => d.workbookId === pasted.id)!;
    expect(pastedDataset).toBeDefined();
    expect(pastedDataset.id).not.toBe("d1");
    expect(pastedDataset.source).toEqual({ kind: "path", path: "/x/run1.dat" }); // provenance preserved

    // Destination's pre-existing content is untouched.
    expect(after.datasets.some((d) => d.id === "dest-1")).toBe(true);
    expect(after.workbooks.some((w) => w.id === "dest-wb")).toBe(true);

    // One undo entry restores the pre-paste destination exactly.
    expect(after.history.length).toBe(before.history.length + 1);
    useApp.getState().undo();
    expect(useApp.getState().workbooks).toHaveLength(1);
    expect(useApp.getState().datasets).toHaveLength(1);
    void sourceText;
  });

  it("leaves the destination COMPLETELY untouched when the clipboard has no compatible package", async () => {
    mockClipboard();
    // clipboard.text stays null -> readText() rejects -> the honest
    // "clipboard unavailable" branch, never a partial mutation.
    const before = useApp.getState();
    await useApp.getState().pasteWorkbookFromClipboard();
    const after = useApp.getState();
    expect(after.workbooks).toEqual(before.workbooks);
    expect(after.datasets).toEqual(before.datasets);
    expect(after.history.length).toBe(before.history.length); // no undo entry created
  });

  it("leaves the destination untouched (including history) when the clipboard carries unrelated JSON text", async () => {
    const { contents } = mockClipboard();
    contents.text = JSON.stringify({ hello: "world" });
    const before = useApp.getState();
    await useApp.getState().pasteWorkbookFromClipboard();
    const after = useApp.getState();
    expect(after.workbooks).toEqual(before.workbooks);
    expect(after.datasets).toEqual(before.datasets);
    expect(after.history.length).toBe(before.history.length); // no undo entry from a refused paste
  });

  it("canPasteWorkbook reflects clipboard compatibility honestly", async () => {
    const { contents } = mockClipboard();
    expect(await useApp.getState().canPasteWorkbook()).toBe(false); // empty clipboard
    contents.text = "just some copied prose, not a workbook";
    expect(await useApp.getState().canPasteWorkbook()).toBe(false);
    await useApp.getState().copyWorkbookToClipboard("w1");
    expect(await useApp.getState().canPasteWorkbook()).toBe(true);
  });
});

describe("workbookTransfer slice — duplicate (same-project fast path)", () => {
  beforeEach(resetState);

  it("duplicates a workbook in place, sharing the fresh-id core with paste", async () => {
    const before = useApp.getState();
    const newId = await useApp.getState().duplicateWorkbook("w1");
    expect(newId).not.toBeNull();
    expect(newId).not.toBe("w1");
    const after = useApp.getState();
    expect(after.workbooks).toHaveLength(2);
    const dup = after.workbooks.find((w) => w.id === newId)!;
    expect(dup.name).toBe("run1 copy");
    const dupDataset = after.datasets.find((d) => d.workbookId === newId)!;
    expect(dupDataset.id).not.toBe("d1");
    expect(dupDataset.source).toEqual({ kind: "path", path: "/x/run1.dat" });
    // Original workbook and worksheet are untouched.
    expect(after.workbooks.some((w) => w.id === "w1")).toBe(true);
    expect(after.datasets.some((d) => d.id === "d1")).toBe(true);
    expect(after.history.length).toBe(before.history.length + 1);
  });

  it("lands the duplicate in the SAME folder as the source workbook", async () => {
    useApp.setState({
      workbooks: [wb("w1", "run1", { folderId: "fld-1" })],
      folders: [{ id: "fld-1", name: "Folder 1", parentId: null, order: 0 }],
    } as Partial<AppState>);
    const newId = await useApp.getState().duplicateWorkbook("w1");
    const dup = useApp.getState().workbooks.find((w) => w.id === newId)!;
    expect(dup.folderId).toBe("fld-1");
  });

  it("refuses (zero mutation) to duplicate an empty workbook", async () => {
    useApp.setState({ workbooks: [wb("w-empty", "Empty")], datasets: [] });
    const before = useApp.getState();
    const result = await useApp.getState().duplicateWorkbook("w-empty");
    expect(result).toBeNull();
    const after = useApp.getState();
    expect(after.workbooks).toEqual(before.workbooks);
    expect(after.history.length).toBe(before.history.length);
  });
});

// UX-002: the drop of a cross-workbook lineage link is correct (a dangling id
// into a project the destination may not have open is exactly what the
// fresh-id rewrite exists to prevent) — the BUG was that
// `droppedExternalRefs` was computed, returned, and read by nothing, so the
// pasted worksheet looked complete. These assert the count reaches the user
// through BOTH surfaces (the persistent status line and the toast) and that a
// clean transfer is not annotated.
describe("workbookTransfer slice — dropped cross-workbook lineage is surfaced (UX-002)", () => {
  beforeEach(() => {
    resetState();
    useToasts.setState({ toasts: [] });
  });

  /** w1/d1 is the OLD version; w2/d2 was imported as a new version of it, so
   *  its `versionOf` crosses a workbook boundary by construction (see
   *  store/relink.ts's "import as new version" + importDatasets.ts's
   *  one-file-one-workbook rule). Copying w2 alone therefore cannot carry it. */
  function twoWorkbooksWithACrossLink(): void {
    useApp.setState({
      workbooks: [wb("w1", "run1"), wb("w2", "run1 v2")],
      datasets: [ds("d1", "run1.dat", "w1"), ds("d2", "run1_v2.dat", "w2", { versionOf: "d1" })],
    } as Partial<AppState>);
  }

  it("names the dropped link count after a paste, and uses info rather than a clean ok", async () => {
    twoWorkbooksWithACrossLink();
    mockClipboard();
    await useApp.getState().copyWorkbookToClipboard("w2");
    await useApp.getState().pasteWorkbookFromClipboard(undefined);

    expect(useApp.getState().status).toContain("1 lineage link not carried");
    const last = useToasts.getState().toasts.at(-1)!;
    expect(last.msg).toContain("1 lineage link not carried");
    expect(last.kind).toBe("info");
    // The paste itself still succeeded — the worksheet is there.
    expect(useApp.getState().datasets.filter((d) => d.name.startsWith("run1_v2")).length).toBe(2);
  });

  it("names the dropped link count after a duplicate too", async () => {
    twoWorkbooksWithACrossLink();
    mockClipboard();
    await useApp.getState().duplicateWorkbook("w2");

    expect(useApp.getState().status).toContain("1 lineage link not carried");
    expect(useToasts.getState().toasts.at(-1)!.kind).toBe("info");
  });

  it("pluralizes honestly — two dropped links say 'links'", async () => {
    useApp.setState({
      workbooks: [wb("w1", "run1"), wb("w2", "derived")],
      datasets: [
        ds("d1", "run1.dat", "w1"),
        ds("d2", "a.dat", "w2", { versionOf: "d1" }),
        ds("d3", "b.dat", "w2", { derivedFrom: { datasetId: "d1", pipeline: "smooth" } }),
      ],
    } as Partial<AppState>);
    mockClipboard();
    await useApp.getState().duplicateWorkbook("w2");
    expect(useApp.getState().status).toContain("2 lineage links not carried");
  });

  it("does NOT annotate a transfer that carried everything — ok stays ok", async () => {
    // d2's versionOf points INSIDE w2, so the fresh-id rewrite resolves it.
    useApp.setState({
      workbooks: [wb("w2", "pair")],
      datasets: [ds("d1", "a.dat", "w2"), ds("d2", "b.dat", "w2", { versionOf: "d1" })],
    } as Partial<AppState>);
    mockClipboard();
    await useApp.getState().duplicateWorkbook("w2");

    expect(useApp.getState().status).not.toContain("lineage");
    const last = useToasts.getState().toasts.at(-1)!;
    expect(last.kind).toBe("ok");
    expect(last.msg).not.toContain("lineage");
  });
});
