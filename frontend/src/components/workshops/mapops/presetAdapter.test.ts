// Map operations' preset adapter: the shared contract plus what is specific to
// it (every option the form offers is accepted, the hidden-field rule, no
// second map and no column picks stored).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { genericBackend } from "../../../lib/presets";
import { emptyForm, type MapOpsForm } from "./mapOpsForm";
import {
  EDGE_MODE_OPTIONS, FFT_OUTPUT_OPTIONS, FFT_WINDOW_OPTIONS, FILTER_MODE_OPTIONS, FLIP_OPTIONS, IMAGE_FILTER_OPTIONS, LEVEL_ORDER_OPTIONS,
  ROTATE_OPTIONS, SOBEL_OPTIONS,
} from "./mapOpsOptions";
import { ARITH_OPTIONS, OP_OPTIONS } from "./mapOpsForm";
import { createMapOpsAdapter, type MapOpsSettings } from "./presetAdapter";

const panel = {
  form: { ...emptyForm(), otherId: "keep-me" } as MapOpsForm,
  setForm(patch: Partial<MapOpsForm>) { panel.form = { ...panel.form, ...patch }; },
};
const adapter = createMapOpsAdapter(panel);

const sample: MapOpsSettings = {
  op: "imgfilter", xmin: "1", xmax: "9", ymin: "2", ymax: "8", flipAxis: "v", degrees: "270", order: "2", restoreMean: true, arith: "div",
  interpolate: true, allowMismatch: true, scalar: "2.5", reverse: true, fftOutput: "power", fftWindow: "tukey", fftRemoveMean: true,
  fMode: "bandpass", cutLow: "0.1", cutHigh: "0.4", edgeSigma: "0.05", imgKind: "gaussian", sigma: "2", size: "5", edgeMode: "constant",
  cval: "3", gradient: "x",
};

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "sigma", value: 2 },
  outOfRange: { field: "edgeMode", value: "teleport" },
});

const parse = (patch: Record<string, unknown>) => adapter.parse({ ...sample, ...patch });

