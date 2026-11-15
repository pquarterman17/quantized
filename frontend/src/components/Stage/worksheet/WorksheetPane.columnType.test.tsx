// The modeling-type control end to end in the worksheet pane: the header chip
// and the column context menu write the dataset's `channelTypes` as one undo
// step, a header selection is set together, a re-derived (read-only) sheet
// offers neither, and a later column delete keeps the overrides on the right
// columns.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { deleteColumns } from "../../../store/worksheetColumns";
import WorksheetPane from "./WorksheetPane";

const sheet = (extra: Partial<Dataset> = {}): Dataset => ({
  id: "w",
  name: "PPMS",
  data: {
    time: [1, 2],
    values: [
      [10, 20, 30, 40],
      [11, 21, 31, 41],
    ],
    labels: ["Temp", "Field", "Moment", "Error"],
    units: ["K", "Oe", "emu", "emu"],
    metadata: { x_column_name: "Time" },
  },
  ...extra,
});

const st = () => useApp.getState();
const ds = () => st().datasets[0];
const header = (col: number) => document.querySelector<HTMLElement>(`[role="columnheader"][data-col="${col}"]`)!;
const chip = (col: number) => within(header(col)).queryByRole("combobox", { name: /Modeling type/ });

function reset(d: Dataset) {
  useApp.setState({ datasets: [d], activeId: "w", worksheetId: null, history: [], future: [], status: "" });
}

describe("modeling type from the header", () => {
  beforeEach(() => reset(sheet()));

  it("the chip writes channelTypes in one undo step", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.change(chip(1)!, { target: { value: "ordinal" } });
    expect(ds().channelTypes).toEqual({ 1: "ordinal" });
    expect(st().history).toHaveLength(1);
    act(() => st().undo());
    expect(ds().channelTypes).toBeUndefined();
  });

  it("the context-menu submenu writes channelTypes in one undo step", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.contextMenu(header(2));
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: /Modeling type/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Nominal" }));
    expect(ds().channelTypes).toEqual({ 2: "nominal" });
    expect(st().history).toHaveLength(1);
    act(() => st().undo());
    expect(ds().channelTypes).toBeUndefined();
  });

  it("applies to the whole header selection when the clicked column is in it, as ONE undo step", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.click(header(1));
    fireEvent.click(header(3), { shiftKey: true });
    fireEvent.contextMenu(header(2));
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: /Modeling type \(3 columns\)/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Ordinal" }));
    expect(ds().channelTypes).toEqual({ 1: "ordinal", 2: "ordinal", 3: "ordinal" });
    expect(st().history).toHaveLength(1);
    act(() => st().undo());
    expect(ds().channelTypes).toBeUndefined();
  });

  it("deleting a column keeps the other overrides on their own columns", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.change(chip(0)!, { target: { value: "nominal" } });
    fireEvent.change(chip(2)!, { target: { value: "ordinal" } });
    act(() => deleteColumns("w", [1]));
    expect(ds().channelTypes).toEqual({ 0: "nominal", 1: "ordinal" });
  });
});

describe("a re-derived (read-only) sheet", () => {
  beforeEach(() => reset(sheet({ derivedFrom: { datasetId: "src", pipeline: "p" } })));

  it("offers neither the chip nor the menu entry, and the data is untouched", () => {
    render(<WorksheetPane datasetId="w" />);
    expect(chip(1)).toBeNull();
    fireEvent.contextMenu(header(1));
    expect(screen.queryByRole("menuitem", { name: /Modeling type/ })).toBeNull();
    expect(ds().channelTypes).toBeUndefined();
  });
});
