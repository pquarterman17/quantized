import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clipboardImageSupported,
  clipboardSvgSupported,
  copyImageAsync,
  copySvgAsync,
  copyTextAsync,
  payloadToTSV,
  tableToTSV,
} from "./clipboard";
import type { PlotPayload } from "./plotdata";

/** A minimal stand-in for the real `ClipboardItem`, since jsdom ships none:
 *  stores whatever value (Blob or pending-Blob promise) each MIME key was
 *  constructed with, so a test's `navigator.clipboard.write` mock can read
 *  it back the same way a real browser reads the value promise before
 *  actually performing the write. */
class FakeClipboardItem {
  // clipboardSvgSupported() (lib/clipboard.ts) treats a missing `supports`
  // probe as "no" — a real static method is needed here for copySvgAsync's
  // tests to actually reach its write path rather than short-circuiting on
  // capability detection before ever exercising the signal guard.
  static supports(): boolean {
    return true;
  }
  constructor(public readonly items: Record<string, Blob | Promise<Blob>>) {}
}

describe("payloadToTSV", () => {
  const base: PlotPayload = {
    data: [
      [0, 1, 2],
      [10, 20, 30],
      [100, 200, 300],
    ],
    series: [
      { label: "M", unit: "emu" },
      { label: "T", unit: "K" },
    ],
    xLabel: "Field",
    xUnit: "Oe",
  };

  it("writes a header row with x + each series (label + unit)", () => {
    const lines = payloadToTSV(base).split("\n");
    expect(lines[0]).toBe("Field (Oe)\tM (emu)\tT (K)");
  });

  it("writes one tab-separated row per data point", () => {
    const lines = payloadToTSV(base).split("\n");
    expect(lines).toHaveLength(4); // header + 3 rows
    expect(lines[1]).toBe("0\t10\t100");
    expect(lines[3]).toBe("2\t30\t300");
  });

  it("renders null cells (gaps) as empty fields, keeping the row width", () => {
    const withGap: PlotPayload = {
      ...base,
      data: [
        [0, 1, 2],
        [10, null, 30],
        [100, 200, null],
      ],
    };
    const lines = payloadToTSV(withGap).split("\n");
    expect(lines[2]).toBe("1\t\t200"); // M gap, T present
    expect(lines[3]).toBe("2\t30\t"); // T gap
  });

  it("omits the unit parens when a label has no unit", () => {
    const noUnit: PlotPayload = { ...base, xUnit: "", series: [{ label: "fit", unit: "" }], data: [[0], [1]] };
    expect(payloadToTSV(noUnit).split("\n")[0]).toBe("Field\tfit");
  });

  it("handles an empty payload (header only)", () => {
    const empty: PlotPayload = { data: [[]], series: [], xLabel: "x", xUnit: "" };
    expect(payloadToTSV(empty)).toBe("x");
  });
});

describe("tableToTSV", () => {
  it("joins headers and rows with tabs and newlines", () => {
    const tsv = tableToTSV(
      ["Field (Oe)", "M (emu)"],
      [
        [0, 1.5],
        [100, 2.5],
      ],
    );
    expect(tsv).toBe("Field (Oe)\tM (emu)\n0\t1.5\n100\t2.5");
  });

  it("renders null/undefined cells as empty fields (constant width)", () => {
    const tsv = tableToTSV(["a", "b", "c"], [[1, null, 3], [undefined, 5, 6]]);
    expect(tsv.split("\n")).toEqual(["a\tb\tc", "1\t\t3", "\t5\t6"]);
  });

  it("keeps full numeric precision (not the rounded display)", () => {
    expect(tableToTSV(["x"], [[0.123456789]])).toBe("x\n0.123456789");
  });

  it("emits just the header for no rows", () => {
    expect(tableToTSV(["x", "y"], [])).toBe("x\ty");
  });
});

