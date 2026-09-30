// PR #492 review: the Office-ready "Copy Figure" clipboard item.
//
// jsdom has no Clipboard API, so each test installs a `navigator.clipboard.
// write` that behaves the way the Clipboard spec says a real one does: it
// reads EVERY representation's value promise, and the whole write rejects
// if any one of them rejects (nothing lands on the clipboard). That is the
// property the SVG-failure fallback below exists for.

import { afterEach, describe, expect, it, vi } from "vitest";

import { copyOfficeGraphicAsync, type OfficeGraphicCopy } from "./officeClipboard";

class FakeClipboardItem {
  static svgAdvertised = false;
  static supports(type?: string): boolean {
    return type === "image/svg+xml" ? FakeClipboardItem.svgAdvertised : true;
  }
  constructor(public readonly items: Record<string, Blob | Promise<Blob>>) {}
}

const originalClipboard = navigator.clipboard;
const originalClipboardItem = (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem;

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
  (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = originalClipboardItem;
  FakeClipboardItem.svgAdvertised = false;
});

/** Install a spec-shaped clipboard. `refuse(n)` makes the n-th write (1-based)
 *  throw up front, the way an engine that refuses the item's SHAPE does.
 *  `landed` is what the clipboard actually holds after the last write that
 *  succeeded (all values resolved), so tests assert on state, not calls. */
function installClipboard(opts: { svg?: boolean; refuse?: (n: number) => boolean } = {}) {
  FakeClipboardItem.svgAdvertised = opts.svg ?? false;
  const writes: FakeClipboardItem[] = [];
  const state: { landed: Record<string, Blob> | null } = { landed: null };
  const write = vi.fn(async (items: FakeClipboardItem[]) => {
    writes.push(items[0]);
    if (opts.refuse?.(writes.length)) throw new DOMException("refused", "NotAllowedError");
    const entries = Object.entries(items[0].items);
    const values = await Promise.all(entries.map(([, v]) => Promise.resolve(v)));
    state.landed = Object.fromEntries(entries.map(([k], i) => [k, values[i]]));
  });
  Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
  (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = FakeClipboardItem;
  return { write, writes, state };
}

/** A PNG whose IHDR says `w` x `h` pixels — the only bytes the HTML builder
 *  reads to size the `<img>`. */
function pngOf(w: number, h: number): Blob {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, w);
  view.setUint32(20, h);
  return new Blob([bytes], { type: "image/png" });
}

const SVG = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'], {
  type: "image/svg+xml",
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function source(over: Partial<OfficeGraphicCopy> = {}): OfficeGraphicCopy {
  return { png: Promise.resolve(pngOf(1200, 900)), svg: null, pngDpi: 300, ...over };
}

describe("copyOfficeGraphicAsync — what Office receives", () => {
  it("starts ONE write before the render settles (keeps the click's activation)", async () => {
    const { write, state } = installClipboard();
    const png = deferred<Blob | null>();
    const copying = copyOfficeGraphicAsync(source({ png: png.promise }));
    // Synchronously inside the call — before any render has resolved.
    expect(write).toHaveBeenCalledTimes(1);
    png.resolve(pngOf(1200, 900));
    expect(await copying).toBe(true);
    expect(Object.keys(state.landed!).sort()).toEqual(["image/png", "text/html"]);
  });

  it("text/html embeds the PNG (never the SVG), sized in CSS px so a 300-DPI render pastes at its true size", async () => {
    const { state } = installClipboard({ svg: true });
    expect(await copyOfficeGraphicAsync(source({ svg: Promise.resolve(SVG), alt: "M & H <T>" }))).toBe(true);
    const html = await state.landed!["text/html"].text();
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).not.toContain("svg");
    // 1200 x 900 px at 300 DPI = 4 x 3 in = 384 x 288 CSS px (96 px/in).
    expect(html).toContain('width="384" height="288"');
    expect(html).toContain('style="width:384px;height:288px"');
    expect(html).toContain('alt="M &amp; H &lt;T&gt;"');
  });

  it("offers raw image/svg+xml only when the browser advertises it", async () => {
    const off = installClipboard({ svg: false });
    const pendingSvg = deferred<Blob | null>();
    // Not advertised: the vector render is neither offered nor waited on.
    expect(await copyOfficeGraphicAsync(source({ svg: pendingSvg.promise }))).toBe(true);
    expect(Object.keys(off.state.landed!)).not.toContain("image/svg+xml");

    const on = installClipboard({ svg: true });
    expect(await copyOfficeGraphicAsync(source({ svg: Promise.resolve(SVG) }))).toBe(true);
    expect(Object.keys(on.state.landed!).sort()).toEqual(["image/png", "image/svg+xml", "text/html"]);
    expect(on.state.landed!["image/svg+xml"]).toBe(SVG);
  });

  it("omits the size (still a valid image) when the PNG header is unreadable", async () => {
    const { state } = installClipboard();
    const odd = new Blob(["not a png"], { type: "image/png" });
    expect(await copyOfficeGraphicAsync(source({ png: Promise.resolve(odd) }))).toBe(true);
    const html = await state.landed!["text/html"].text();
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).not.toContain("width=");
  });
});

