// Signal Processing's preset adapter: the shared contract plus what is specific
// to it (every option the UI offers is accepted, nested strictness, the range
// seed rule, no column or dataset stored).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { createSignalAdapter, settingsFromPanel, type SignalPresetSettings } from "./presetAdapter";
import {
  BESSEL_NORM_OPTIONS, FILTER_ENGINE_OPTIONS, IIR_BAND_OPTIONS, IIR_FAMILY_OPTIONS, OPERATION_OPTIONS, REFERENCE_MODE_OPTIONS,
  SETTINGS_OPERATIONS, SMOOTH_METHOD_OPTIONS, SPECTRAL_DETREND_OPTIONS, SPECTRAL_FILTER_TYPE_OPTIONS, SPECTRAL_OUTPUT_OPTIONS,
  SPECTRAL_SIDED_OPTIONS, SPECTRAL_WINDOW_OPTIONS, psdScalingOptions,
} from "./signalOptions";
import { DEFAULT_SIGNAL_SETTINGS, type SignalSettings } from "./signalProcessingModel";
import { DEFAULT_SPECTRAL_SETTINGS, type SpectralUiSettings } from "./spectralSettings";

const panel = {
  settings: { ...DEFAULT_SIGNAL_SETTINGS, xMin: "0", xMax: "99" } as SignalSettings,
  spectral: { ...DEFAULT_SPECTRAL_SETTINGS, xMin: "0", xMax: "99" } as SpectralUiSettings,
  setSettings(f: SignalSettings | ((c: SignalSettings) => SignalSettings)) { panel.settings = typeof f === "function" ? f(panel.settings) : f; },
  setSpectral(f: SpectralUiSettings | ((c: SpectralUiSettings) => SpectralUiSettings)) { panel.spectral = typeof f === "function" ? f(panel.spectral) : f; },
};
const adapter = createSignalAdapter(panel);

const sample: SignalPresetSettings = {
  signal: {
    operation: "normalize-reference", smoothMethod: "gaussian", smoothWindow: 7, smoothPolyOrder: 3, referenceMode: "range",
    referenceValue: "2", referenceMin: "1", referenceMax: "4", detrendOrder: 3, useRange: true, xMin: "1", xMax: "9", useAllRows: false,
  },
  spectral: {
    filterEngine: "iir", iirFamily: "ellip", iirBand: "bandstop", iirRp: "0.5", iirRs: "60", iirBesselNorm: "delay", iirZeroPhase: true,
    outputType: "psd", sided: "two", window: "hamming", detrend: "linear", welch: true, segmentLen: "64", overlap: "0.25",
    psdScaling: "spectrum", zeroPad: "256", filterType: "notch", cutoffLow: "3", cutoffHigh: "8", bandwidth: "0.5", order: "6",
    useRange: true, xMin: "2", xMax: "7", resample: true, correlationDemean: false,
  },
};

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "signal", value: "smooth" },
  outOfRange: { field: "spectral", value: { ...sample.spectral, window: "triangle" } },
});

const bad = (patch: Record<string, unknown>) => adapter.parse({ ...sample, signal: { ...sample.signal, ...patch } });
const badSpectral = (patch: Record<string, unknown>) => adapter.parse({ ...sample, spectral: { ...sample.spectral, ...patch } });

