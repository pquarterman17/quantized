// The model picker: search, grouped headings, every model once (both same-curve
// twins listed), recents first, keyboard navigation. (The grouping/labels are lib/fitModelCatalog's.)

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { groupFitModels } from "../../../lib/fitModelCatalog";
import { filterModels, matchesQuery, pushRecent, readRecents, recordRecentModel, withRecents } from "../../../lib/fitModelPicker";
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
    // Linear is the kept current model; both same-curve twins are listed.
    expect(values).toEqual(["Linear", "Exponential Decay", "ExpDec1", "ExpDec2", "Bi-exponential Decay", "Stretched Exponential"]);
    expect(new Set(values).size).toBe(values.length);
  });
  it("finds a model and its same-curve twin by either name", () => {
    const hits = (q: string) => filterModels(GROUPS, CUSTOM, q, "").groups.flatMap((g) => g.options.map((o) => o.value));
    expect(hits("expdec1")).toEqual(["Exponential Decay", "ExpDec1"]);
    expect(hits("exponential decay")).toEqual(["Exponential Decay", "Bi-exponential Decay"]);
    expect(matchesQuery("Gaussian", "exp")).toBe(false);
  });
  it("matches the group heading too", () => {
    expect(filterModels(GROUPS, CUSTOM, "peak", "").groups.map((g) => g.group)).toEqual(["Peak Functions"]);
  });
});

describe("recents", () => {
  it("keeps the last three fitted models, newest first, never a custom equation", () => {
    let r = pushRecent("Linear", []);
    for (const v of ["ExpDec1", "Gaussian", "Lorentz", "custom:mine"]) r = pushRecent(v, r);
    expect(r).toEqual(["Lorentz", "Gaussian", "ExpDec1"]);
    expect(readRecents()).toEqual([]); // pushRecent is pure: only a fit records
    for (const v of ["ExpDec1", "Gaussian", "Lorentz", "custom:mine"]) recordRecentModel(v);
    expect(readRecents()).toEqual(["Lorentz", "Gaussian", "ExpDec1"]);
    expect(withRecents(GROUPS, ["gone"]).map((g) => g.group)).not.toContain("Recent");
  });
  it("moves a recent model to Recent, so no value is listed twice", () => {
    const out = withRecents(GROUPS, ["Gaussian", "ExpDec1"]);
    expect(out[0]).toEqual({ group: "Recent", options: [expect.objectContaining({ value: "Gaussian" }), expect.objectContaining({ value: "ExpDec1" })] });
    const values = out.flatMap((g) => g.options.map((o) => o.value));
    expect(new Set(values).size).toBe(values.length);
    expect(values.sort()).toEqual(GROUPS.flatMap((g) => g.options.map((o) => o.value)).sort());
  });
});

function picker(value = "Linear") {
  const onChange = vi.fn();
  const utils = render(<ModelSelect groups={GROUPS} custom={CUSTOM} value={value} onChange={onChange} />);
  return { onChange, ...utils };
}

describe("ModelSelect", () => {
  it("lists both same-curve twins, each with its own value", () => {
    picker();
    expect(screen.getByRole("option", { name: "ExpDec1" })).toHaveValue("ExpDec1");
    expect(screen.getByRole("option", { name: "Exponential Decay (ExpDec1's curve; A, τ, C)" })).toHaveValue("Exponential Decay");
  });
  it("typing narrows the list; Enter picks the first match and clears the search", () => {
    const { onChange } = picker();
    const box = screen.getByRole("searchbox", { name: "Search models" });
    fireEvent.change(box, { target: { value: "expdec" } });
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names).toContain("ExpDec1");
    expect(names).not.toContain("Gaussian (height form; GaussAmp with y0 = 0)");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange.mock.calls).toEqual([["Exponential Decay"]]);
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
  it("arrowing through the filtered list selects without clearing the search; Enter commits", () => {
    const { onChange } = picker();
    const box = screen.getByRole("searchbox", { name: "Search models" });
    fireEvent.change(box, { target: { value: "exp" } });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    const list = screen.getByRole("listbox", { name: "Model" });
    // Each ArrowDown in a native listbox fires change on the next option.
    fireEvent.change(list, { target: { value: "ExpDec1" } });
    fireEvent.change(list, { target: { value: "ExpDec2" } });
    expect(onChange.mock.calls).toEqual([["ExpDec1"], ["ExpDec2"]]);
    expect(box).toHaveValue("exp");
    expect(screen.getByRole("listbox", { name: "Model" })).toBe(list); // still the filtered listbox
    expect(screen.queryByRole("option", { name: /^Gaussian/ })).toBeNull();
    fireEvent.keyDown(list, { key: "Enter" });
    expect(box).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Model" })).toBeInTheDocument();
  });
  it("a click on a filtered option, or leaving the list, commits the search", () => {
    picker();
    const box = screen.getByRole("searchbox", { name: "Search models" });
    fireEvent.change(box, { target: { value: "exp" } });
    fireEvent.click(screen.getByRole("option", { name: "ExpDec1" }));
    expect(box).toHaveValue("");
    fireEvent.change(box, { target: { value: "exp" } });
    fireEvent.blur(screen.getByRole("listbox", { name: "Model" }), { relatedTarget: box });
    expect(box).toHaveValue("exp"); // back to the search box: keep it
    fireEvent.blur(screen.getByRole("listbox", { name: "Model" }), { relatedTarget: null });
    expect(box).toHaveValue("");
  });
  it("says so when nothing matches", () => {
    picker();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search models" }), { target: { value: "zzzz" } });
    expect(screen.getByRole("status")).toHaveTextContent('No model matches "zzzz"');
  });
  it("successive change events (ArrowDown on the closed select) never reorder Recent or rewrite storage", () => {
    act(() => {
      recordRecentModel("Gaussian");
      recordRecentModel("ExpDec1");
    });
    const stored = localStorage.getItem("qz.fitModels.recent");
    const onChange = vi.fn();
    const { container, rerender } = render(<ModelSelect groups={GROUPS} custom={CUSTOM} value="ExpDec1" onChange={onChange} />);
    const order = () => [...container.querySelectorAll("option")].map((o) => o.value);
    const before = order();
    expect(before.slice(0, 2)).toEqual(["ExpDec1", "Gaussian"]); // Recent, newest first
    expect(new Set(before).size).toBe(before.length); // each value once: the keyboard can move past Recent
    // Walk the whole list the way ArrowDown does: each step selects the next value.
    let value = "ExpDec1";
    for (let i = 1; i < before.length; i++) {
      const next = before[before.indexOf(value) + 1]!;
      fireEvent.change(screen.getByRole("combobox", { name: "Model" }), { target: { value: next } });
      value = next;
      rerender(<ModelSelect groups={GROUPS} custom={CUSTOM} value={value} onChange={onChange} />);
      expect(order()).toEqual(before);
    }
    expect(value).toBe(before[before.length - 1]); // reached the end, past Recent
    expect(localStorage.getItem("qz.fitModels.recent")).toBe(stored);
  });
  it("a model a fit ran with comes back first under Recent, live", () => {
    const { container } = picker();
    act(() => recordRecentModel("Gaussian"));
    const first = container.querySelector("optgroup")!;
    expect(first.label).toBe("Recent");
    expect(first.querySelector("option")!.value).toBe("Gaussian");
    expect(screen.getAllByRole("option", { name: /^Gaussian/ })).toHaveLength(1);
  });
});
