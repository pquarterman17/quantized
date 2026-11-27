// Signal Processing's preset adapter: the shared contract plus what is specific
// to it (every option the UI offers is accepted, nested strictness, the range
// seed rule, no column or dataset stored).

import { describe, expect, it } from "vitest";

import { genericBackend } from "../../../lib/presets";
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
    operation: "fft", smoothMethod: "gaussian", smoothWindow: 7, smoothPolyOrder: 3, referenceMode: "range",
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

/** The signal / spectral settings parsed with one value edited, on an operation that SHOWS it (a hidden value is only type checked). */
const SHOWN_ON: Record<string, Record<string, unknown>> = {
  smooth: { operation: "smooth", smoothMethod: "savitzky-golay" },
  reference: { operation: "normalize-reference", referenceMode: "range" },
  detrend: { operation: "detrend" },
};
const bad = (patch: Record<string, unknown>, on = "smooth") => adapter.parse({ ...sample, signal: { ...sample.signal, ...SHOWN_ON[on], ...patch } });
const SPECTRAL_ON: Record<string, string> = { fft: "fft", filter: "filter", correlation: "correlation" };
const badSpectral = (patch: Record<string, unknown>, op = "fft", signal: Record<string, unknown> = {}) =>
  adapter.parse({ ...sample, signal: { ...sample.signal, operation: SPECTRAL_ON[op], ...signal }, spectral: { ...sample.spectral, ...patch } });
const iir = { filterEngine: "iir" };

