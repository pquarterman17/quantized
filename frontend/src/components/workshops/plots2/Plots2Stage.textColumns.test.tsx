// A plain `id,grp,sub,val` CSV: Pareto's Category picker and Parallel's Color by offer the text columns the
// importer left in `metadata.text_columns`. Driven through the real stage: pick `grp`, read the request the
// preview and Export send, and check what the server would sum against pandas
// (`df.groupby("grp")["val"].sum()` -> A 39, B 156). The server side is pinned in tests/test_plots2.py.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { postBlob, postDownload } from "../../../lib/api/http";
import { useApp } from "../../../store/useApp";
import { TEXT_GROUP_DS, VAL } from "../textGroupFixture";
import Plots2Stage from "./Plots2Stage";

vi.mock("../../../lib/api/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/http")>()),
  postBlob: vi.fn(),
  postDownload: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(postBlob).mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  vi.mocked(postDownload).mockResolvedValue(undefined);
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({ datasets: [TEXT_GROUP_DS], activeId: "tg", status: "", excludedDisplay: "grey" });
});

const optionsOf = (name: string) => Array.from(screen.getByRole("combobox", { name }).querySelectorAll("option")).map((o) => o.textContent);
const pick = (name: string, label: string) => {
  const option = Array.from(screen.getByRole("combobox", { name }).querySelectorAll("option")).find((o) => o.textContent === label);
  fireEvent.change(screen.getByRole("combobox", { name }), { target: { value: option!.getAttribute("value") } });
};

/** What the server does with a Pareto request: sum the value column per level of the category column. */
function paretoSums(body: Record<string, any>): Record<string, number> {
  const ds = body.dataset;
  const cat = body.plots2.cat_col - 1; // wire columns count [x, *channels]
  const val = body.plots2.value_col - 1;
  const out: Record<string, number> = {};
  ds.values.forEach((row: number[]) => {
    const label = ds.cat_levels[cat][row[cat]];
    out[label] = (out[label] ?? 0) + row[val];
  });
  return out;
}

describe("Pareto and Parallel on a CSV with text columns", () => {
  it("offers grp and sub as the Pareto category, and sums val per grp as pandas does", async () => {
    render(<Plots2Stage kind="pareto" />);
    expect(optionsOf("Category column")).toEqual(expect.arrayContaining(["grp", "sub"]));
    expect(optionsOf("Value column")).not.toContain("grp"); // a text column's codes are not a value
    pick("Category column", "grp");
    pick("Value column", "val");
    await waitFor(() => {
      const bodies = vi.mocked(postBlob).mock.calls.map((c) => c[1] as Record<string, any>);
      expect(paretoSums(bodies.at(-1)!)).toEqual({ A: 39, B: 156 });
    });
    expect(VAL.slice(0, 6).reduce((a, b) => a + b, 0)).toBe(39);
  });

  it("sends the same text-column request on Export", async () => {
    render(<Plots2Stage kind="pareto" />);
    pick("Category column", "sub");
    pick("Value column", "val");
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(vi.mocked(postDownload).mock.calls).toHaveLength(1));
    // pandas: df.groupby("sub")["val"].sum() -> x 69, y 126
    expect(paretoSums(vi.mocked(postDownload).mock.calls[0][1] as Record<string, any>)).toEqual({ x: 69, y: 126 });
  });

  it("offers the text columns to Parallel's Color by, but not as axes", () => {
    render(<Plots2Stage kind="parallel" />);
    expect(optionsOf("Color by")).toEqual(expect.arrayContaining(["grp", "sub"]));
    expect(screen.queryByLabelText("Axis grp")).toBeNull();
  });
});
