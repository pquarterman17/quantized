// Group F store tests — large-workbook Copy/Paste through the guarded
// temporary transfer package, against the real `useApp` store. The backend is
// an in-memory stand-in for the transfer-store routes (their real behaviour —
// atomic write, expiry, eviction, two backends sharing one directory — is
// pinned in tests/test_api_workbook_transfer.py); the two "processes" are the
// same store snapshotted and reset between Copy and Paste, as in
// store/workbookTransfer.test.ts, so only the clipboard TEXT crosses over.

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { buildTransferPackage, MAX_TRANSFER_PACKAGE_CHARS } from "../lib/workbookTransfer";
import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

const BIG_NOTE = "x".repeat(MAX_TRANSFER_PACKAGE_CHARS + 1);
const PACKAGES = "/api/workbook-transfer/packages";

const ds = (id: string, name: string, workbookId: string, note?: string): Dataset => ({
  id,
  name,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: note ? { note } : {} },
  workbookId,
});

function reset(note?: string): void {
  useApp.setState({
    datasets: [ds("d1", "run1.dat", "w1", note)],
    workbooks: [{ id: "w1", name: "run1" }],
    folders: [],
    editableFigures: [],
    figureDocs: [],
    reports: [],
    pages: [],
    quickPlotTemplates: [],
    trash: [],
    history: [],
    future: [],
    status: "",
  });
}

/** The destination "process": a different id universe, reached only through
 *  the clipboard text. */
function becomeDestination(): void {
  reset();
  useApp.setState({ datasets: [ds("dest-1", "existing.dat", "dest-wb")], workbooks: [{ id: "dest-wb", name: "Existing" }] });
}

function mockClipboard(): { contents: { text: string | null }; write: ReturnType<typeof vi.fn> } {
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
  return { contents, write };
}

interface Entry {
  token: string;
  bytes: Uint8Array<ArrayBuffer>;
}

type FetchMock = Mock<(url: string, init?: RequestInit) => Promise<Response>>;

function fakeBackend(): { entries: Map<string, Entry>; fetchMock: FetchMock; offline: { on: boolean } } {
  const entries = new Map<string, Entry>();
  const offline = { on: false };
  let n = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (offline.on) throw new TypeError("Failed to fetch");
    if (url === PACKAGES && init?.method === "POST") {
      const bytes = new Uint8Array(await (init.body as Blob).arrayBuffer());
      const id = (++n).toString(16).padStart(32, "0");
      const token = `${"t".repeat(40)}${String(n).padStart(3, "0")}`; // server shape: 43 chars
      entries.set(id, { token, bytes });
      const body = { id, token, size: bytes.byteLength, expires_at: new Date(Date.now() + 864e5).toISOString(), ttl_seconds: 86400 };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    const id = url.slice(PACKAGES.length + 1);
    const entry = entries.get(id);
    const token = (init?.headers as Record<string, string> | undefined)?.["X-Transfer-Token"];
    if (!entry || entry.token !== token) return new Response("{}", { status: 404 });
    if (init?.method === "DELETE") {
      entries.delete(id);
      return new Response('{"deleted":true}', { status: 200 });
    }
    return new Response(entry.bytes, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { entries, fetchMock, offline };
}

/** Everything a refused paste must leave alone — compared by REFERENCE, so
 *  any `set()` touching these arrays fails the assertion. */
function snapshot() {
  const s = useApp.getState();
  return {
    workbooks: s.workbooks,
    datasets: s.datasets,
    editableFigures: s.editableFigures,
    reports: s.reports,
    quickPlotTemplates: s.quickPlotTemplates,
    history: s.history,
    historyLength: s.history.length,
  };
}

function expectUnchanged(before: ReturnType<typeof snapshot>): void {
  const after = snapshot();
  expect(after.workbooks).toBe(before.workbooks);
  expect(after.datasets).toBe(before.datasets);
  expect(after.editableFigures).toBe(before.editableFigures);
  expect(after.reports).toBe(before.reports);
  expect(after.quickPlotTemplates).toBe(before.quickPlotTemplates);
  expect(after.historyLength).toBe(before.historyLength);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Group F — small workbooks keep PR I's inline transport byte-for-byte", () => {
  beforeEach(() => reset());

  it("copies the inline package itself, and never touches the transfer store", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
    const { fetchMock } = fakeBackend();
    const { contents } = mockClipboard();
    const expected = buildTransferPackage("w1", useApp.getState());
    await useApp.getState().copyWorkbookToClipboard("w1");
    expect(expected.ok && contents.text === expected.text).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe('copied "run1" (1 worksheet)');
  });
});

