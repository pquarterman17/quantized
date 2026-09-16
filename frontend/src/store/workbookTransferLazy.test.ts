// COLD-path coverage for the workbook Copy/Paste/Duplicate seam taken out of
// the eager bundle on 2026-09-14: `store/workbookTransfer.ts` now reaches
// `lib/workbookTransfer.ts`'s build/parse/paste core through a dynamic
// `import()` inside each (already-`async`) action.
//
// `store/workbookTransfer.test.ts` owns the WARM behaviour — it statically
// imports the core itself, so by the time its round trips run the chunk is
// resolved and every action behaves as it always did. Nothing there would
// notice if the new failure mode regressed, which is what this spec owns: a
// core that cannot be fetched must refuse through the slice's own `fail()`
// (status line + danger toast, project untouched), never as a silent no-op
// with an unhandled rejection behind it.
//
// `vi.doMock`, not the hoisted `vi.mock`: the import is resolved at CALL time
// inside the action, so a doMock registered immediately before the gesture is
// exactly what that resolution sees — and `vi.doUnmock` + `vi.resetModules`
// afterwards puts the real core back for the next test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../lib/types";
import type { WorkbookNode } from "../lib/workbooks";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const wb = (id: string, name: string): WorkbookNode => ({ id, name });
const ds = (id: string, name: string, workbookId: string): Dataset => ({
  id,
  name,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
  workbookId,
});

const dangerToasts = () => useToasts.getState().toasts.filter((t) => t.kind === "danger").map((t) => t.msg);

let written: string | null = null;

beforeEach(() => {
  written = null;
  Object.assign(navigator, {
    clipboard: {
      writeText: async (text: string) => {
        written = text;
      },
      readText: async () => {
        if (written === null) throw new Error("clipboard empty");
        return written;
      },
    },
  });
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [ds("d1", "run1.dat", "w1")],
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
});

afterEach(() => {
  vi.doUnmock("../lib/workbookTransfer");
  vi.resetModules();
});

describe("workbook transfer — chunk-deferred core", () => {
  it("copies a workbook to the clipboard after loading the core", async () => {
    await useApp.getState().copyWorkbookToClipboard("w1");
    expect(written).not.toBeNull();
    expect(JSON.parse(written ?? "{}")).toMatchObject({ workbook: { name: "run1" } });
    expect(useApp.getState().status).toBe('copied "run1" (1 worksheet)');
    expect(dangerToasts()).toEqual([]);
  });

  it("duplicates a workbook after loading the core", async () => {
    const id = await useApp.getState().duplicateWorkbook("w1");
    expect(id).not.toBeNull();
    expect(useApp.getState().workbooks.map((w) => w.name)).toEqual(["run1", "run1 copy"]);
  });

  it("refuses a copy whose core will not load, naming the reason and changing nothing", async () => {
    vi.doMock("../lib/workbookTransfer", () => {
      throw new Error("network error");
    });
    await useApp.getState().copyWorkbookToClipboard("w1");

    // The message tail is whatever the loader rejected with (here Vitest's
    // own mock-factory error, in production Vite's chunk-load message), so the
    // assertion is on the slice's own prefix — the part it is responsible for.
    expect(useApp.getState().status).toMatch(/^copy "run1" failed: /);
    expect(dangerToasts()).toEqual([useApp.getState().status]);
    expect(written).toBeNull();
  });

  it("refuses a paste whose core will not load, leaving the project untouched", async () => {
    // A real package on the clipboard, so the ONLY thing that can fail is the
    // fetch — a refusal here cannot be mistaken for "nothing to paste".
    await useApp.getState().copyWorkbookToClipboard("w1");
    useToasts.setState({ toasts: [] });
    const before = useApp.getState();
    const workbooksBefore = before.workbooks;
    const datasetsBefore = before.datasets;
    const historyBefore = before.history;

    vi.doMock("../lib/workbookTransfer", () => {
      throw new Error("network error");
    });
    await useApp.getState().pasteWorkbookFromClipboard();

    expect(useApp.getState().status).toMatch(/^paste workbook failed: /);
    expect(dangerToasts()).toEqual([useApp.getState().status]);
    expect(useApp.getState().workbooks).toBe(workbooksBefore);
    expect(useApp.getState().datasets).toBe(datasetsBefore);
    expect(useApp.getState().history).toBe(historyBefore);
  });

  it("answers false — silently — when the paste probe's core will not load", async () => {
    await useApp.getState().copyWorkbookToClipboard("w1");
    useToasts.setState({ toasts: [] });

    vi.doMock("../lib/workbookTransfer", () => {
      throw new Error("network error");
    });
    expect(await useApp.getState().canPasteWorkbook()).toBe(false);
    // A Paste command merely asking "is anything pastable?" has not failed at
    // anything the user did, so the probe must not toast.
    expect(dangerToasts()).toEqual([]);
  });

  it("retries after a failed load instead of staying broken", async () => {
    vi.doMock("../lib/workbookTransfer", () => {
      throw new Error("network error");
    });
    await useApp.getState().copyWorkbookToClipboard("w1");
    expect(written).toBeNull();

    vi.doUnmock("../lib/workbookTransfer");
    vi.resetModules();
    await useApp.getState().copyWorkbookToClipboard("w1");
    expect(written).not.toBeNull();
  });

  // 2026-09-15 review, finding 9: `duplicateWorkbook` is `transferCore`'s
  // third caller and had no chunk-load coverage, though Copy and Paste did.
  it("refuses a duplicate whose core will not load, leaving the project untouched", async () => {
    const before = useApp.getState();
    vi.doMock("../lib/workbookTransfer", () => {
      throw new Error("network error");
    });

    expect(await useApp.getState().duplicateWorkbook("w1")).toBeNull();

    expect(useApp.getState().status).toMatch(/^duplicate "run1" failed: /);
    expect(dangerToasts()).toEqual([useApp.getState().status]);
    expect(useApp.getState().workbooks).toBe(before.workbooks);
    expect(useApp.getState().datasets).toBe(before.datasets);
    expect(useApp.getState().history).toBe(before.history);
  });
});

