// The model picker: search, grouped headings, one entry per alias, recents
// first, keyboard navigation. (The grouping/labels are lib/fitModelCatalog's.)

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { groupFitModels } from "../../../lib/fitModelCatalog";
import { filterModels, matchesQuery, pushRecent, readRecents, withRecents } from "../../../lib/fitModelPicker";
import type { FitModel } from "../../../lib/types";
import ModelSelect from "./ModelSelect";

const m = (name: string, category: string): FitModel => ({ name, category, paramNames: [], nParams: 0, p0: [], lb: [], ub: [] });
const MODELS = [
  m("Linear", "Linear"), m("Exponential Decay", "Decay"), m("ExpDec1", "Exponential"), m("ExpDec2", "Exponential"),
  m("Bi-exponential Decay", "Decay"), m("Stretched Exponential", "Decay"), m("Gaussian", "Peak"), m("Lorentz", "Peak Functions"),
];
const GROUPS = groupFitModels(MODELS);
const CUSTOM = [{ value: "custom:", label: "Custom equation…" }];

beforeEach(() => {
  localStorage.clear();
});

describe("model search (pure)", () => {
  it("narrows 'exp' to the exponential family, each model once", () => {
    const f = filterModels(GROUPS, CUSTOM, "exp", "Linear");
    const values = f.groups.flatMap((g) => g.options.map((o) => o.value));
    expect(values).toEqual(["Linear", "ExpDec1", "ExpDec2", "Stretched Exponential"]); // Linear is the kept current model
    expect(new Set(values).size).toBe(values.length);
  });
  it("finds an alias through the Origin entry's '= name' text", () => {
    const f = filterModels(GROUPS, CUSTOM, "bi-exponential", "Linear");
    expect(f.groups.flatMap((g) => g.options.map((o) => o.value))).toContain("ExpDec2");
    expect(matchesQuery("ExpDec1 (= Exponential Decay)", "exponential decay")).toBe(true);
    expect(matchesQuery("Gaussian", "exp")).toBe(false);
  });
  it("matches the group heading too", () => {
    expect(filterModels(GROUPS, CUSTOM, "peak", "").groups.map((g) => g.group)).toEqual(["Peak Functions"]);
  });
});

describe("recents", () => {
  it("keeps the last three picks, newest first, never a custom equation", () => {
    let r = pushRecent("Linear", []);
    for (const v of ["ExpDec1", "Gaussian", "Lorentz", "custom:mine"]) r = pushRecent(v, r);
    expect(r).toEqual(["Lorentz", "Gaussian", "ExpDec1"]);
    expect(readRecents()).toEqual(["Lorentz", "Gaussian", "ExpDec1"]);
    expect(withRecents(GROUPS, r)[0]!.group).toBe("Recent");
    expect(withRecents(GROUPS, ["gone"]).map((g) => g.group)).not.toContain("Recent");
  });
});

function picker(value = "Linear") {
  const onChange = vi.fn();
  const utils = render(<ModelSelect groups={GROUPS} custom={CUSTOM} value={value} onChange={onChange} />);
  return { onChange, ...utils };
}

describe("ModelSelect", () => {
  it("lists each alias once, under its Origin name", () => {
    picker();
    expect(screen.getByRole("option", { name: "ExpDec1 (= Exponential Decay)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^Exponential Decay/ })).toBeNull();
  });
  it("typing narrows the list; Enter picks the first match and clears the search", () => {
    const { onChange } = picker();
    const box = screen.getByRole("searchbox", { name: "Search models" });
    fireEvent.change(box, { target: { value: "exp" } });
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names).toContain("ExpDec1 (= Exponential Decay)");
    expect(names).not.toContain("Gaussian (height form; GaussAmp with y0 = 0)");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange.mock.calls).toEqual([["ExpDec1"]]);
    expect(box).toHaveValue("");
  });
  it("Escape clears the search; ArrowDown moves focus into the list", () => {
    picker();
    const box = screen.getByRole("searchbox", { name: "Search models" });
    fireEvent.change(box, { target: { value: "gauss" } });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(screen.getByRole("listbox", { name: "Model" })).toHaveFocus();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box).toHaveValue("");
  });
  it("says so when nothing matches", () => {
    picker();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search models" }), { target: { value: "zzzz" } });
    expect(screen.getByRole("status")).toHaveTextContent('No model matches "zzzz"');
  });
  it("a picked model comes back first under Recent", () => {
    const { onChange, unmount } = picker();
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), { target: { value: "Gaussian" } });
    expect(onChange.mock.calls).toEqual([["Gaussian"]]);
    unmount();
    const { container } = render(<ModelSelect groups={GROUPS} custom={CUSTOM} value="Linear" onChange={() => undefined} />);
    const first = container.querySelector("optgroup")!;
    expect(first.label).toBe("Recent");
    expect(first.querySelector("option")!.value).toBe("Gaussian");
  });
});