describe("Group F — large workbooks travel as a descriptor + temporary package", () => {
  beforeEach(() => reset(BIG_NOTE));

  it("copies a SMALL versioned descriptor, not the payload", async () => {
    const { entries } = fakeBackend();
    const { contents } = mockClipboard();
    await useApp.getState().copyWorkbookToClipboard("w1");
    const text = contents.text ?? "";
    expect(text.length).toBeLessThan(1000);
    const ref = JSON.parse(text);
    expect(ref).toMatchObject({ format: "quantized-workbook-transfer-ref", version: 1, token: `${"t".repeat(40)}001` });
    expect(ref.summary).toMatch(/^Quantized workbook "run1" \(1 worksheet, 8\.0 MB\)/);
    expect(entries.get(ref.id)?.bytes.byteLength).toBe(ref.size);
    expect(useApp.getState().status).toMatch(/^copied "run1" \(1 worksheet\) via a temporary transfer package/);
  });

  it("pastes the descriptor into a separate destination: full payload, fresh ids, one undo step", async () => {
    fakeBackend();
    const { contents } = mockClipboard();
    await useApp.getState().copyWorkbookToClipboard("w1");
    becomeDestination();
    const before = snapshot();
    expect(await useApp.getState().canPasteWorkbook()).toBe(true);
    await useApp.getState().pasteWorkbookFromClipboard();
    const after = useApp.getState();
    const pasted = after.workbooks.find((w) => w.id !== "dest-wb");
    expect(pasted?.name).toBe("run1");
    expect(pasted?.id).not.toBe("w1");
    const sheet = after.datasets.find((d) => d.workbookId === pasted?.id);
    expect(sheet?.id).not.toBe("d1");
    expect(sheet?.data.metadata.note).toBe(BIG_NOTE);
    expect(after.history.length).toBe(before.historyLength + 1);
    useApp.getState().undo();
    expect(useApp.getState().workbooks).toHaveLength(1);
    expect(contents.text?.length).toBeLessThan(1000);
  });

  it("refuses when the source's transfer store is offline, and leaves the clipboard alone", async () => {
    const { offline } = fakeBackend();
    offline.on = true;
    const { contents, write } = mockClipboard();
    await useApp.getState().copyWorkbookToClipboard("w1");
    expect(write).not.toHaveBeenCalled();
    expect(contents.text).toBeNull();
    expect(useApp.getState().status).toMatch(
      /^copy "run1" unavailable: workbook is 8\.0 MB, over the 8\.0 MB clipboard limit, and the temporary transfer store is unavailable \(Failed to fetch\)$/,
    );
  });

  it("drops the stored package when the descriptor never reaches the clipboard", async () => {
    const { entries } = fakeBackend();
    const { write } = mockClipboard();
    write.mockRejectedValue(new Error("denied"));
    await useApp.getState().copyWorkbookToClipboard("w1");
    expect(useApp.getState().status).toBe('copy "run1" failed: clipboard unavailable');
    // wait on STATE (the backend's entries), not on a mock call
    await vi.waitFor(() => expect(entries.size).toBe(0));
  });

  it("a MISSING package leaves the destination unchanged and says why", async () => {
    const { entries } = fakeBackend();
    mockClipboard();
    await useApp.getState().copyWorkbookToClipboard("w1");
    entries.clear(); // evicted / cleaned up by the source's backend
    becomeDestination();
    const before = snapshot();
    await useApp.getState().pasteWorkbookFromClipboard();
    expectUnchanged(before);
    expect(useApp.getState().status).toMatch(/^paste workbook: .*not available here \(removed, evicted, or copied on another computer or user account\) — copy the workbook again/);
  });

  it("an EXPIRED package leaves the destination unchanged and says it expired", async () => {
    const { fetchMock } = fakeBackend();
    mockClipboard();
    await useApp.getState().copyWorkbookToClipboard("w1");
    fetchMock.mockImplementation(async () => new Response('{"detail":"transfer package expired"}', { status: 410 }));
    becomeDestination();
    const before = snapshot();
    await useApp.getState().pasteWorkbookFromClipboard();
    expectUnchanged(before);
    expect(useApp.getState().status).toMatch(/^paste workbook: .*temporary transfer package expired/);
  });

  it("an INCOMPATIBLE package version leaves the destination unchanged and names the version", async () => {
    const { entries } = fakeBackend();
    const { contents } = mockClipboard();
    await useApp.getState().copyWorkbookToClipboard("w1");
    const ref = JSON.parse(contents.text ?? "");
    const entry = entries.get(ref.id);
    const future = JSON.parse(new TextDecoder().decode(entry?.bytes));
    future.version = 99;
    const bytes = new TextEncoder().encode(JSON.stringify(future));
    entries.set(ref.id, { token: ref.token, bytes });
    contents.text = JSON.stringify({ ...ref, size: bytes.byteLength });
    becomeDestination();
    const before = snapshot();
    await useApp.getState().pasteWorkbookFromClipboard();
    expectUnchanged(before);
    expect(useApp.getState().status).toBe(
      "paste workbook: temporary transfer package: unsupported workbook transfer version: 99",
    );
  });

  it("Duplicate handles a workbook above the inline bound (it never touches the clipboard)", async () => {
    const { fetchMock } = fakeBackend();
    const id = await useApp.getState().duplicateWorkbook("w1");
    expect(id).not.toBeNull();
    const after = useApp.getState();
    expect(after.workbooks.find((w) => w.id === id)?.name).toBe("run1 copy");
    expect(after.datasets.find((d) => d.workbookId === id)?.data.metadata.note).toBe(BIG_NOTE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still refuses an INLINE clipboard package above the inline bound", async () => {
    fakeBackend();
    const { contents } = mockClipboard();
    const built = buildTransferPackage("w1", useApp.getState());
    contents.text = built.ok ? built.text : "";
    becomeDestination();
    const before = snapshot();
    await useApp.getState().pasteWorkbookFromClipboard();
    expectUnchanged(before);
    expect(useApp.getState().status).toMatch(/^paste workbook: transfer package too large \(8\.0 MB, limit 8\.0 MB\)$/);
  });

  it("a crafted descriptor token is refused as not-a-descriptor, never fetched", async () => {
    const { fetchMock } = fakeBackend();
    const { contents } = mockClipboard();
    await useApp.getState().copyWorkbookToClipboard("w1");
    const ref = JSON.parse(contents.text ?? "");
    contents.text = JSON.stringify({ ...ref, token: `${"a".repeat(21)}\n${"a".repeat(21)}` });
    becomeDestination();
    fetchMock.mockClear();
    const before = snapshot();
    await useApp.getState().pasteWorkbookFromClipboard();
    expectUnchanged(before);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe(
      "paste workbook: clipboard text is not a valid Quantized transfer descriptor",
    );
  });

  it("an offline destination leaves its project unchanged and names the store", async () => {
    const { offline } = fakeBackend();
    mockClipboard();
    await useApp.getState().copyWorkbookToClipboard("w1");
    becomeDestination();
    offline.on = true;
    const before = snapshot();
    await useApp.getState().pasteWorkbookFromClipboard();
    expectUnchanged(before);
    expect(useApp.getState().status).toMatch(/transfer store is unavailable \(Failed to fetch\)/);
  });

  it("canPasteWorkbook recognises a live descriptor and rejects an expired one without fetching", async () => {
    const { fetchMock } = fakeBackend();
    const { contents } = mockClipboard();
    await useApp.getState().copyWorkbookToClipboard("w1");
    fetchMock.mockClear();
    expect(await useApp.getState().canPasteWorkbook()).toBe(true);
    contents.text = JSON.stringify({ ...JSON.parse(contents.text ?? ""), expiresAt: "2000-01-01T00:00:00Z" });
    expect(await useApp.getState().canPasteWorkbook()).toBe(false);
    contents.text = JSON.stringify({ ...JSON.parse(contents.text ?? ""), version: 2 });
    expect(await useApp.getState().canPasteWorkbook()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