describe("clipboardImageSupported", () => {
  const originalClipboard = navigator.clipboard;
  const originalClipboardItem = (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem;

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
    (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = originalClipboardItem;
  });

  it("is false in jsdom's default environment (no Clipboard image API)", () => {
    // jsdom ships no navigator.clipboard at all — this is the real "Firefox /
    // insecure context" case the toolbar's Copy Image button must disable for.
    expect(clipboardImageSupported()).toBe(false);
  });

  it("is false when navigator.clipboard exists but lacks write()", () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true });
    expect(clipboardImageSupported()).toBe(false);
  });

  it("is false when write() exists but ClipboardItem is undefined", () => {
    Object.defineProperty(navigator, "clipboard", { value: { write: async () => {} }, configurable: true });
    (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = undefined;
    expect(clipboardImageSupported()).toBe(false);
  });

  it("is true when both navigator.clipboard.write and ClipboardItem exist", () => {
    Object.defineProperty(navigator, "clipboard", { value: { write: async () => {} }, configurable: true });
    (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = class {};
    expect(clipboardImageSupported()).toBe(true);
  });
});

describe("clipboardSvgSupported (MAIN #35)", () => {
  const orig = globalThis.ClipboardItem;
  afterEach(() => {
    if (orig === undefined) delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
    else (globalThis as { ClipboardItem?: unknown }).ClipboardItem = orig;
  });

  function setClipboardItem(v: unknown) {
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = v;
  }

  it("is false when there is no ClipboardItem at all", () => {
    delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
    expect(clipboardSvgSupported()).toBe(false);
  });

  it("is false when the implementation has no supports() probe", () => {
    // An older implementation has a fixed, narrow allowlist that never
    // included SVG — that is a "no", not an "unknown".
    setClipboardItem(function () {});
    expect(clipboardSvgSupported()).toBe(false);
  });

  it("asks supports() rather than assuming", () => {
    const supports = vi.fn(() => true);
    setClipboardItem(Object.assign(function () {}, { supports }));
    expect(clipboardSvgSupported()).toBe(true);
    expect(supports).toHaveBeenCalledWith("image/svg+xml");
  });

  it("is false when supports() says no", () => {
    setClipboardItem(Object.assign(function () {}, { supports: () => false }));
    expect(clipboardSvgSupported()).toBe(false);
  });

  it("is false when supports() throws", () => {
    setClipboardItem(
      Object.assign(function () {}, {
        supports: () => {
          throw new Error("nope");
        },
      }),
    );
    expect(clipboardSvgSupported()).toBe(false);
  });
});

