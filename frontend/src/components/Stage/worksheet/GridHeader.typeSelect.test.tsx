// The header's modeling-type control must never take over the header: a click
// on the header BODY selects the column (Origin / Excel), and the type picker
// is a small, labelled corner select plus a context-menu submenu.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { modelingTypeItems } from "./columnTypeMenu";
import { CHIP_MIN_WIDTH } from "./GridHeader";
import GridViewport from "./GridViewport";

const noop = () => {};
const data: DataStruct = { time: [0, 1], values: [[0], [1]], labels: ["Grade"], units: [""], metadata: {} };

function renderTyped(onToggleColSelect = vi.fn(), onChangeChannelType = vi.fn(), colWidths?: Record<number, number>) {
  const utils = render(
    <GridViewport
      data={data}
      xName="x"
      xUnit=""
      order={[0, 1]}
      masked={new Set()}
      filteredOut={new Set()}
      selected={new Set()}
      channelRoles={{}}
      sortMark={() => ""}
      selectedCols={new Set()}
      onToggleColSelect={onToggleColSelect}
      onSelectColRange={noop}
      onToggleSelect={noop}
      onSelectRange={noop}
      onEditCell={noop}
      baseCount={1}
      onRemoveFormula={noop}
      showStats={false}
      colStats={null}
      statsErr={false}
      textCols={[]}
      modelingTypeOf={() => "continuous"}
      onChangeChannelType={onChangeChannelType}
      colWidths={colWidths}
    />,
  );
  return { ...utils, onToggleColSelect, onChangeChannelType };
}

describe("worksheet header modeling-type control", () => {
  it("is a labelled select whose spoken label carries the full state", () => {
    renderTyped();
    expect(screen.getByRole("combobox", { name: "Modeling type of column Grade: Continuous (auto)" })).toBeTruthy();
  });

  it("sits in the role row beside the role text, not over the header body", () => {
    const { container } = renderTyped();
    const chip = screen.getByRole("combobox", { name: /Modeling type/ });
    const row = chip.parentElement as HTMLElement;
    expect(row.className).toBe("qzk-head-role");
    expect(row.querySelector(".role")).toBeTruthy();
    expect(container.querySelector('[role="columnheader"][data-col="0"]')).toContain(row);
  });

  it("is left out of a column too narrow to hold it (the menu still sets the type)", () => {
    const { container } = renderTyped(undefined, undefined, { 0: CHIP_MIN_WIDTH - 1 });
    expect(container.querySelector(".qzk-col-type")).toBeNull();
    cleanup();
    renderTyped(undefined, undefined, { 0: CHIP_MIN_WIDTH });
    expect(screen.getByRole("combobox", { name: /Modeling type/ })).toBeTruthy();
  });

  it("a click on the header cell selects the column; a click on the select does not", () => {
    const { onToggleColSelect, container } = renderTyped();
    const head = container.querySelector('[role="columnheader"][data-col="0"]') as HTMLElement;
    fireEvent.click(head, { ctrlKey: true });
    expect(onToggleColSelect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("combobox", { name: /Modeling type of column Grade/ }), { ctrlKey: true });
    expect(onToggleColSelect).toHaveBeenCalledTimes(1);
  });

  it("the context-menu submenu marks the current type and sets a new one", () => {
    const set = vi.fn();
    const [item] = modelingTypeItems([0], { 0: "ordinal" }, set) as { submenu: unknown }[];
    const sub = item.submenu as { label: string; checked?: boolean; run: () => void }[];
    expect(sub.map((s) => [s.label, s.checked])).toEqual([
      ["Auto (inferred)", false],
      ["Continuous", false],
      ["Ordinal", true],
      ["Nominal", false],
    ]);
    sub[3].run();
    expect(set).toHaveBeenCalledWith([0], "nominal");
    sub[0].run();
    expect(set).toHaveBeenCalledWith([0], null);
    expect(modelingTypeItems([-1], undefined, set)).toEqual([]);
  });

  it("acts on every target and checks a type only when all of them share it", () => {
    const set = vi.fn();
    const [item] = modelingTypeItems([0, 2], { 0: "ordinal", 2: "nominal" }, set) as { label: string; submenu: { checked?: boolean; run: () => void }[] }[];
    expect(item.label).toBe("Modeling type (2 columns)");
    expect(item.submenu.some((s) => s.checked)).toBe(false);
    item.submenu[2].run();
    expect(set).toHaveBeenCalledWith([0, 2], "ordinal");
  });
});
