// Set Column Values with a complex formula (plan item 33, contract C7), through
// the real dialog and the real store: an expression whose value is complex
// offers ONE action, writing its real and imaginary parts as two ordinary
// computed columns; anything else keeps the dialog's normal behaviour.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import "../../../lib/formulaRefs";
import { COMPLEX_RESULT_ERROR, COMPLEX_SPLIT_LABEL } from "../../../lib/formulaComplexNames";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import SetColumnValuesDialog from "./SetColumnValuesDialog";

const book = (): Dataset => ({
  id: "b",
  name: "Impedance",
  data: {
    time: [1, 2, 3],
    values: [
      [3, 4],
      [0, 2],
      [5, -12],
    ],
    labels: ["R", "X"],
    units: ["Ω", "Ω"],
    metadata: { x_column_name: "f" },
  },
});

const st = () => useApp.getState();
const ds = () => st().datasets.find((d) => d.id === "b")!;
const formula = () => screen.getByLabelText(/=$/) as HTMLTextAreaElement;
const split = () => screen.queryByRole("button", { name: COMPLEX_SPLIT_LABEL });
const col = (i: number) => ds().data.values.map((r) => r[i]);

async function open() {
  const user = userEvent.setup();
  const onClose = () => undefined;
  render(<SetColumnValuesDialog ds={ds()} target={{ kind: "new" }} xName="f" onClose={onClose} />);
  await screen.findByRole("dialog");
  return user;
}
const type = (text: string) => fireEvent.change(formula(), { target: { value: text } });

beforeEach(() => {
  useApp.setState({ datasets: [book()], activeId: "b", history: [], future: [], status: "" });
});

