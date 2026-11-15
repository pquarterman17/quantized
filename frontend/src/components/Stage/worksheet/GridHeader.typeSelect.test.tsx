// The header's modeling-type control must never take over the header: a click
// on the header BODY selects the column (Origin / Excel), and the type picker
// is a small, labelled corner select plus a context-menu submenu.

import { readFileSync } from "node:fs";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { modelingTypeItems } from "./columnTypeMenu";
import GridViewport from "./GridViewport";

const noop = () => {};
const data: DataStruct = { time: [0, 1], values: [[0], [1]], labels: ["Grade"], units: [""], metadata: {} };

function renderTyped(onToggleColSelect = vi.fn(), onChangeChannelType = vi.fn()) {
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
    />,
  );
  return { ...utils, onToggleColSelect, onChangeChannelType };
}

describe("worksheet header modeling-type control", () => {
  it("is a compact corner select, not a header-wide one", () => {
    renderTyped();
    const select = screen.getByRole("combobox", { name: "Modeling type of column Grade" });
    // No inline full-width sizing: the header body stays free for the select-column click.
    expect(select.style.width).toBe("");
    const css = readFileSync("src/styles/shell.css", "utf8");
    const rule = css.split("\n").find((l) => l.startsWith(".qzk-grid-headcell .qzk-col-type"));
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/width:\s*[\d.]+em/);
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
    const [item] = modelingTypeItems(0, "ordinal", set) as { submenu: unknown }[];
    const sub = item.submenu as { label: string; checked?: boolean; run: () => void }[];
    expect(sub.map((s) => [s.label, s.checked])).toEqual([
      ["Auto (inferred)", false],
      ["Continuous", false],
      ["Ordinal", true],
      ["Nominal", false],
    ]);
    sub[3].run();
    expect(set).toHaveBeenCalledWith(0, "nominal");
    sub[0].run();
    expect(set).toHaveBeenCalledWith(0, null);
    expect(modelingTypeItems(-1, undefined, set)).toEqual([]);
  });
});