// F7 (2026-09-13 adversarial review of d6e67fb7): postBlob's own signal
// re-check (lib/api/http.ts) closes the race up to the moment it RETURNS
// the blob — but the browser reads the ClipboardItem value promise these
// two functions build on its own schedule, later still. Neither function
// had any test coverage at all before this round (every existing consumer
// mocks the whole module) — these exercise the real implementation.
describe("copyImageAsync / copySvgAsync — signal race guard (F7)", () => {
  const originalClipboard = navigator.clipboard;
  const originalClipboardItem = (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem;

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
    (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = originalClipboardItem;
  });

  /** Mirrors what a real browser does with a promise-valued `ClipboardItem`:
   *  reads (awaits) the value before actually writing. A rejected value
   *  promise means `write()` itself rejects — never a completed write. */
  function stubClipboardWrite(): ReturnType<typeof vi.fn> {
    const write = vi.fn(async (items: FakeClipboardItem[]) => {
      for (const item of items) {
        for (const value of Object.values(item.items)) await value;
      }
    });
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = FakeClipboardItem;
    return write;
  }

  // N1 (2026-09-13 round-2 review): renamed — this asserts "the signal is
  // already aborted BEFORE copyImageAsync is even called", not "the render
  // settles after cancel" (the render here is already settled at construction
  // time, and abort() runs before the call, not after it). The actual "settles
  // after cancel" race is the gated-read test below.
  it("copyImageAsync resolves false when the signal is already aborted at call time (write attempted, value promise rejects)", async () => {
    const write = stubClipboardWrite();
    const controller = new AbortController();
    const pending = Promise.resolve(new Blob(["x"])); // the render "succeeded"...
    controller.abort(); // ...right as Cancel is clicked

    const ok = await copyImageAsync(pending, controller.signal);

    expect(ok).toBe(false);
    // write() may be CALLED (a real browser starts the same way), but its
    // value promise always rejects, so it can never actually complete.
    await expect(write.mock.results[0]?.value).rejects.toThrow();
  });

  it("copySvgAsync resolves false when the signal is already aborted at call time (same as copyImageAsync)", async () => {
    const write = stubClipboardWrite();
    const controller = new AbortController();
    const pending = Promise.resolve(new Blob(["<svg/>"]));
    controller.abort();

    const ok = await copySvgAsync(pending, controller.signal);

    expect(ok).toBe(false);
    await expect(write.mock.results[0]?.value).rejects.toThrow();
  });

  // N1 (2026-09-13 round-2 review): THIS is the actual race the module's doc
  // now describes, and the two tests above do not exercise it — the render
  // settles, the eager `asBlob()` re-check runs and PASSES (signal not yet
  // aborted), and only THEN does Cancel land, before "the browser" (the gated
  // `write` mock below) ever reads the ClipboardItem's value promise. There is
  // no JS hook at that later point (see clipboard.ts's own doc), so the write
  // still completes — this pins that it does, not that it doesn't.
  it("still completes the write when Cancel lands AFTER the eager re-check already passed (the gated-read race)", async () => {
    let readValue!: () => void;
    const readGate = new Promise<void>((resolve) => (readValue = resolve));
    const write = vi.fn(async (items: FakeClipboardItem[]) => {
      await readGate; // "the browser" reads the value on ITS OWN schedule
      for (const item of items) {
        for (const value of Object.values(item.items)) await value;
      }
    });
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = FakeClipboardItem;

    let resolveRender!: (b: Blob) => void;
    const pending = new Promise<Blob | null>((r) => (resolveRender = r));
    const controller = new AbortController();

    const p = copyImageAsync(pending, controller.signal);
    resolveRender(new Blob(["x"])); // the render lands...
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    controller.abort(); // ...Cancel is clicked AFTER the re-check already ran
    readValue(); // only now does "the browser" read the value and write it

    expect(await p).toBe(true); // the write still completes despite the later abort
  });

  // N2 (2026-09-13 round-2 review): merged two near-duplicate tests ("signal
  // untouched" / "signal passed but never aborted") that asserted the exact
  // same thing under slightly different setups.
  it.each<[string, AbortSignal | undefined]>([
    ["no signal argument at all", undefined],
    ["a signal that is passed but never aborted", new AbortController().signal],
  ])("copyImageAsync still writes normally with %s (no regression)", async (_desc, signal) => {
    stubClipboardWrite();
    const ok = await copyImageAsync(Promise.resolve(new Blob(["x"])), signal);
    expect(ok).toBe(true);
  });
});

