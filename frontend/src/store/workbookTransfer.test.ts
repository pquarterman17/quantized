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
