// The real / imaginary column pair of one complex expression (plan item 33,
// "pair metadata"), end to end: Set Column Values writes it, the worksheet's
// column menu offers an Argand and a Nyquist plot for it and ONLY for it, the
// plot axes follow, Nyquist plots -Im, undo takes the added column back, and a
// saved .dwk keeps the mark. Values are checked against numpy
// (z = (A + iB) * exp(i x); np.real(z), np.imag(z)).

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import "../../../lib/formulaRefs";
import { COMPLEX_SPLIT_LABEL } from "../../../lib/formulaComplexNames";
import type { Dataset } from "../../../lib/types";
import { parseWorkspace, serializeWorkspace } from "../../../lib/workspace";
import { useApp } from "../../../store/useApp";
import SetColumnValuesDialog from "./SetColumnValuesDialog";
import WorksheetPane from "./WorksheetPane";

const EXPR = "complex(A, B) * exp(complex(0, x))";
const NP_RE = [-1.7449770216271667, -1.8185948536513634, -3.2565223862838204]; // np.real
const NP_IM = [4.685622177896248, -0.8322936730942848, 12.585509999504682]; // np.imag

const book = (): Dataset => ({
  id: "b",
  name: "Impedance",
  data: { time: [1, 2, 3], values: [[3, 4], [0, 2], [5, -12]], labels: ["R", "X"], units: ["Ω", "Ω"], metadata: { x_column_name: "f" } },
});
const st = () => useApp.getState();
const ds = () => st().datasets.find((d) => d.id === "b")!;
const col = (i: number) => ds().data.values.map((r) => r[i]);
const header = (c: number) => document.querySelector<HTMLElement>(`[role="columnheader"][data-col="${c}"]`)!;
const ARGAND = /Argand plot/;
const NYQUIST = /Nyquist plot/;

/** The real entry point: the dialog's two-column action. */
async function writePair(name = "Z") {
  const user = userEvent.setup();
  const view = render(<SetColumnValuesDialog ds={ds()} target={{ kind: "new" }} xName="f" onClose={() => undefined} />);
  await screen.findByRole("dialog");
  await user.type(screen.getByLabelText("Column name"), name);
  fireEvent.change(screen.getByLabelText(/=$/), { target: { value: EXPR } });
  await user.click(await screen.findByRole("button", { name: COMPLEX_SPLIT_LABEL }));
  await waitFor(() => expect(ds().formulas?.length).toBe(2));
  view.unmount();
}

beforeEach(() => {
  useApp.setState({ datasets: [book()], activeId: "b", worksheetId: null, history: [], future: [], status: "", xKey: null, yKeys: null });
});

describe("the pair is written and marked", () => {
  it("both columns match numpy, share one pair id, and one undo removes both", async () => {
    await writePair();
    expect(ds().data.labels).toEqual(["R", "X", "Z (re)", "Z (im)"]);
    col(2).forEach((v, r) => expect(v).toBeCloseTo(NP_RE[r], 12));
    col(3).forEach((v, r) => expect(v).toBeCloseTo(NP_IM[r], 12));
    const [re, im] = ds().formulas!;
    expect(re.pair?.part).toBe("re");
    expect(im.pair?.part).toBe("im");
    expect(re.pair?.id).toBeTruthy();
    expect(re.pair?.id).toBe(im.pair?.id);
    act(() => st().undo());
    expect(ds().formulas ?? []).toEqual([]);
  });

  it("the mark survives a .dwk round trip without raising the file version", async () => {
    await writePair();
    const text = serializeWorkspace({ datasets: [ds()] });
    expect(JSON.parse(text).version).toBeLessThan(6);
    const back = parseWorkspace(text).datasets[0];
    expect(back.formulas?.map((f) => f.pair)).toEqual(ds().formulas?.map((f) => f.pair));
    expect(back.data.values).toEqual(ds().data.values);
  });
});

