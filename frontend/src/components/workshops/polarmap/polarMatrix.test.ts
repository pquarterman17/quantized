import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { buildPolarMapRequest, guessPolarPicks } from "./polarMapRequest";
import { emptyMatrixConfig, matrixToPolarData, type PolarMatrixConfig } from "./polarMatrix";

const CHI = [0, 15, 30, 45, 60, 75, 90];
const PHI = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
const I = (chi: number, phi: number) => 100 + chi * 2 + Math.sin((phi * Math.PI) / 180) * 10;

/** Matrix worksheet: rows = chi (X column), channel headers = phi. */
const matrixChiRows = (): DataStruct => ({
  time: CHI,
  values: CHI.map((c) => PHI.map((p) => I(c, p))),
  labels: PHI.map(String),
  units: PHI.map(() => "cps"),
  metadata: { x_column_name: "Chi" },
});

/** The equivalent existing long-format dataset (the XRDML pole layout: Phi X, Psi, Intensity). */
const longForm = (): DataStruct => {
  const time: number[] = [];
  const values: number[][] = [];
  for (const c of CHI) for (const p of PHI) { time.push(p); values.push([c, I(c, p)]); }
  return { time, values, labels: ["Chi", "Intensity"], units: ["deg", "cps"], metadata: { x_column_name: "Phi" } };
};

const cfg = (over: Partial<PolarMatrixConfig> = {}): PolarMatrixConfig => ({ ...emptyMatrixConfig(), rowsAre: "chi", ...over });
const opts = { title: "t", filename: "f" };

describe("polar map matrix input", () => {
  it("renders the same request (so the same grid) as the equivalent long-format input", () => {
    const m = matrixToPolarData(matrixChiRows(), cfg());
    expect(m.problem).toBeUndefined();
    const fromMatrix = buildPolarMapRequest(m.data!, guessPolarPicks(m.data!), opts);
    const long = longForm();
    const fromLong = buildPolarMapRequest(long, guessPolarPicks(long), opts);
    expect(fromMatrix.problem).toBeNull();
    // Same body except the unit label of the unrolled dataset, which both carry as "cps"/"deg".
    expect(fromMatrix.spec).toEqual(fromLong.spec);
  });

  it("reads rows as azimuth when asked (transposed matrix gives the same points)", () => {
    const t: DataStruct = {
      time: PHI,
      values: PHI.map((p) => CHI.map((c) => I(c, p))),
      labels: CHI.map(String),
      units: CHI.map(() => "cps"),
      metadata: { x_column_name: "Phi" },
    };
    const m = matrixToPolarData(t, cfg({ rowsAre: "phi" }));
    const sortKey = (d: DataStruct) => d.time.map((p, i) => `${p}|${d.values[i]![0]}|${d.values[i]![1]}`).sort();
    expect(sortKey(m.data!)).toEqual(sortKey(longForm()));
  });

  it("takes axes from start/step when the headers or X column are not angles", () => {
    const d = { ...matrixChiRows(), time: CHI.map((_, i) => i), labels: PHI.map((_, i) => `c${i}`) };
    const m = matrixToPolarData(d, cfg({ rows: { from: "range", start: "0", step: "15" }, cols: { from: "range", start: "0", step: "30" } }));
    const fromRange = buildPolarMapRequest(m.data!, guessPolarPicks(m.data!), opts);
    const long = longForm();
    expect(fromRange.spec?.dataset.values).toEqual(long.values);
    expect(fromRange.spec?.dataset.time).toEqual(long.time);
  });

  it("refuses with a reason: unchosen role, bad headers, uneven or reversed-duplicate axes, bad step", () => {
    expect(matrixToPolarData(matrixChiRows(), cfg({ rowsAre: "" })).problem).toMatch(/which angle/);
    expect(matrixToPolarData({ ...matrixChiRows(), labels: PHI.map((_, i) => `col${i}`) }, cfg()).problem).toMatch(/headers are not usable/);
    const uneven = { ...matrixChiRows(), time: [0, 15, 30, 50, 60, 75, 90] };
    expect(matrixToPolarData(uneven, cfg()).problem).toMatch(/unevenly spaced/);
    const dup = { ...matrixChiRows(), time: [0, 15, 15, 45, 60, 75, 90] };
    expect(matrixToPolarData(dup, cfg()).problem).toMatch(/Row axis/);
    expect(matrixToPolarData(matrixChiRows(), cfg({ cols: { from: "range", start: "0", step: "0" } })).problem).toMatch(/non-zero/);
    expect(matrixToPolarData(matrixChiRows(), cfg({ rows: { from: "range", start: "", step: "5" } })).problem).toMatch(/start/);
  });

  it("still applies the existing tilt range refusal downstream", () => {
    const d = { ...matrixChiRows(), time: [0, 30, 60, 90, 120, 150, 180] };
    const m = matrixToPolarData(d, cfg());
    expect(buildPolarMapRequest(m.data!, guessPolarPicks(m.data!), opts).problem).toMatch(/0-90/);
  });
});