describe("copyOfficeGraphicAsync — failure isolation", () => {
  it("raw SVG advertised but its render FAILS: the copy still lands PNG + HTML", async () => {
    const { writes, state } = installClipboard({ svg: true });
    const png = pngOf(1200, 900);
    const ok = await copyOfficeGraphicAsync(
      source({ png: Promise.resolve(png), svg: Promise.reject(new Error("SVG renderer 500")) }),
    );
    expect(ok).toBe(true);
    // The first (all-promise) item carried the doomed SVG and was rejected
    // as a whole; the retry is built from what resolved.
    expect(writes).toHaveLength(2);
    expect(Object.keys(state.landed!).sort()).toEqual(["image/png", "text/html"]);
    expect(state.landed!["image/png"]).toBe(png);
    expect(await state.landed!["text/html"].text()).toContain("data:image/png;base64,");
  });

  it("an empty SVG render is treated like a failed one", async () => {
    const { state } = installClipboard({ svg: true });
    expect(await copyOfficeGraphicAsync(source({ svg: Promise.resolve(null) }))).toBe(true);
    expect(Object.keys(state.landed!).sort()).toEqual(["image/png", "text/html"]);
  });

  it("PNG render fails but SVG succeeds: the copy FAILS and nothing lands (PNG is mandatory)", async () => {
    // Defined behaviour: the PNG is the one representation every paste
    // target reads and the HTML is built from it, so an SVG-only item is
    // not written — it would report "copied" and then paste nothing in most
    // apps. The caller reports the failure instead.
    const { writes, state } = installClipboard({ svg: true });
    const ok = await copyOfficeGraphicAsync(
      source({ png: Promise.reject(new Error("PNG renderer 500")), svg: Promise.resolve(SVG) }),
    );
    expect(ok).toBe(false);
    expect(state.landed).toBeNull();
    expect(writes).toHaveLength(1); // no retry without a PNG
  });

  it("an engine that refuses promise-valued items gets PNG + HTML as settled blobs", async () => {
    const { writes, state } = installClipboard({ refuse: (n) => n === 1 });
    expect(await copyOfficeGraphicAsync(source())).toBe(true);
    expect(writes).toHaveLength(2);
    expect(writes[1].items["image/png"]).toBeInstanceOf(Blob);
    expect(Object.keys(state.landed!).sort()).toEqual(["image/png", "text/html"]);
  });

  it("an engine that refuses every multi-format item still gets the PNG alone", async () => {
    const { writes, state } = installClipboard({ refuse: (n) => n < 3 });
    expect(await copyOfficeGraphicAsync(source())).toBe(true);
    expect(writes).toHaveLength(3);
    expect(Object.keys(state.landed!)).toEqual(["image/png"]);
  });

  it("reports false without writing when the Clipboard image API is missing", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const svg = Promise.reject(new Error("unused"));
    expect(await copyOfficeGraphicAsync(source({ svg }))).toBe(false);
  });
});

describe("copyOfficeGraphicAsync — cancellation", () => {
  it("already cancelled: nothing lands and no retry is attempted", async () => {
    const { writes, state } = installClipboard({ svg: true });
    const controller = new AbortController();
    controller.abort();
    const ok = await copyOfficeGraphicAsync(source({ svg: Promise.resolve(SVG) }), controller.signal);
    expect(ok).toBe(false);
    expect(state.landed).toBeNull();
    expect(writes).toHaveLength(1);
  });

  it("cancel mid-render AFTER the write started: the pending write fails and is not retried", async () => {
    const { writes, state } = installClipboard({ svg: true });
    const controller = new AbortController();
    const png = deferred<Blob | null>();
    const svg = deferred<Blob | null>();
    const copying = copyOfficeGraphicAsync(source({ png: png.promise, svg: svg.promise }), controller.signal);
    expect(writes).toHaveLength(1); // the write is already in flight
    controller.abort();
    // The renders complete anyway (a server that ignored the abort).
    png.resolve(pngOf(1200, 900));
    svg.resolve(SVG);
    expect(await copying).toBe(false);
    expect(state.landed).toBeNull();
    expect(writes).toHaveLength(1);
  });
});