describe("map operations adapter specifics", () => {
  it("every option list the form offers is accepted, on the operation that shows it", () => {
    for (const o of OP_OPTIONS) expect(parse({ op: o.value }), o.value).not.toHaveProperty("error");
    for (const o of FLIP_OPTIONS) expect(parse({ op: "flip", flipAxis: o.value }), o.value).not.toHaveProperty("error");
    for (const o of ROTATE_OPTIONS) expect(parse({ op: "rotate", degrees: o.value }), o.value).not.toHaveProperty("error");
    for (const o of LEVEL_ORDER_OPTIONS) expect(parse({ op: "level", order: o.value }), o.value).not.toHaveProperty("error");
    for (const o of ARITH_OPTIONS) expect(parse({ op: "scalar", arith: o.value }), o.value).not.toHaveProperty("error");
    for (const o of FFT_OUTPUT_OPTIONS) expect(parse({ op: "fft", fftOutput: o.value }), o.value).not.toHaveProperty("error");
    for (const o of FFT_WINDOW_OPTIONS) expect(parse({ op: "fft", fftWindow: o.value }), o.value).not.toHaveProperty("error");
    for (const o of FILTER_MODE_OPTIONS) expect(parse({ op: "fftfilter", fMode: o.value }), o.value).not.toHaveProperty("error");
    for (const o of IMAGE_FILTER_OPTIONS) expect(parse({ op: "imgfilter", imgKind: o.value }), o.value).not.toHaveProperty("error");
    for (const o of SOBEL_OPTIONS) expect(parse({ op: "imgfilter", imgKind: "sobel", gradient: o.value }), o.value).not.toHaveProperty("error");
    for (const o of EDGE_MODE_OPTIONS) expect(parse({ op: "imgfilter", edgeMode: o.value }), o.value).not.toHaveProperty("error");
  });

  it("rejects each bad value with its field named, where the operation shows it", () => {
    expect(parse({ op: "teleport" })).toMatchObject({ error: expect.stringContaining("'op'") });
    expect(parse({ op: "flip", flipAxis: "d" })).toMatchObject({ error: expect.stringContaining("'flipAxis'") });
    expect(parse({ op: "rotate", degrees: "45" })).toMatchObject({ error: expect.stringContaining("'degrees'") });
    expect(parse({ op: "crop", xmin: "abc" })).toMatchObject({ error: expect.stringContaining("'xmin'") });
    expect(parse({ op: "scalar", scalar: "x" })).toMatchObject({ error: expect.stringContaining("'scalar'") });
    expect(parse({ op: "fftfilter", fMode: "bandpass", cutLow: "-1" })).toMatchObject({ error: expect.stringContaining("'cutLow'") });
    expect(parse({ op: "fftfilter", edgeSigma: "-1" })).toMatchObject({ error: expect.stringContaining("'edgeSigma'") });
    expect(parse({ op: "imgfilter", imgKind: "gaussian", sigma: "0" })).toMatchObject({ error: expect.stringContaining("'sigma'") });
    expect(parse({ op: "imgfilter", imgKind: "median", size: "2.5" })).toMatchObject({ error: expect.stringContaining("'size'") });
    expect(parse({ extra: 1 })).toMatchObject({ error: expect.stringContaining("'extra'") });
  });

  it("hidden knobs are neither refused nor stored: a refused value there never blocks Save", () => {
    // another operation's options
    expect(parse({ op: "flip", degrees: "45", order: "9", sigma: "-3", size: "x1", cutLow: "-4", edgeMode: "zzz" })).not.toHaveProperty("error");
    // inside one operation: the band edge the filter type hides, the sigma a median filter does not use
    expect(parse({ op: "fftfilter", fMode: "lowpass", cutLow: "-5", cutHigh: "0.3" })).not.toHaveProperty("error");
    expect(parse({ op: "fftfilter", fMode: "highpass", cutHigh: "-5", cutLow: "0.3" })).not.toHaveProperty("error");
    expect(parse({ op: "fftfilter", fMode: "lowpass", cutHigh: "-5" })).toMatchObject({ error: expect.stringContaining("'cutHigh'") });
    expect(parse({ op: "imgfilter", imgKind: "median", sigma: "-1", size: "3", edgeMode: "reflect", cval: "abc" })).not.toHaveProperty("error");
    expect(parse({ op: "imgfilter", imgKind: "laplacian", sigma: "-1", size: "0", gradient: "zzz" })).not.toHaveProperty("error");
    expect(parse({ op: "imgfilter", edgeMode: "constant", cval: "abc" })).toMatchObject({ error: expect.stringContaining("'cval'") });
    // a wrong KIND of value is still refused where hidden
    expect(parse({ op: "flip", degrees: 90 })).toMatchObject({ error: expect.stringContaining("'degrees'") });

    panel.form = { ...emptyForm(), otherId: "keep-me", op: "flip", flipAxis: "v", sigma: "-3", size: "0", degrees: "45" as never, cutLow: "-1" };
    const captured = adapter.capture();
    expect(captured).toMatchObject({ op: "flip", flipAxis: "v", sigma: "1", size: "3", degrees: "90", cutLow: "" });
    expect(adapter.parse(captured)).not.toHaveProperty("error");
    localStorage.clear();
    expect(genericBackend(adapter).save("hidden", captured)).toMatchObject({ ok: true });
    localStorage.clear();
  });

  it("an Apply keeps what the form holds in place of a refused hidden value, and never touches map B", () => {
    panel.form = { ...emptyForm(), otherId: "keep-me", sigma: "4" };
    adapter.apply({ ...sample, op: "flip", sigma: "-2" });
    expect(panel.form).toMatchObject({ op: "flip", flipAxis: "v", sigma: "4", otherId: "keep-me" });
  });

  it("stores no second map or column pick, and says to pick map B after an arithmetic preset", () => {
    expect(Object.keys(adapter.capture())).not.toContain("otherId");
    expect(adapter.parse({ ...sample, otherId: "x" })).toMatchObject({ error: expect.stringContaining("'otherId'") });
    expect(adapter.apply({ ...sample, op: "arith" })).toMatchObject({ ok: true, notes: [expect.stringContaining("map B")] });
  });
});