// 2026-09-15 review, finding 1: `store/workbookTransfer.ts`'s Copy has to
// `await` a chunk before it has any text, and awaiting BEFORE touching the
// clipboard spends the transient user activation the Clipboard API requires.
// `copyTextAsync` is the text half of the `copyImageAsync` answer to that.
describe("copyTextAsync — keeps the gesture while the text is still building", () => {
  const originalClipboard = navigator.clipboard;
  const originalClipboardItem = (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem;

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
    (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = originalClipboardItem;
  });

  /** A `navigator.clipboard.write` that reads each value the way a real
   *  browser does (awaiting a promise value), recording what it resolved to. */
  function stubWrite(): {
    write: ReturnType<typeof vi.fn>;
    text: () => Promise<string>;
    value: () => Promise<string | Blob>;
  } {
    const seen: (string | Blob | Promise<string | Blob>)[] = [];
    const write = vi.fn(async (items: FakeClipboardItem[]) => {
      for (const item of items) seen.push(...Object.values(item.items));
      for (const value of seen) await value;
    });
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = FakeClipboardItem;
    const value = async (): Promise<string | Blob> => await seen[0];
    return {
      write,
      value,
      text: async () => {
        const v = await value();
        return v instanceof Blob ? await v.text() : String(v);
      },
    };
  }

  it("calls write() with the text STILL PENDING — no await between the caller and the write", async () => {
    const { write, text } = stubWrite();
    let build!: (t: string) => void;
    const pending = new Promise<string>((r) => (build = r));

    const p = copyTextAsync(pending);
    // No `await` has run since the call, so this is still the caller's own
    // (gesture) task — and the write has already started.
    expect(write).toHaveBeenCalledTimes(1);

    build("PACKAGE");
    expect(await p).toBe(true);
    expect(await text()).toBe("PACKAGE");
  });

  it("falls back to copyText on an engine with no ClipboardItem (re-opening the gesture window)", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = undefined;

    expect(await copyTextAsync(Promise.resolve("PACKAGE"))).toBe(true);
    expect(writeText).toHaveBeenCalledWith("PACKAGE");
  });

  it("falls back to copyText when write() itself refuses a promise value", async () => {
    const writeText = vi.fn(async () => undefined);
    const write = vi.fn(async () => {
      throw new Error("promise values unsupported");
    });
    Object.defineProperty(navigator, "clipboard", { value: { write, writeText }, configurable: true });
    (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = FakeClipboardItem;

    expect(await copyTextAsync(Promise.resolve("PACKAGE"))).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("PACKAGE");
  });

  it("resolves false — never throws — when the text never builds", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = undefined;

    expect(await copyTextAsync(Promise.reject(new Error("build failed")))).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  // 2026-09-15 review round 2, finding 3: `Promise<DOMString>` is legal per
  // spec but is the least-supported ClipboardItem value shape. An engine that
  // refuses it sends copyTextAsync into its `await pending` fallback, which
  // re-opens the very gesture window this function exists to close — and
  // nothing in the tests or in jsdom would show it.
  it("hands ClipboardItem a text/plain BLOB, the shape the sibling copy helpers use", async () => {
    const { text, value } = stubWrite();
    const p = copyTextAsync(Promise.resolve("PACKAGE"));
    const item = await value();
    expect(item, "a bare string value is the least-supported ClipboardItem shape").toBeInstanceOf(Blob);
    expect((item as Blob).type).toBe("text/plain");
    expect(await text()).toBe("PACKAGE");
    expect(await p).toBe(true);
  });

  // 2026-09-15 review round 2, finding 2: an engine whose write() RESOLVES
  // without ever reading the value promise never attaches a handler to it, so
  // a build failure escapes as an unhandled rejection — while the caller's own
  // `await build` is already reporting the real reason. `copyImageAsync`
  // guards exactly this class one function above.
  it("leaves no unhandled rejection when write() resolves without reading the value", async () => {
    // Deliberately does NOT await the item values — the pathological engine.
    const write = vi.fn(async () => undefined);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { write, writeText }, configurable: true });
    (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = FakeClipboardItem;

    const prior = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    const captured: unknown[] = [];
    const capture = (reason: unknown): void => void captured.push(reason);
    process.on("unhandledRejection", capture);
    try {
      expect(await copyTextAsync(Promise.reject(new Error("build failed")))).toBe(true);
      // Node decides a rejection is unhandled once the microtask queue has
      // drained, i.e. no earlier than the next macrotask turn.
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.off("unhandledRejection", capture);
      for (const listener of prior) process.on("unhandledRejection", listener);
    }
    expect(captured, "the value promise must carry its own handler").toEqual([]);
  });
});
