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
