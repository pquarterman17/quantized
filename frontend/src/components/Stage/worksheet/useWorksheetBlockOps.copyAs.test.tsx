// The block ops' copy / paste OPTIONS: Copy as displayed, Copy as table and
// Paste with trimmed spaces. The default Copy and Paste are covered by the
// sibling tests and are not changed by these.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorksheetBlockOps } from "./useWorksheetBlockOps";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

const copyText = vi.fn(async (_text: string): Promise<boolean> => true);
const table = vi.fn(async (_html: string, _text: string): Promise<"html" | "text" | false> => "html");
vi.mock("../../../lib/clipboard", () => ({ copyText: (t: string) => copyText(t) }));
vi.mock("../../../lib/clipboardTable", async (orig) => ({
  ...(await orig<typeof import("../../../lib/clipboardTable")>()),
  copyTableAsync: (h: string, t: string) => table(h, t),
}));

const setStatus = vi.fn();
const ds: Dataset = {
  id: "d1",
  name: "s",
  data: { time: [1, 2, 3], values: [[0.123456, 1], [0.5, 2], [0.75, 3]], labels: ["M", "T"], units: ["emu", "K"], metadata: {} },
  columnProps: { 0: { format: { kind: "decimal", digits: 2 } } },
};

function ops(rows: number[], cols: number[], order = [0, 1, 2]) {
  return renderHook(() =>
    useWorksheetBlockOps({
      datasetId: "d1",
      rows,
      cols,
      order,
      rowCount: 3,
      writableCols: 2,
      valueAt: (r, c) => (c < 0 ? ds.data.time[r] : ds.data.values[r][c]),
      setStatus,
    }),
  ).result;
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [structuredClone(ds)], activeId: "d1" });
});

describe("Copy as displayed", () => {
  it("writes the rounded text; plain Copy still writes full precision", () => {
    const r = ops([0, 1], [0, 1]);
    r.current.copyDisplayed!();
    expect(copyText).toHaveBeenLastCalledWith("0.12\t1.0000\n0.50\t2.0000");
    r.current.copyBlock();
    expect(copyText).toHaveBeenLastCalledWith("0.123456\t1\n0.5\t2");
  });

  it("walks the display order and says what to do with no selection", () => {
    ops([0, 1], [0], [1, 0, 2]).current.copyDisplayed!();
    expect(copyText).toHaveBeenLastCalledWith("0.50\n0.12");
    ops([], []).current.copyDisplayed!();
    expect(setStatus).toHaveBeenLastCalledWith("select rows and columns first");
  });
});

describe("Copy as table", () => {
  it("hands over an HTML table with a header row and a TSV fallback with the same header", () => {
    ops([0, 1], [0, 1]).current.copyTable!();
    const [html, text] = table.mock.calls[0];
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect([...doc.querySelectorAll("th")].map((c) => c.textContent)).toEqual(["M (emu)", "T (K)"]);
    expect(doc.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(text).toBe("M (emu)\tT (K)\n0.12\t1.0000\n0.50\t2.0000");
  });

  it("reports honestly when only plain text landed", async () => {
    table.mockResolvedValueOnce("text");
    ops([0], [0]).current.copyTable!();
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith(expect.stringContaining("plain text")));
  });
});

describe("Paste with trimmed spaces", () => {
  const ZW = "​";
  const settled = () => setStatus.mock.calls.some((c) => /^(pasted|nothing)/.test(String(c[0])));
  const paste = async (text: string, trimmed: boolean) => {
    Object.assign(navigator, { clipboard: { readText: async () => text } });
    const r = ops([0], [0]);
    (trimmed ? r.current.pasteTrimmed! : r.current.pasteBlock)();
    await vi.waitFor(() => expect(settled()).toBe(true));
    return useApp.getState().datasets[0].data.values;
  };

  it("a padded number lands only when trimmed; the default paste skips it", async () => {
    const plain = await paste(`${ZW}9${ZW}`, false);
    expect(plain[0][0]).toBe(0.123456);
    setStatus.mockClear();
    const trimmed = await paste(`${ZW}9${ZW}`, true);
    expect(trimmed[0][0]).toBe(9);
  });
});
