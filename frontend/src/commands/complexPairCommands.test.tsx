// Plot ▸ Layout ▸ Argand / Nyquist plot and their command-palette entries (plan item 33), driven
// from the real entry points: the ⌘K palette and the Plot menu over the real command list
// (`buildAppActions`). A marked real / imaginary pair plots; anything else refuses, with a reason.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { buildAppActions } from "../appCommands";
import MenuBar from "../components/Shell/MenuBar";
import CommandPalette from "../components/overlays/CommandPalette";
import "../lib/formulaRefs";
import type { Dataset } from "../lib/types";
import { useCommands } from "../store/commands";
import { applyComplexParts } from "../store/setColumnValuesComplex";
import { useApp } from "../store/useApp";

const st = () => useApp.getState();
const ARGAND = /Argand plot/;
const NYQUIST = /Nyquist plot/;
const book = (): Dataset => ({
  id: "b",
  name: "Impedance",
  data: { time: [1, 2, 3], values: [[3, 4], [0, 2], [5, -12]], labels: ["R", "X"], units: ["Ω", "Ω"], metadata: {} },
});
const col = (i: number) => st().datasets.find((d) => d.id === "b")!.data.values.map((r) => r[i]);

/** The pair is written the way the dialog's second button writes it. */
async function withPair(name = "Z") {
  const r = await applyComplexParts("b", { name, expr: "complex(A, B) * exp(complex(0, x))", range: { from: 1, to: 3 } });
  expect(r.ok).toBe(true);
}

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ datasets: [book()], activeId: "b", history: [], future: [], status: "", xKey: null, yKeys: null, stageTab: "worksheet", cmdkOpen: false });
  useCommands.setState({ menuCommands: [] });
});

const BOX = "Type a command…";

function palette(query: string) {
  render(<CommandPalette actions={buildAppActions(useApp.getState)} />);
  act(() => useApp.setState({ cmdkOpen: true }));
  const input = screen.getByPlaceholderText(BOX);
  fireEvent.change(input, { target: { value: query } });
  return input;
}

describe("the command palette", () => {
  it("Argand plots Im against Re for the worksheet's marked pair", async () => {
    await withPair();
    const input = palette("argand plot");
    await screen.findByRole("option", { name: ARGAND });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(st().status).toMatch(/Argand plot/));
    expect(st().xKey).toBe(2);
    expect(st().yKeys).toEqual([3]);
    expect(st().stageTab).toBe("plot");
    expect(st().datasets[0].data.labels).toEqual(["R", "X", "Z (re)", "Z (im)"]); // nothing added
  });

  it("Nyquist plots -Im against Re through an added -Im column, checked against numpy", async () => {
    await withPair();
    const input = palette("nyquist plot");
    await screen.findByRole("option", { name: NYQUIST });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(st().status).toMatch(/Nyquist plot/));
    const NP_IM = [4.685622177896248, -0.8322936730942848, 12.585509999504682]; // np.imag((A + iB) * exp(i x))
    expect(st().datasets[0].data.labels).toEqual(["R", "X", "Z (re)", "Z (im)", "Z (-im)"]);
    col(4).forEach((v, r) => expect(v).toBeCloseTo(-NP_IM[r], 12));
    expect(st().xKey).toBe(2);
    expect(st().yKeys).toEqual([4]);
  });

  it("is off, with its reason, on a worksheet that has no pair", async () => {
    const input = palette("argand plot");
    const row = await screen.findByRole("option", { name: ARGAND });
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(within(row).getByText(/Needs a real \/ imaginary column pair/)).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(st().xKey).toBeNull();
    expect(st().yKeys).toBeNull();
  });

  it("refuses, saying why, when the plotted columns are not the pair (and plots nothing)", async () => {
    await withPair();
    useApp.setState({ xKey: 0, yKeys: [1] }); // R against X: ordinary columns
    const input = palette("argand plot");
    await screen.findByRole("option", { name: ARGAND });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(st().status).toMatch(/Can't plot the pair: the plotted columns are not a real \/ imaginary pair/));
    expect(st().xKey).toBe(0);
    expect(st().yKeys).toEqual([1]);
    expect(st().stageTab).toBe("worksheet");
  });

  it("refuses when the two columns no longer come from one expression", async () => {
    await withPair();
    const f = st().datasets[0].formulas!;
    useApp.setState({ datasets: [{ ...st().datasets[0], formulas: [f[0], { ...f[1], expr: "im(A)" }] }] });
    const input = palette("nyquist plot");
    await screen.findByRole("option", { name: NYQUIST });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(st().status).toMatch(/Can't plot the pair: the two columns no longer come from one complex expression/));
    expect(st().datasets[0].data.labels).toHaveLength(4); // no -Im column
  });

  it("with two pairs, the plotted column chooses; with none plotted it asks for a choice", async () => {
    await withPair("Z");
    await withPair("W");
    const input = palette("argand plot");
    await screen.findByRole("option", { name: ARGAND });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(st().status).toMatch(/2 real \/ imaginary pairs: set one of a pair's columns as X or Y/));
    expect(st().xKey).toBeNull();
    useApp.setState({ yKeys: [5], status: "" }); // W (im)
    act(() => useApp.setState({ cmdkOpen: false }));
    act(() => useApp.setState({ cmdkOpen: true }));
    const again = screen.getByPlaceholderText(BOX);
    fireEvent.change(again, { target: { value: "argand plot" } });
    await screen.findByRole("option", { name: ARGAND });
    fireEvent.keyDown(again, { key: "Enter" });
    await waitFor(() => expect(st().status).toMatch(/Argand plot/));
    expect(st().xKey).toBe(4);
    expect(st().yKeys).toEqual([5]);
  });
});

async function openPlotMenu() {
  render(<MenuBar actions={buildAppActions(useApp.getState)} onOpenPalette={() => undefined} />);
  fireEvent.pointerEnter(screen.getByRole("menubar"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "Plot" }));
  await screen.findByRole("menu");
  fireEvent.click(screen.getByRole("menuitem", { name: "Layout" })); // the section's submenu
  await screen.findByRole("menuitem", { name: ARGAND });
}

describe("the Plot menu", () => {
  it("lists both entries; picking one plots the pair", async () => {
    await withPair();
    await openPlotMenu();
    expect(screen.getByRole("menuitem", { name: NYQUIST })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: ARGAND }));
    await waitFor(() => expect(st().status).toMatch(/Argand plot/));
    expect(st().xKey).toBe(2);
    expect(st().yKeys).toEqual([3]);
  });

  it("shows both entries disabled on a worksheet with no pair", async () => {
    await openPlotMenu();
    for (const name of [ARGAND, NYQUIST]) expect(screen.getByRole("menuitem", { name })).toHaveAttribute("aria-disabled", "true");
  });
});
