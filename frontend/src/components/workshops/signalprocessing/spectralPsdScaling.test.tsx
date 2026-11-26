import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { sanitizeSpectralRecipe, spectralRequest } from "../../../lib/spectralWorkbench";
import type { Dataset } from "../../../lib/types";
import SpectralControls from "./SpectralControls";
import { DEFAULT_SPECTRAL_SETTINGS, buildSpectralRecipe, type SpectralUiSettings } from "./spectralSettings";

const dataset: Dataset = {
  id: "d", name: "scan",
  data: { time: [0, 1, 2, 3], values: [[1], [2], [3], [4]], labels: ["sig"], units: ["V"], metadata: { xUnit: "s" } },
};
const psd = { ...DEFAULT_SPECTRAL_SETTINGS, outputType: "psd" as const };

describe("PSD power scaling", () => {
  it("defaults to density: nothing is added to the recipe or the request", () => {
    const recipe = buildSpectralRecipe("fft", psd, [0], dataset);
    expect(recipe).not.toHaveProperty("psdScaling");
    expect(spectralRequest(dataset.data, recipe)).not.toHaveProperty("psd_scaling");
  });

  it("power scaling is recorded in the recipe, sent to the route and survives a .dwk round trip", () => {
    const recipe = buildSpectralRecipe("fft", { ...psd, psdScaling: "spectrum" }, [0], dataset);
    expect(recipe.psdScaling).toBe("spectrum");
    expect(spectralRequest(dataset.data, recipe)).toMatchObject({ psd_scaling: "spectrum", output_type: "psd" });
    expect(sanitizeSpectralRecipe(structuredClone(recipe))).toEqual(recipe);
  });

  it("a stale power choice never rides along with another output type", () => {
    const recipe = buildSpectralRecipe("fft", { ...DEFAULT_SPECTRAL_SETTINGS, psdScaling: "spectrum" }, [0], dataset);
    expect(recipe).not.toHaveProperty("psdScaling");
  });

  it("a saved recipe with an unknown scaling, or power on a non-PSD output, is dropped", () => {
    const good = buildSpectralRecipe("fft", { ...psd, psdScaling: "spectrum" }, [0], dataset);
    expect(sanitizeSpectralRecipe({ ...good, psdScaling: "rms" })).toBeUndefined();
    expect(sanitizeSpectralRecipe({ ...good, outputType: "magnitude" })).toBeUndefined();
  });

  it("the control appears for PSD output only and names the frequency unit", () => {
    function Harness({ initial }: { initial: SpectralUiSettings }) {
      const [s, setS] = useState(initial);
      return <><SpectralControls operation="fft" settings={s} setSettings={setS} xUnit="s" />
        <output data-testid="v">{s.psdScaling}</output></>;
    }
    const { unmount } = render(<Harness initial={DEFAULT_SPECTRAL_SETTINGS} />);
    expect(screen.queryByLabelText("PSD scaling")).toBeNull();
    unmount();
    render(<Harness initial={psd} />);
    expect(screen.getByRole("option", { name: "Density (power per 1/s)" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PSD scaling"), { target: { value: "spectrum" } });
    expect(screen.getByTestId("v")).toHaveTextContent("spectrum");
  });
});
