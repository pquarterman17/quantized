import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clipboardImageSupported,
  clipboardSvgSupported,
  copyImageAsync,
  copySvgAsync,
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

  it("copyImageAsync resolves false — never a completed write — when the render settles AFTER cancel", async () => {
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

  it("copySvgAsync resolves false under the same race", async () => {
    const write = stubClipboardWrite();
    const controller = new AbortController();
    const pending = Promise.resolve(new Blob(["<svg/>"]));
    controller.abort();

    const ok = await copySvgAsync(pending, controller.signal);

    expect(ok).toBe(false);
    await expect(write.mock.results[0]?.value).rejects.toThrow();
  });

  it("copyImageAsync still writes normally when the signal is untouched (no regression)", async () => {
    stubClipboardWrite();
    const ok = await copyImageAsync(Promise.resolve(new Blob(["x"])));
    expect(ok).toBe(true);
  });

  it("copyImageAsync still writes normally when signal is passed but never aborted", async () => {
    stubClipboardWrite();
    const controller = new AbortController();
    const ok = await copyImageAsync(Promise.resolve(new Blob(["x"])), controller.signal);
    expect(ok).toBe(true);
  });
});