describe("signal processing adapter specifics", () => {
  it("every option list the UI renders is accepted, one value at a time, on the operation that shows it", () => {
    for (const o of SETTINGS_OPERATIONS) expect(bad({ operation: o }), o).not.toHaveProperty("error");
    for (const o of SMOOTH_METHOD_OPTIONS) expect(bad({ smoothMethod: o.value }), o.value).not.toHaveProperty("error");
    for (const o of REFERENCE_MODE_OPTIONS) expect(bad({ referenceMode: o.value }, "reference"), o.value).not.toHaveProperty("error");
    for (const o of SPECTRAL_OUTPUT_OPTIONS) expect(badSpectral({ outputType: o.value }), o.value).not.toHaveProperty("error");
    for (const o of psdScalingOptions("Hz")) expect(badSpectral({ outputType: "psd", psdScaling: o.value }), o.value).not.toHaveProperty("error");
    for (const o of SPECTRAL_SIDED_OPTIONS) expect(badSpectral({ sided: o.value }), o.value).not.toHaveProperty("error");
    for (const o of FILTER_ENGINE_OPTIONS) expect(badSpectral({ filterEngine: o.value }, "filter"), o.value).not.toHaveProperty("error");
    for (const o of SPECTRAL_FILTER_TYPE_OPTIONS) expect(badSpectral({ filterEngine: "fft", filterType: o.value }, "filter"), o.value).not.toHaveProperty("error");
    for (const o of SPECTRAL_WINDOW_OPTIONS) expect(badSpectral({ window: o.value }), o.value).not.toHaveProperty("error");
    for (const o of SPECTRAL_DETREND_OPTIONS) expect(badSpectral({ detrend: o.value }), o.value).not.toHaveProperty("error");
    for (const o of IIR_FAMILY_OPTIONS) expect(badSpectral({ ...iir, iirFamily: o.value }, "filter"), o.value).not.toHaveProperty("error");
    for (const o of IIR_BAND_OPTIONS) expect(badSpectral({ ...iir, iirBand: o.value }, "filter"), o.value).not.toHaveProperty("error");
    for (const o of BESSEL_NORM_OPTIONS) expect(badSpectral({ ...iir, iirFamily: "bessel", iirBesselNorm: o.value }, "filter"), o.value).not.toHaveProperty("error");
  });

  it("the picker's other entries (median, despike, wavelets, Spectrogram) are not settings operations and are rejected", () => {
    const others = OPERATION_OPTIONS.map((o) => o.value).filter((v) => !(SETTINGS_OPERATIONS as readonly string[]).includes(v));
    expect(others).toContain("spectrogram");
    expect(others.length).toBeGreaterThan(1);
    for (const o of others) expect(bad({ operation: o }), o).toMatchObject({ error: expect.stringContaining("'operation'") });
  });

  it("rejects each bad value with its field named, nested keys included, where the operation shows it", () => {
    expect(bad({ smoothWindow: 0 })).toMatchObject({ error: expect.stringContaining("'smoothWindow'") });
    expect(bad({ detrendOrder: 6 }, "detrend")).toMatchObject({ error: expect.stringContaining("'detrendOrder'") });
    expect(bad({ referenceValue: "abc", referenceMode: "value" }, "reference")).toMatchObject({ error: expect.stringContaining("'referenceValue'") });
    expect(badSpectral({ filterEngine: "fft", order: "four" }, "filter")).toMatchObject({ error: expect.stringContaining("'order'") });
    expect(badSpectral({ welch: "yes" })).toMatchObject({ error: expect.stringContaining("'welch'") });
    expect(bad({ extra: 1 })).toMatchObject({ error: expect.stringContaining("'extra'") });
    const { welch: _w, ...rest } = sample.spectral;
    void _w;
    expect(adapter.parse({ ...sample, spectral: rest })).toMatchObject({ error: expect.stringContaining("'welch'") });
  });

  it("an X range that is on needs an increasing pair, on the worksheet range and on the spectral one", () => {
    expect(bad({ useRange: true, xMin: "9", xMax: "1" })).toMatchObject({ error: expect.stringContaining("'xMin'") });
    expect(badSpectral({ useRange: true, xMin: "" })).toMatchObject({ error: expect.stringContaining("'xMin'") });
    expect(bad({ useRange: true, xMin: "1", xMax: "9" })).not.toHaveProperty("error");
  });

  it("hidden settings are neither refused nor stored: a refused value never blocks Save", () => {
    // operation-specific signal options
    expect(bad({ operation: "detrend", smoothWindow: 0, smoothMethod: "zzz", referenceMode: "zzz", referenceValue: "abc", detrendOrder: 2 })).not.toHaveProperty("error");
    expect(bad({ smoothMethod: "gaussian", smoothPolyOrder: -4 })).not.toHaveProperty("error"); // the order is Savitzky-Golay's
    expect(bad({ referenceMode: "value", referenceMin: "abc", referenceMax: "def" }, "reference")).not.toHaveProperty("error");
    expect(bad({ referenceMode: "range", referenceValue: "abc" }, "reference")).not.toHaveProperty("error");
    expect(bad({ referenceMode: "value", referenceValue: "abc" }, "reference")).toMatchObject({ error: expect.stringContaining("'referenceValue'") });
    // the worksheet range is hidden under a spectral operation, the whole spectral group under a correction one
    expect(badSpectral({}, "fft", { useRange: true, xMin: "9", xMax: "1" })).not.toHaveProperty("error");
    const underSmooth = (patch: Record<string, unknown>) => adapter.parse({ ...sample, signal: { ...sample.signal, operation: "smooth" }, spectral: { ...sample.spectral, ...patch } });
    expect(underSmooth({ window: "zzz", order: "x", useRange: true, xMin: "9", xMax: "1" })).not.toHaveProperty("error");
    expect(underSmooth({ welch: "yes" })).toMatchObject({ error: expect.stringContaining("'welch'") });
    // spectral options by operation, engine, output and band
    expect(badSpectral({ filterType: "zzz", cutoffHigh: "abc", iirFamily: "zzz", iirRp: "abc" }, "correlation")).not.toHaveProperty("error");
    expect(badSpectral({ ...iir, window: "zzz", detrend: "zzz", filterType: "zzz", bandwidth: "abc" }, "filter")).not.toHaveProperty("error");
    expect(badSpectral({ filterEngine: "fft", iirFamily: "zzz", iirRp: "abc", iirZeroPhase: true }, "filter")).not.toHaveProperty("error");
    expect(badSpectral({ filterEngine: "fft", iirFamily: "zzz" }, "filter")).not.toHaveProperty("error");
    expect(badSpectral({ filterType: "lowpass", filterEngine: "fft", cutoffHigh: "abc", bandwidth: "abc" }, "filter")).not.toHaveProperty("error");
    expect(badSpectral({ filterType: "notch", filterEngine: "fft", bandwidth: "abc" }, "filter")).toMatchObject({ error: expect.stringContaining("'bandwidth'") });
    expect(badSpectral({ iirFamily: "butter", iirRp: "abc", iirRs: "abc", iirBesselNorm: "zzz", iirBand: "lowpass", cutoffHigh: "abc", ...iir }, "filter")).not.toHaveProperty("error");
    expect(badSpectral({ iirFamily: "ellip", iirRp: "abc", ...iir }, "filter")).toMatchObject({ error: expect.stringContaining("'iirRp'") });
    expect(badSpectral({ outputType: "magnitude", psdScaling: "zzz", welch: false, segmentLen: "abc", overlap: "abc" })).not.toHaveProperty("error");
    expect(badSpectral({ outputType: "psd", psdScaling: "zzz", welch: false })).toMatchObject({ error: expect.stringContaining("'psdScaling'") });
    expect(badSpectral({ outputType: "psd", welch: true, segmentLen: "abc" })).toMatchObject({ error: expect.stringContaining("'segmentLen'") });
    // a wrong KIND of value is still refused where hidden
    expect(badSpectral({ filterType: 4 }, "correlation")).toMatchObject({ error: expect.stringContaining("'filterType'") });
    expect(bad({ operation: "detrend", smoothWindow: "x" })).toMatchObject({ error: expect.stringContaining("'smoothWindow'") });
  });

  it("a save stores the default for a refused hidden value and is accepted, an Apply leaves the panel's own value", () => {
    panel.settings = { ...DEFAULT_SIGNAL_SETTINGS, operation: "detrend", detrendOrder: 2, smoothWindow: 0, referenceValue: "abc" };
    panel.spectral = { ...DEFAULT_SPECTRAL_SETTINGS, window: "zzz" as never, order: "x", cutoffLow: "3" };
    const captured = adapter.capture();
    expect(captured.signal).toMatchObject({ operation: "detrend", detrendOrder: 2, smoothWindow: DEFAULT_SIGNAL_SETTINGS.smoothWindow, referenceValue: "1" });
    expect(captured.spectral).toMatchObject({ window: DEFAULT_SPECTRAL_SETTINGS.window, order: DEFAULT_SPECTRAL_SETTINGS.order, cutoffLow: "3" }); // a valid hidden value is kept
    expect(adapter.parse(captured)).not.toHaveProperty("error");
    localStorage.clear();
    expect(genericBackend(adapter).save("hidden", captured)).toMatchObject({ ok: true });
    localStorage.clear();
    // an Apply of an old record whose hidden value is refused keeps what the panel holds
    panel.settings = { ...DEFAULT_SIGNAL_SETTINGS, smoothWindow: 9, xMin: "5", xMax: "50" };
    panel.spectral = { ...DEFAULT_SPECTRAL_SETTINGS, xMin: "5", xMax: "50" };
    adapter.apply({ signal: { ...sample.signal, operation: "detrend", smoothWindow: 0 }, spectral: sample.spectral });
    expect(panel.settings).toMatchObject({ operation: "detrend", smoothWindow: 9 });
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