describe("signal processing adapter specifics", () => {
  it("every option list the UI renders is accepted, one value at a time", () => {
    for (const o of SETTINGS_OPERATIONS) expect(bad({ operation: o }), o).not.toHaveProperty("error");
    for (const o of SMOOTH_METHOD_OPTIONS) expect(bad({ smoothMethod: o.value }), o.value).not.toHaveProperty("error");
    for (const o of REFERENCE_MODE_OPTIONS) expect(bad({ referenceMode: o.value }), o.value).not.toHaveProperty("error");
    for (const o of SPECTRAL_OUTPUT_OPTIONS) expect(badSpectral({ outputType: o.value }), o.value).not.toHaveProperty("error");
    for (const o of psdScalingOptions("Hz")) expect(badSpectral({ psdScaling: o.value }), o.value).not.toHaveProperty("error");
    for (const o of SPECTRAL_SIDED_OPTIONS) expect(badSpectral({ sided: o.value }), o.value).not.toHaveProperty("error");
    for (const o of FILTER_ENGINE_OPTIONS) expect(badSpectral({ filterEngine: o.value }), o.value).not.toHaveProperty("error");
    for (const o of SPECTRAL_FILTER_TYPE_OPTIONS) expect(badSpectral({ filterType: o.value }), o.value).not.toHaveProperty("error");
    for (const o of SPECTRAL_WINDOW_OPTIONS) expect(badSpectral({ window: o.value }), o.value).not.toHaveProperty("error");
    for (const o of SPECTRAL_DETREND_OPTIONS) expect(badSpectral({ detrend: o.value }), o.value).not.toHaveProperty("error");
    for (const o of IIR_FAMILY_OPTIONS) expect(badSpectral({ iirFamily: o.value }), o.value).not.toHaveProperty("error");
    for (const o of IIR_BAND_OPTIONS) expect(badSpectral({ iirBand: o.value }), o.value).not.toHaveProperty("error");
    for (const o of BESSEL_NORM_OPTIONS) expect(badSpectral({ iirBesselNorm: o.value }), o.value).not.toHaveProperty("error");
  });

  it("the picker's other entries (median, despike, wavelets, Spectrogram) are not settings operations and are rejected", () => {
    const others = OPERATION_OPTIONS.map((o) => o.value).filter((v) => !(SETTINGS_OPERATIONS as readonly string[]).includes(v));
    expect(others).toContain("spectrogram");
    expect(others.length).toBeGreaterThan(1);
    for (const o of others) expect(bad({ operation: o }), o).toMatchObject({ error: expect.stringContaining("'operation'") });
  });

  it("rejects each bad value with its field named, nested keys included", () => {
    expect(bad({ smoothWindow: 0 })).toMatchObject({ error: expect.stringContaining("'smoothWindow'") });
    expect(bad({ detrendOrder: 6 })).toMatchObject({ error: expect.stringContaining("'detrendOrder'") });
    expect(bad({ referenceValue: "abc" })).toMatchObject({ error: expect.stringContaining("'referenceValue'") });
    expect(badSpectral({ order: "four" })).toMatchObject({ error: expect.stringContaining("'order'") });
    expect(badSpectral({ welch: "yes" })).toMatchObject({ error: expect.stringContaining("'welch'") });
    expect(bad({ extra: 1 })).toMatchObject({ error: expect.stringContaining("'extra'") });
    const { welch: _w, ...rest } = sample.spectral;
    void _w;
    expect(adapter.parse({ ...sample, spectral: rest })).toMatchObject({ error: expect.stringContaining("'welch'") });
  });

  it("an X range that is on needs an increasing pair, and one that is off stores no limits", () => {
    expect(bad({ xMin: "9", xMax: "1" })).toMatchObject({ error: expect.stringContaining("'xMin'") });
    expect(badSpectral({ xMin: "" })).toMatchObject({ error: expect.stringContaining("'xMin'") });
    expect(bad({ useRange: false })).toMatchObject({ error: expect.stringContaining("empty") });
    expect(bad({ useRange: false, xMin: "", xMax: "" })).not.toHaveProperty("error");
  });

  it("capture stores no seeded limits while the range is off, and an Apply with the range off leaves the panel's own", () => {
    panel.settings = { ...DEFAULT_SIGNAL_SETTINGS, xMin: "5", xMax: "50" };
    panel.spectral = { ...DEFAULT_SPECTRAL_SETTINGS, xMin: "5", xMax: "50" };
    const captured = settingsFromPanel(panel.settings, panel.spectral);
    expect(captured.signal).toMatchObject({ useRange: false, xMin: "", xMax: "" });
    adapter.apply(captured);
    expect(panel.settings).toMatchObject({ xMin: "5", xMax: "50" });
    expect(panel.spectral).toMatchObject({ xMin: "5", xMax: "50" });
  });

  it("stores no column, dataset or uncertainty choice, and keeps the uncertainty choice on Apply", () => {
    expect(Object.keys(adapter.capture())).toEqual(["signal", "spectral"]);
    expect(Object.keys(adapter.capture().signal)).not.toContain("dropUncertainty");
    panel.settings = { ...DEFAULT_SIGNAL_SETTINGS, dropUncertainty: true };
    adapter.apply(sample);
    expect(panel.settings.dropUncertainty).toBe(true);
  });
});
