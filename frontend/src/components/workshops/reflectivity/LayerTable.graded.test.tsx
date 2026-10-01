import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import LayerTable from "./LayerTable";
import type { ModelLayer } from "./useReflectivity";

const LAYERS: ModelLayer[] = [
  { preset: "", thickness: 0, roughness: 0, sld: 0 },
  { preset: "", thickness: 100, roughness: 5, sld: 4e-6 },
  { preset: "", thickness: 0, roughness: 3, sld: 2.07e-6 },
];

function mount(layers: ModelLayer[] = LAYERS) {
  const onUpdate = vi.fn();
  render(<LayerTable layers={layers} presets={[]} radiation="xray" onUpdate={onUpdate} onRemove={vi.fn()} />);
  return onUpdate;
}

describe("LayerTable — graded (spline) layers", () => {
  it("offers a graded profile for film layers only", () => {
    mount();
    const selects = screen.getAllByRole("combobox");
    const graded = (s: HTMLElement) => Array.from((s as HTMLSelectElement).options).some((o) => o.value === "graded");
    expect(selects.map(graded)).toEqual([false, true, false]);
  });

  it("turns a slab into a two-knot graded layer at its current SLD", () => {
    const onUpdate = mount();
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "graded" } });
    expect(onUpdate).toHaveBeenCalledWith(1, {
      preset: "",
      sld: 4e-6,
      isld: 0,
      graded: { knots: [4e-6, 4e-6], method: "pchip" },
    });
  });

  it("turns a graded layer back into a slab", () => {
    const layers = LAYERS.map((l, i) => (i === 1 ? { ...l, graded: { knots: [2e-6, 6e-6], method: "pchip" as const } } : l));
    const onUpdate = mount(layers);
    expect(screen.getAllByRole("combobox")[1]).toHaveValue("graded");
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "" } });
    expect(onUpdate).toHaveBeenCalledWith(1, { preset: "", sld: 4e-6, isld: 0, graded: undefined });
  });

  it("edits a graded layer's knots and interpolation in its editor", async () => {
    const layers = LAYERS.map((l, i) => (i === 1 ? { ...l, graded: { knots: [2e-6, 6e-6], method: "pchip" as const } } : l));
    const onUpdate = mount(layers);
    const knots = await screen.findByRole("textbox", { name: "Layer 1 SLD knots" });
    expect(knots).toHaveValue("2, 6");

    fireEvent.change(knots, { target: { value: "2, 3, 6" } });
    expect(onUpdate).toHaveBeenLastCalledWith(1, { graded: { knots: [2e-6, 3e-6, 6e-6], method: "pchip" } });

    fireEvent.change(screen.getByRole("combobox", { name: "Layer 1 interpolation" }), { target: { value: "linear" } });
    expect(onUpdate).toHaveBeenLastCalledWith(1, { graded: { knots: [2e-6, 6e-6], method: "linear" } });
  });

  it("keeps an unparseable knot list local and says why", async () => {
    const layers = LAYERS.map((l, i) => (i === 1 ? { ...l, graded: { knots: [2e-6, 6e-6], method: "pchip" as const } } : l));
    const onUpdate = mount(layers);
    const knots = await screen.findByRole("textbox", { name: "Layer 1 SLD knots" });
    fireEvent.change(knots, { target: { value: "2" } });
    expect(knots).toHaveValue("2");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter at least two numbers.");
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

const withGraded = (graded: NonNullable<ModelLayer["graded"]>) => LAYERS.map((l, i) => (i === 1 ? { ...l, graded } : l));
const THREE = { knots: [2e-6, 4e-6, 6e-6], method: "pchip" as const };

describe("LayerTable — graded absorption and knot positions", () => {
  it("switches absorption on with one value per knot, and off again", async () => {
    const onUpdate = mount(withGraded(THREE));
    const toggle = await screen.findByRole("checkbox", { name: "Layer 1 absorption" });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole("textbox", { name: "Layer 1 absorption knots" })).toBeNull();
    fireEvent.click(toggle);
    expect(onUpdate).toHaveBeenLastCalledWith(1, { graded: { ...THREE, isld: [0, 0, 0] } });
  });

  it("edits the absorption knots (10⁻⁶ Å⁻²) and switches them off", async () => {
    const onUpdate = mount(withGraded({ ...THREE, isld: [0, 0, 0] }));
    const field = await screen.findByRole("textbox", { name: "Layer 1 absorption knots" });
    expect(field).toHaveValue("0, 0, 0");
    fireEvent.change(field, { target: { value: "0.01, 0, 0.02" } });
    expect(onUpdate).toHaveBeenLastCalledWith(1, { graded: { ...THREE, isld: [1e-8, 0, 2e-8] } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Layer 1 absorption" }));
    expect(onUpdate).toHaveBeenLastCalledWith(1, { graded: THREE });
  });

  it("defaults to evenly spaced knots and takes custom fractional positions", async () => {
    const onUpdate = mount(withGraded(THREE));
    const field = await screen.findByRole("textbox", { name: "Layer 1 knot positions" });
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", "evenly spaced");
    expect(screen.getByRole("button", { name: "Layer 1 evenly spaced" })).toBeDisabled();
    fireEvent.change(field, { target: { value: "0, 0.25, 1" } });
    expect(onUpdate).toHaveBeenLastCalledWith(1, { graded: { ...THREE, positions: [0, 0.25, 1] } });
  });

  it("resets custom positions to evenly spaced", async () => {
    const onUpdate = mount(withGraded({ ...THREE, positions: [0, 0.25, 1] }));
    expect(await screen.findByRole("textbox", { name: "Layer 1 knot positions" })).toHaveValue("0, 0.25, 1");
    fireEvent.click(screen.getByRole("button", { name: "Layer 1 evenly spaced" }));
    expect(onUpdate).toHaveBeenLastCalledWith(1, { graded: THREE });
  });

  it("keeps a position list that is not numbers local and says why", async () => {
    const onUpdate = mount(withGraded(THREE));
    const field = await screen.findByRole("textbox", { name: "Layer 1 knot positions" });
    fireEvent.change(field, { target: { value: "0, half, 1" } });
    expect(field).toHaveValue("0, half, 1");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter positions as numbers from 0 to 1.");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it.each([
    [{ positions: [0, 0.6, 0.3] }, "Layer 1's knot positions must be strictly increasing."],
    [{ positions: [0, 0.5, 1.5] }, "Layer 1's knot positions must lie within 0 to 1."],
    [{ positions: [0, 1] }, "Layer 1 needs one knot position per knot (3)."],
    [{ isld: [0, 1e-8] }, "Layer 1 needs an absorption value for every knot or for none."],
  ])("says what the backend would refuse: %o", async (extra, message) => {
    mount(withGraded({ ...THREE, ...extra }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });
});