// 2026-09-15 review, finding 1. Copy is the ONE action in this slice that
// cannot simply `await` the core: `navigator.clipboard.write` has to be
// reached inside the click's own task, or the transient user activation is
// spent and the write is refused (`qz --desktop`'s WKWebView is strictest
// about this). `store/workbookTransfer.ts`'s `buildForCopy` and
// `lib/clipboard.ts`'s `copyTextAsync` exist for that, and this is the spec
// that holds it: the chunk is deliberately GATED, so "the write happened
// first" is proved rather than assumed.
describe("Copy workbook — the clipboard write keeps the user gesture", () => {
  /** jsdom ships no ClipboardItem; this one just remembers its values so the
   *  `write` stub can read them the way a real browser reads a promise value. */
  class FakeClipboardItem {
    constructor(public readonly items: Record<string, Promise<Blob | string> | Blob | string>) {}
  }

  const setClipboard = (value: unknown): void => {
    // `writable: true` matters: this file's own beforeEach re-installs the
    // clipboard with Object.assign, which throws on a non-writable property.
    Object.defineProperty(navigator, "clipboard", { value, configurable: true, writable: true });
  };
  const originalClipboard = navigator.clipboard;
  const originalClipboardItem = (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem;

  afterEach(() => {
    setClipboard(originalClipboard);
    (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = originalClipboardItem;
  });

  it("calls write() before the core chunk resolves, and writes the real package", async () => {
    let releaseCore!: () => void;
    const coreGate = new Promise<void>((resolve) => (releaseCore = resolve));
    let coreResolved = false;
    vi.doMock("../lib/workbookTransfer", async () => {
      await coreGate;
      coreResolved = true;
      return await vi.importActual<typeof import("../lib/workbookTransfer")>("../lib/workbookTransfer");
    });

    const values: (Promise<Blob | string> | Blob | string)[] = [];
    const write = vi.fn(async (items: FakeClipboardItem[]) => {
      for (const item of items) values.push(...Object.values(item.items));
      for (const value of values) await value;
    });
    setClipboard({ write });
    (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = FakeClipboardItem;

    const copying = useApp.getState().copyWorkbookToClipboard("w1");

    // THE assertion. Not one `await` has run since the "click", and the core
    // import is provably still in flight — yet the clipboard write has
    // already started, holding the gesture. Awaiting the chunk before
    // touching the clipboard (the shape this seam first shipped with) makes
    // this expectation fail.
    expect(write).toHaveBeenCalledTimes(1);
    expect(coreResolved).toBe(false);

    releaseCore();
    await copying;

    expect(coreResolved).toBe(true);
    // `copyTextAsync` hands ClipboardItem a text/plain Blob, not a bare string
    // (2026-09-15 review round 2, finding 3) — Blob is the value shape every
    // engine with ClipboardItem accepts, and the string shape is the one an
    // engine may refuse, sending Copy into its gesture-losing fallback.
    const written = await values[0];
    expect(written).toBeInstanceOf(Blob);
    expect(JSON.parse(await (written as Blob).text())).toMatchObject({ workbook: { name: "run1" } });
    expect(useApp.getState().status).toBe('copied "run1" (1 worksheet)');
    expect(dangerToasts()).toEqual([]);
  });

  it("reports the BUILD's own refusal, not 'clipboard unavailable', when the core will not load", async () => {
    const write = vi.fn(async (items: FakeClipboardItem[]) => {
      for (const item of items) for (const value of Object.values(item.items)) await value;
    });
    setClipboard({ write });
    (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = FakeClipboardItem;
    vi.doMock("../lib/workbookTransfer", () => {
      throw new Error("network error");
    });

    await useApp.getState().copyWorkbookToClipboard("w1");

    // The write WAS attempted (that is the whole point), but its value promise
    // rejected, so the specific reason — not the fallback wording — is shown.
    expect(write).toHaveBeenCalledTimes(1);
    expect(useApp.getState().status).toMatch(/^copy "run1" failed: /);
    expect(useApp.getState().status).not.toMatch(/clipboard unavailable/);
    expect(dangerToasts()).toEqual([useApp.getState().status]);
  });
});
