import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import IirResponsePreview, { iirResponseOf } from "./IirResponsePreview";
import { nyquistOf } from "./iirSettings";
import SpectralControls from "./SpectralControls";
import { DEFAULT_SPECTRAL_SETTINGS, buildSpectralRecipe, validateSpectralSettings } from "./spectralSettings";

const dataset: Dataset = {
  id: "d",
  name: "scan",
  data: { time: [0, 1], values: [[1], [2]], labels: ["signal"], units: ["V"], metadata: { xUnit: "s" } },
};
const iir = { ...DEFAULT_SPECTRAL_SETTINGS, filterEngine: "iir" as const };

describe("IIR filter settings", () => {
  it("builds an iir recipe only for the IIR engine, keeping the FFT filter fields at their defaults", () => {
    const recipe = buildSpectralRecipe("filter", { ...iir, iirFamily: "ellip", iirBand: "bandstop", cutoffLow: "1", cutoffHigh: "3", order: "3" }, [0], dataset);
    expect(recipe.iir).toEqual({ family: "ellip", btype: "bandstop", order: 3, cutoff: [1, 3], rp: 1, rs: 40, zeroPhase: false });
    expect(recipe.filterType).toBe("lowpass");
    expect(buildSpectralRecipe("filter", DEFAULT_SPECTRAL_SETTINGS, [0], dataset)).not.toHaveProperty("iir");
  });

  it("validates ripple, attenuation and band ordering with a reason", () => {
    expect(validateSpectralSettings("filter", iir, [0])).toBe("");
    expect(validateSpectralSettings("filter", { ...iir, iirFamily: "cheby1", iirRp: "0" }, [0])).toMatch(/ripple/);
    expect(validateSpectralSettings("filter", { ...iir, iirFamily: "ellip", iirRp: "5", iirRs: "3" }, [0])).toMatch(/exceed/);
    expect(validateSpectralSettings("filter", { ...iir, iirBand: "bandpass", cutoffLow: "3", cutoffHigh: "2" }, [0])).toMatch(/Lower cutoff/);
  });

  it("shows only the controls the chosen family uses", () => {
    const { rerender } = render(<SpectralControls operation="filter" settings={iir} setSettings={() => undefined} xUnit="s" />);
    expect(screen.queryByText(/Pass-band ripple/)).toBeNull();
    rerender(<SpectralControls operation="filter" settings={{ ...iir, iirFamily: "ellip" }} setSettings={() => undefined} xUnit="s" />);
    expect(screen.getByText(/Pass-band ripple/)).toBeTruthy();
    expect(screen.getByText(/Stop-band attenuation/)).toBeTruthy();
    rerender(<SpectralControls operation="filter" settings={{ ...iir, iirFamily: "bessel" }} setSettings={() => undefined} xUnit="s" />);
    expect(screen.getByText(/Bessel normalization/)).toBeTruthy();
  });
});

describe("IIR response preview", () => {
  const meta = { iirResponse: { frequency: [0, 1, 2], magnitudeDb: [0, -3, -20], phaseDeg: [0, -45, -90], zeroPhase: false } };
  it("parses the backend block and rejects ragged or non-finite ones", () => {
    expect(iirResponseOf(meta)?.frequency).toEqual([0, 1, 2]);
    expect(iirResponseOf({ iirResponse: { ...meta.iirResponse, phaseDeg: [0, 1] } })).toBeNull();
    expect(iirResponseOf({ iirResponse: { ...meta.iirResponse, magnitudeDb: [0, null, 1] } })).toBeNull();
    expect(iirResponseOf({})).toBeNull();
  });
  it("draws magnitude and phase and says which response is shown", () => {
    const response = iirResponseOf(meta)!;
    const { rerender } = render(<IirResponsePreview response={response} unit="1/s" />);
    expect(screen.getByLabelText("IIR magnitude response")).toBeTruthy();
    expect(screen.getByLabelText("IIR phase response")).toBeTruthy();
    expect(screen.getByText(/causal/)).toBeTruthy();
    rerender(<IirResponsePreview response={{ ...response, zeroPhase: true }} unit="1/s" />);
    expect(screen.getByText(/zero-phase/)).toBeTruthy();
  });
});

describe("IIR default cutoff follows Nyquist (UX audit P2-6)", () => {
  it("nyquistOf mirrors the backend rule: 0.5 / median(|dx|)", () => {
    expect(nyquistOf([0, 1, 2, 3])).toBe(0.5);
    expect(nyquistOf([0, 0.01, 0.02, 0.04])).toBe(50);
    expect(nyquistOf([5])).toBeNull();
    expect(nyquistOf([1, 1, 1])).toBeNull();
  });

  it("a cutoff at or above Nyquist is refused in the browser with the limit", () => {
    expect(validateSpectralSettings("filter", iir, [0], false, 0.5)).toMatch(/below Nyquist \(0\.5/);
    expect(validateSpectralSettings("filter", { ...iir, cutoffLow: "0.1" }, [0], false, 0.5)).toBe("");
    expect(validateSpectralSettings("filter", iir, [0], false, null)).toBe("");
  });

  it("switching Method to IIR replaces the untouched shipped cutoffs with fractions of Nyquist, and keeps edited ones", () => {
    const seen: unknown[] = [];
    const setSettings = (u: unknown) => seen.push(typeof u === "function" ? (u as (s: typeof DEFAULT_SPECTRAL_SETTINGS) => unknown)(DEFAULT_SPECTRAL_SETTINGS) : u);
    const { rerender } = render(<SpectralControls operation="filter" settings={DEFAULT_SPECTRAL_SETTINGS} setSettings={setSettings} xUnit="s" nyquist={0.5} />);
    fireEvent.change(screen.getByDisplayValue(/FFT-domain/), { target: { value: "iir" } });
    expect(seen[0]).toMatchObject({ filterEngine: "iir", cutoffLow: "0.1", cutoffHigh: "0.3" });
    seen.length = 0;
    rerender(<SpectralControls operation="filter" settings={{ ...DEFAULT_SPECTRAL_SETTINGS, cutoffLow: "0.05" }} setSettings={setSettings} xUnit="s" nyquist={0.5} />);
    fireEvent.change(screen.getByDisplayValue(/FFT-domain/), { target: { value: "iir" } });
    // No override was added (the updater applied to the default state still shows the shipped 1 and 2).
    expect(seen[0]).toMatchObject({ filterEngine: "iir", cutoffLow: "1", cutoffHigh: "2" });
  });
});
