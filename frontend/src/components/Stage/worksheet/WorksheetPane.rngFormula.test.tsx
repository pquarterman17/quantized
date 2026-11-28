// rng("Name") typed into the worksheet's formula bar and into Set Column Values — the REAL entry paths a user takes.
// (#1172's tests drove the store's addFormula only, so the derived-expression analysis that every UI add goes
// through refused `sum(rng(...))` with "unknown function sum".)

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { loadFormulaExtension } from "../../../lib/formulaExt";
import type { ScvTarget } from "../../../lib/setColumnValues";
import type { Dataset } from "../../../lib/types";
import { defineNamedRangeFromSelection } from "../../../store/namedRanges";
import { useApp } from "../../../store/useApp";
import SetColumnValuesDialog from "./SetColumnValuesDialog";
import WorksheetPane from "./WorksheetPane";

const book = (): Dataset => ({
  id: "b",
  name: "Book1",
  data: {
    time: [1, 2, 3, 4, 5],
    values: [[10], [20], [30], [40], [50]],
    labels: ["A"],
    units: [""],
    metadata: {},
  },
});
const st = () => useApp.getState();
const ds = () => st().datasets.find((d) => d.id === "b")!;

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({ datasets: [book()], activeId: "b", namedRanges: [], history: [], future: [], status: "" });
  // rows 2..4 (0-based 1..3) of A: 20 + 30 + 40 = 90
  expect(defineNamedRangeFromSelection("b", { rows: [1, 2, 3], cols: [0] }, "Base", "sheet").ok).toBe(true);
});

describe("rng() through the formula bar", () => {
  it("adds sum(rng(...)) as a column, linked to the range, with no error", async () => {
    const user = userEvent.setup();
    render(<WorksheetPane datasetId="b" />);
    await user.type(screen.getByRole("textbox", { name: "Formula" }), 'sum(rng("Base",1))');
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(ds().formulas?.length).toBe(1));
    expect(ds().formulas![0].ranges?.[0].name).toBe("Base");
    expect(ds().formulas![0].ranges?.[0].id).toBe(st().namedRanges[0].id);
    expect(ds().data.values.map((r) => r[1])).toEqual([90, 90, 90, 90, 90]);
    expect(ds().formulaErrors ?? {}).toEqual({});
  });

  it("says why when the range name is unknown, instead of 'unknown function'", async () => {
    const user = userEvent.setup();
    render(<WorksheetPane datasetId="b" />);
    await user.type(screen.getByRole("textbox", { name: "Formula" }), 'mean(rng("Nope"))');
    await user.click(screen.getByRole("button", { name: "Add column" }));
    expect(await screen.findByText(/no named range "Nope"/)).toBeInTheDocument();
    expect(ds().formulas).toBeUndefined();
  });
});

function Host({ target }: { target: ScvTarget }) {
  const d = useApp((s) => s.datasets.find((x) => x.id === "b"))!;
  return <SetColumnValuesDialog ds={d} target={target} xName="X" onClose={() => undefined} />;
}
const formulaBox = () => screen.getByLabelText(/=$/) as HTMLTextAreaElement;

describe("rng() through Set Column Values", () => {
  it("Apply into a new column adds it, linked to the range", async () => {
    const user = userEvent.setup();
    render(<Host target={{ kind: "new" }} />);
    await user.type(formulaBox(), 'A + mean(rng("Base"))');
    await user.click(await screen.findByRole("button", { name: "Add column" }));
    await waitFor(() => expect(ds().formulas?.length).toBe(1));
    expect(ds().data.values.map((r) => r[1])).toEqual([40, 50, 60, 70, 80]);
    expect(ds().formulas![0].ranges?.[0].name).toBe("Base");
  });

  it("Apply into a data column writes the values", async () => {
    const user = userEvent.setup();
    render(<Host target={{ kind: "column", col: 0 }} />);
    await user.type(formulaBox(), 'A - sum(rng("Base"))');
    await user.click(await screen.findByRole("button", { name: "Apply" }));
    await waitFor(() => expect(ds().data.values.map((r) => r[0])).toEqual([-80, -70, -60, -50, -40]));
  });

  it("Apply into a computed column re-points it without an uncaught error", async () => {
    st().addFormula("b", "S", "A * 2");
    const user = userEvent.setup();
    render(<Host target={{ kind: "column", col: 1 }} />);
    await user.clear(formulaBox());
    await user.type(formulaBox(), 'sum(rng("Base"))');
    await user.click(await screen.findByRole("button", { name: "Apply" }));
    await waitFor(() => expect(ds().formulas![0].expr).toContain("rng"));
    expect(ds().data.values.map((r) => r[1])).toEqual([90, 90, 90, 90, 90]);
  });

  it("shows an analysis error with its reason instead of throwing", async () => {
    const mod = await import("../../../lib/derivedColumn");
    const spy = (await import("vitest")).vi.spyOn(mod, "deriveColumns").mockImplementation(() => {
      throw new Error("analysis blew up");
    });
    try {
      st().addFormula("b", "S", "A * 2");
      const user = userEvent.setup();
      render(<Host target={{ kind: "column", col: 1 }} />);
      await user.clear(formulaBox());
      await user.type(formulaBox(), "A * 3");
      await user.click(await screen.findByRole("button", { name: "Apply" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/analysis blew up/);
    } finally {
      spy.mockRestore();
      cleanup();
    }
  });
});

describe("the Insert function list", () => {
  it("offers rng(), and picking it puts the cursor inside the name quotes", () => {
    render(<Host target={{ kind: "new" }} />);
    const picker = screen.getByLabelText("Insert function…") as HTMLSelectElement;
    const option = [...picker.options].find((o) => /^rng\("Name"\)/.test(o.textContent ?? ""));
    expect(option, "an rng entry").toBeDefined();
    expect(option!.textContent).toContain('sum(rng("Name"))');
    fireEvent.change(picker, { target: { value: option!.value } });
    expect(formulaBox().value).toBe('sum(rng(""))');
    expect(formulaBox().selectionStart).toBe(9); // between the quotes
  });
});