describe("Set Column Values: a complex result", () => {
  it("offers the two-column action, and Add column stays disabled", async () => {
    await open();
    type("complex(A, B)");
    expect(await screen.findByRole("alert")).toHaveTextContent(COMPLEX_RESULT_ERROR);
    expect(split()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add column" })).toBeDisabled();
  });

  it("writes <name> (re) and <name> (im) as ordinary computed columns, in one undo step", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Column name"), "Z");
    type("complex(A, B)");
    await user.click(await screen.findByRole("button", { name: COMPLEX_SPLIT_LABEL }));
    await waitFor(() => expect(ds().formulas?.length).toBe(2));
    expect(ds().formulas?.map((f) => [f.name, f.expr])).toEqual([
      ["Z (re)", "re(complex(A, B))"],
      ["Z (im)", "im(complex(A, B))"],
    ]);
    expect(ds().data.labels).toEqual(["R", "X", "Z (re)", "Z (im)"]);
    expect(col(2)).toEqual([3, 0, 5]);
    expect(col(3)).toEqual([4, 2, -12]);
    expect(ds().formulaErrors).toBeUndefined();
    expect(ds().formulas?.every((f) => f.unit === "Ω")).toBe(true); // both parts share the operands' unit
    expect(st().status).toMatch(/real and imaginary parts/);
    // the only metadata beyond an ordinary computed column is the pair mark (lib/complexPair.ts)
    for (const f of ds().formulas ?? []) expect(Object.keys(f).sort()).toEqual(["deps", "derived", "expr", "name", "pair", "unit"].filter((k) => k in f).sort());
    expect(ds().formulas?.map((f) => f.pair?.part)).toEqual(["re", "im"]);
    st().undo();
    expect(ds().formulas ?? []).toEqual([]);
    expect(ds().data.labels).toEqual(["R", "X"]);
  });

  it("works for an imaginary literal and honours the row range", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Column name"), "w");
    type("(A + 2i) * 1i");
    await user.type(screen.getByLabelText("From"), "2");
    await user.click(await screen.findByRole("button", { name: COMPLEX_SPLIT_LABEL }));
    await waitFor(() => expect(ds().formulas?.length).toBe(2));
    // (A + 2i) * i = -2 + A i
    expect(col(2).map((v) => (Number.isNaN(v) ? "blank" : v))).toEqual(["blank", -2, -2]);
    expect(col(3).map((v) => (Number.isNaN(v) ? "blank" : v))).toEqual(["blank", 0, 5]);
  });

  it("no action for a real result or for another error", async () => {
    await open();
    type("abs(complex(A, B))");
    await waitFor(() => expect(screen.getByRole("button", { name: "Add column" })).toBeEnabled());
    expect(split()).toBeNull();
    type("atan(complex(A, B))");
    expect(await screen.findByRole("alert")).toHaveTextContent("atan takes a real number");
    expect(split()).toBeNull();
    type("complex(A, Q)");
    expect(await screen.findByRole("alert")).toHaveTextContent('unknown variable "Q"');
    expect(split()).toBeNull();
  });

  it("a blank name gives the short default, never the whole formula", async () => {
    const user = await open();
    const long = "complex(A, B) * complex(A, B) / complex(1, 2) + 3i";
    type(long);
    await user.click(await screen.findByRole("button", { name: COMPLEX_SPLIT_LABEL }));
    await waitFor(() => expect(ds().formulas?.length).toBe(2));
    expect(ds().data.labels).toEqual(["R", "X", "Z (re)", "Z (im)"]);
    expect(ds().data.labels.some((l) => l.includes("complex"))).toBe(false);
  });

  it("refuses a name that is taken, and adds nothing", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Column name"), "Z");
    type("complex(A, B)");
    await user.click(await screen.findByRole("button", { name: COMPLEX_SPLIT_LABEL }));
    await waitFor(() => expect(ds().formulas?.length).toBe(2));
    // the dialog closed; open another for the same name
    document.body.innerHTML = "";
    const again = await open();
    await again.type(screen.getByLabelText("Column name"), "Z");
    type("complex(B, A)");
    await again.click(await screen.findByRole("button", { name: COMPLEX_SPLIT_LABEL }));
    expect(await screen.findByRole("alert")).toHaveTextContent('a column named "Z (re)" already exists');
    expect(ds().formulas?.length).toBe(2);
  });

  it("the help's three worked examples add as ordinary columns, with the right numbers", async () => {
    const examples: [string, number[], string?][] = [
      ["abs(complex(A, B))", [5, 2, 13], "Ω"], // impedance magnitude: both operands are ohms
      ["degrees(arg(complex(A, B)))", [(Math.atan2(4, 3) * 180) / Math.PI, 90, (Math.atan2(-12, 5) * 180) / Math.PI]],
      ["abs(1 / (1 + 2i*pi*x*1e-3))", [1, 2, 3].map((f) => 1 / Math.hypot(1, 2 * Math.PI * f * 1e-3))],
    ];
    for (const [i, [expr, want, unit]] of examples.entries()) {
      document.body.innerHTML = "";
      const user = await open();
      await user.type(screen.getByLabelText("Column name"), `m${i}`);
      type(expr);
      await waitFor(() => expect(screen.getByRole("button", { name: "Add column" })).toBeEnabled());
      await user.click(screen.getByRole("button", { name: "Add column" }));
      await waitFor(() => expect(ds().formulas?.length).toBe(i + 1));
      expect(ds().formulaErrors).toBeUndefined();
      col(2 + i).forEach((v, r) => expect(v, `${expr} row ${r}`).toBeCloseTo(want[r], 10));
      if (unit) expect(ds().formulas?.[i].unit).toBe(unit);
    }
  });

  it("refuses to propagate an error through a complex formula instead of guessing a sigma", async () => {
    useApp.setState({ datasets: [{ ...book(), errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }] }] });
    const user = await open();
    await user.type(screen.getByLabelText("Column name"), "M");
    type("abs(complex(A, B))");
    await user.click(screen.getByLabelText(/propagated σ/));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add column" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Add column" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/complex\(\)/);
    expect(ds().formulas ?? []).toEqual([]);
  });
});