describe("the column menu offers the plots for a marked pair only", () => {
  it("either half offers Argand and Nyquist; an ordinary pair of columns offers neither", async () => {
    await writePair();
    render(<WorksheetPane datasetId="b" />);
    for (const c of [2, 3]) {
      fireEvent.contextMenu(header(c));
      expect(screen.getByRole("menuitem", { name: ARGAND })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: NYQUIST })).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: "Escape" });
    }
    for (const c of [0, 1]) {
      fireEvent.contextMenu(header(c));
      expect(screen.queryByRole("menuitem", { name: ARGAND })).toBeNull();
      fireEvent.keyDown(document.body, { key: "Escape" });
    }
  });

  it("two hand-written columns, even re()/im() of one expression, get no plot entries", () => {
    useApp.setState({
      datasets: [{ ...book(), formulas: [{ name: "P", expr: `re(${EXPR})` }, { name: "Q", expr: `im(${EXPR})` }], data: { ...book().data, labels: ["R", "X", "P", "Q"], units: ["", "", "", ""], values: [[3, 4, 0, 0], [0, 2, 0, 0], [5, -12, 0, 0]] } }],
    });
    render(<WorksheetPane datasetId="b" />);
    for (const c of [2, 3]) {
      fireEvent.contextMenu(header(c));
      expect(screen.queryByRole("menuitem", { name: ARGAND })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: NYQUIST })).toBeNull();
      fireEvent.keyDown(document.body, { key: "Escape" });
    }
  });
});

describe("the plots", () => {
  it("Argand plots Im against Re", async () => {
    await writePair();
    render(<WorksheetPane datasetId="b" />);
    fireEvent.contextMenu(header(2));
    fireEvent.click(screen.getByRole("menuitem", { name: ARGAND }));
    await waitFor(() => expect(st().status).toMatch(/Argand plot/));
    expect(st().xKey).toBe(2);
    expect(st().yKeys).toEqual([3]);
    expect(ds().data.labels).toEqual(["R", "X", "Z (re)", "Z (im)"]); // nothing added
  });

  it("Nyquist plots -Im against Re through a -Im column that is added once and follows the Im column", async () => {
    await writePair();
    render(<WorksheetPane datasetId="b" />);
    fireEvent.contextMenu(header(3));
    fireEvent.click(screen.getByRole("menuitem", { name: NYQUIST }));
    await waitFor(() => expect(st().status).toMatch(/Nyquist plot/));
    expect(ds().data.labels).toEqual(["R", "X", "Z (re)", "Z (im)", "Z (-im)"]);
    col(4).forEach((v, r) => expect(v).toBeCloseTo(-NP_IM[r], 12));
    expect(st().xKey).toBe(2);
    expect(st().yKeys).toEqual([4]);
    // asking again reuses the column
    fireEvent.contextMenu(header(2));
    fireEvent.click(screen.getByRole("menuitem", { name: NYQUIST }));
    await waitFor(() => expect(st().status).toMatch(/Nyquist plot/));
    expect(ds().data.labels).toHaveLength(5);
  });

  it("undo takes the added -Im column back", async () => {
    await writePair();
    const before = st().history.length;
    render(<WorksheetPane datasetId="b" />);
    fireEvent.contextMenu(header(3));
    fireEvent.click(screen.getByRole("menuitem", { name: NYQUIST }));
    await waitFor(() => expect(st().status).toMatch(/Nyquist plot/));
    expect(ds().data.labels).toHaveLength(5);
    while (st().history.length > before) act(() => st().undo()); // the column add, then the axis change
    expect(ds().data.labels).toEqual(["R", "X", "Z (re)", "Z (im)"]);
    expect(ds().formulas).toHaveLength(2);
  });

  it("refuses, and plots nothing, once one half was edited", async () => {
    await writePair();
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, formulas: d.formulas!.map((f) => (f.name === "Z (im)" ? { ...f, expr: "im(complex(A, B))" } : f)) })) }));
    render(<WorksheetPane datasetId="b" />);
    fireEvent.contextMenu(header(2));
    fireEvent.click(screen.getByRole("menuitem", { name: ARGAND }));
    await waitFor(() => expect(st().status).toMatch(/no longer come from one complex expression/));
    expect(st().yKeys).toBeNull();
    expect(ds().data.labels).toHaveLength(4);
  });
});
