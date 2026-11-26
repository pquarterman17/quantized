// "Copy as table": the HTML flavour is a real <table> (header row, one cell per
// field, escaped), the plain flavour is TSV, and the write degrades from
// html+text to text-only to nothing.

import { afterEach, describe, expect, it, vi } from "vitest";

import { copyTableAsync, escapeHtml, tableToHtml, tableToPlain } from "./clipboardTable";

const parse = (html: string): Document => new DOMParser().parseFromString(html, "text/html");

describe("tableToHtml", () => {
  const html = tableToHtml(["T (K)", "M (emu)"], [["300.0", "0.0012"], ["310.0", "—"]]);
  const doc = parse(html);

  it("is a table with one header row and one row per data row", () => {
    expect(doc.querySelectorAll("table")).toHaveLength(1);
    expect([...doc.querySelectorAll("thead th")].map((c) => c.textContent)).toEqual(["T (K)", "M (emu)"]);
    const rows = [...doc.querySelectorAll("tbody tr")].map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toEqual([["300.0", "0.0012"], ["310.0", "—"]]);
  });

  it("right-aligns numbers and leaves text alone", () => {
    const cells = [...doc.querySelectorAll("tbody td")].map((c) => (c as HTMLElement).style.textAlign);
    expect(cells).toEqual(["right", "right", "right", ""]);
  });

  it("escapes markup in headers and cells", () => {
    const d = parse(tableToHtml(["<b>x</b>"], [['a & "b" <i>']]));
    expect(d.querySelector("th")!.textContent).toBe("<b>x</b>");
    expect(d.querySelector("td")!.textContent).toBe('a & "b" <i>');
    expect(d.querySelector("b, i")).toBeNull();
    expect(escapeHtml(`&<>"`)).toBe("&amp;&lt;&gt;&quot;");
  });

  it("without headers has no thead; an empty block is still a table", () => {
    expect(parse(tableToHtml(null, [["1"]])).querySelector("thead")).toBeNull();
    expect(parse(tableToHtml([], [])).querySelectorAll("tr")).toHaveLength(0);
    expect(parse(tableToHtml([], [])).querySelector("table")).not.toBeNull();
  });
});

describe("tableToPlain", () => {
  it("is TSV with the header first", () => {
    expect(tableToPlain(["a", "b"], [["1", "2"]])).toBe("a\tb\n1\t2");
    expect(tableToPlain(null, [["1", "2"]])).toBe("1\t2");
  });
  it("cannot be broken by a tab or newline inside a cell", () => {
    expect(tableToPlain(null, [["a\tb", "c\nd"]])).toBe("a b\tc d");
  });
});

describe("copyTableAsync", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("writes html and text as ONE clipboard item", async () => {
    const write = vi.fn(async (_items: unknown[]) => undefined);
    const items: Record<string, Blob>[] = [];
    class FakeItem {
      constructor(public data: Record<string, Blob>) {
        items.push(data);
      }
    }
    vi.stubGlobal("ClipboardItem", FakeItem);
    Object.assign(navigator, { clipboard: { write, writeText: vi.fn() } });
    expect(await copyTableAsync("<table></table>", "a\tb")).toBe("html");
    expect(write).toHaveBeenCalledOnce();
    expect(Object.keys(items[0]).sort()).toEqual(["text/html", "text/plain"]);
    expect(await items[0]["text/plain"].text()).toBe("a\tb");
  });

  it("falls back to plain text when the item write is refused", async () => {
    vi.stubGlobal("ClipboardItem", class {});
    const writeText = vi.fn(async (_t: string) => undefined);
    Object.assign(navigator, { clipboard: { write: async () => { throw new Error("denied"); }, writeText } });
    expect(await copyTableAsync("<table></table>", "a\tb")).toBe("text");
    expect(writeText).toHaveBeenCalledWith("a\tb");
  });

  it("without any clipboard reports false", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    Object.assign(navigator, { clipboard: undefined });
    expect(await copyTableAsync("<table></table>", "x")).toBe(false);
  });
});
