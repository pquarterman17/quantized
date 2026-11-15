// Set Column Values (gap audit 4, G3): the real dialog replacing the bare
// prompt — the browsers insert at the cursor, the preview follows the typing
// with errors inline, the row range limits it, and Apply writes the chosen
// column in one undo step. Plus the dialog basics (test/dialogA11y.ts).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import "../../../lib/formulaRefs";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { auditDialog } from "../../../test/dialogA11y";
import SetColumnValuesDialog from "./SetColumnValuesDialog";
import type { ScvTarget } from "../../../lib/setColumnValues";

const book = (): Dataset => ({
  id: "b",
  name: "Book1",
  data: {
    time: [1, 2, 3],
    values: [
      [10, 5],
      [20, 6],
      [30, 7],
    ],
    labels: ["Field", "Sum"],
    units: ["Oe", ""],
    metadata: { x_column_name: "X" },
  },
  formulas: [{ name: "Sum", expr: "if(row() >= 2 and row() <= 3, A / 4, nan)", deps: ["A"] }],
});

function Host({ target }: { target: ScvTarget }) {
  const [open, setOpen] = useState(false);
  const ds = useApp((s) => s.datasets.find((d) => d.id === "b"))!;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      {open && <SetColumnValuesDialog ds={ds} target={target} xName="X" onClose={() => setOpen(false)} />}
    </>
  );
}

const st = () => useApp.getState();
const ds = () => st().datasets.find((d) => d.id === "b")!;
const formula = () => screen.getByLabelText(/=$/) as HTMLTextAreaElement;
const previewNew = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.lastElementChild?.textContent);

async function open(target: ScvTarget) {
  const user = userEvent.setup();
  render(<Host target={target} />);
  const opener = screen.getByRole("button", { name: "opener" });
  await user.click(opener);
  await screen.findByRole("dialog");
  return { user, opener };
}

beforeEach(() => {
  useApp.setState({ datasets: [book()], activeId: "b", history: [], future: [], status: "" });
});

describe("Set Column Values dialog", () => {
  it("has the dialog basics: named, labelled fields, focus in, Tab trapped, Escape closes, focus returns", async () => {
    const { user, opener } = await open({ kind: "column", col: 0 });
    expect(await auditDialog(() => screen.queryByRole("dialog"), { opener, user })).toEqual([]);
  });

  it("previews the new values as you type, and shows an error inline instead", async () => {
    const { user } = await open({ kind: "column", col: 0 });
    await user.type(formula(), "A * 2");
    await waitFor(() => expect(previewNew()).toEqual(["20", "40", "60"]));
    await user.type(formula(), " + Q");
    expect(await screen.findByRole("alert")).toHaveTextContent('unknown variable "Q"');
    expect(formula()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("the function, column and operator browsers insert at the cursor", async () => {
    const { user } = await open({ kind: "new" });
    await user.type(formula(), "2");
    formula().setSelectionRange(0, 0);
    fireEvent.change(screen.getByLabelText("Insert function…"), { target: { value: "8" } }); // round(|, 2) — before the "2"
    expect(formula().value).toBe("round(, 2)2");
    expect(formula().selectionStart).toBe(6); // inside the parentheses
    const funcs = screen.getByLabelText("Insert column…");
    fireEvent.change(funcs, { target: { value: "1" } }); // A
    expect(formula().value).toBe("round(A, 2)2");
    formula().setSelectionRange(11, 11);
    fireEvent.change(screen.getByLabelText("Insert operator…"), { target: { value: "2" } }); // " * "
    expect(formula().value).toBe("round(A, 2) * 2");
  });

  it("writes an existing data column over a row range — one undo step", async () => {
    const { user } = await open({ kind: "column", col: 0 });
    await user.type(formula(), "A * 1e-4");
    await user.type(screen.getByLabelText("From"), "2");
    await waitFor(() => expect(previewNew()).toEqual(["0.002", "0.003"]));
    expect(screen.getByText(/A data column keeps values, not formulas/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ds().data.values.map((r) => r[0])).toEqual([10, 0.002, 0.003]);
    st().undo();
    expect(ds().data.values.map((r) => r[0])).toEqual([10, 20, 30]);
  });

  it("reopens a computed column with its formula and range, and edits it", async () => {
    const { user } = await open({ kind: "column", col: 1 });
    expect(formula().value).toBe("A / 4");
    expect(screen.getByLabelText("From")).toHaveValue("2");
    expect(screen.getByLabelText("To")).toHaveValue("3");
    await user.clear(screen.getByLabelText("From"));
    await user.clear(formula());
    await user.type(formula(), "A / 10");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ds().formulas?.[0].expr).toBe("A / 10"); // the whole sheet again: no range wrapper
    expect(ds().data.values.map((r) => r[1])).toEqual([1, 2, 3]);
  });

  it("adds a new column that keeps the formula", async () => {
    const { user } = await open({ kind: "new" });
    await user.type(screen.getByLabelText("Column name"), "T");
    await user.type(formula(), "A * 1e-4");
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ds().formulas?.[1]).toMatchObject({ name: "T", expr: "A * 1e-4" });
  });
});
