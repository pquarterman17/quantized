// UX audit 8, lane UX8-A: the first plot a scientist sees is the one they
// would make by hand. Fixtures are shaped like the instrument files they
// stand for (columns, units, magnitudes), built in code so each rule's input
// is visible next to its assertion.
import { describe, expect, it } from "vitest";

import { firstPlot } from "./firstPlot";
import type { DataStruct } from "./types";

const N = 200;
const ramp = (a: number, b: number) => Array.from({ length: N }, (_, i) => a + ((b - a) * i) / (N - 1));

function table(
  x: { name: string; unit: string; v: number[] },
  cols: { name: string; unit: string; v: number[] }[],
  metadata: Record<string, unknown> = {},
): DataStruct {
  return {
    time: x.v,
    values: x.v.map((_, r) => cols.map((c) => c.v[r])),
    labels: cols.map((c) => c.name),
    units: cols.map((c) => c.unit),
    metadata: { x_column_name: x.name, x_column_unit: x.unit, ...metadata },
  };
}

// A VSM loop: Field (Oe) / Moment (emu, ±1.3e-3) / Temperature (300 K ± noise).
const field = ramp(70000, -70000);
const moment = field.map((h) => 1.34e-3 * Math.tanh(h / 2000));
const temp300 = field.map((_, i) => 300 + 0.05 * Math.sin(i));
const VSM = table({ name: "Field", unit: "Oe", v: field }, [
  { name: "Moment", unit: "emu", v: moment },
  { name: "Temperature", unit: "K", v: temp300 },
]);

describe("Y channels by unit group (firstPlot)", () => {
  it("M(H): Moment alone on Y1; the Temperature monitor is left off", () => {
    expect(firstPlot(VSM, null)).toEqual({ yKeys: [0], y2Keys: null, logDecades: 0 });
  });

  it("a PPMS-like wide file: chamber/status/setpoint and a field readback stay off", () => {
    const ds = table({ name: "Temperature", unit: "K", v: ramp(2, 300) }, [
      { name: "Field", unit: "Oe", v: ramp(1000, 1000.0001) },
      { name: "Resistance Ch1", unit: "Ohm", v: ramp(10, 12) },
      { name: "Resistance Ch2", unit: "Ohm", v: ramp(11, 13) },
      { name: "Chamber Pressure", unit: "Torr", v: ramp(5, 6) },
      { name: "Status", unit: "", v: ramp(3, 4) },
      { name: "Sample Temp", unit: "K", v: ramp(2.1, 300.1) },
    ]);
    // Field is constant (a set value), Sample Temp is X's own unit (a readback).
    expect(firstPlot(ds, null).yKeys).toEqual([1, 2]);
    expect(firstPlot(ds, null).y2Keys).toBeNull();
  });

  it("an MPMS file's parser hint wins: no regrouping", () => {
    const ds = { ...VSM, metadata: { ...VSM.metadata, default_value_channels: [0, 1] } };
    expect(firstPlot(ds, null).yKeys).toBeNull();
  });

  it("M(T) ZFC + FC share a unit: both on Y1, nothing changes", () => {
    const t = ramp(2, 300);
    const ds = table({ name: "Temperature", unit: "K", v: t }, [
      { name: "M_ZFC", unit: "emu", v: t.map((x) => 1e-3 / (1 + Math.exp((x - 50) / 10)) + 1e-5) },
      { name: "M_FC", unit: "emu", v: t.map((x) => 1.6e-3 / (1 + Math.exp((x - 120) / 30))) },
    ]);
    expect(firstPlot(ds, null)).toEqual({ yKeys: null, y2Keys: null, logDecades: 0 });
  });

  it("transport R(T) with a second single-column quantity: that one goes on Y2", () => {
    const t = ramp(2, 300);
    const ds = table({ name: "Temperature", unit: "K", v: t }, [
      { name: "Resistance", unit: "ohm", v: t.map((x) => 5 + x / 10) },
      { name: "Voltage", unit: "V", v: t.map((x) => (5 + x / 10) * 1e-6) },
    ]);
    expect(firstPlot(ds, null)).toEqual({ yKeys: null, y2Keys: [1], logDecades: 0 });
  });

  it("a second unit group with several columns is left off, not crammed onto Y2", () => {
    const ds = table({ name: "Field", unit: "T", v: ramp(-9, 9) }, [
      { name: "Rxx", unit: "ohm", v: ramp(10, 12) },
      { name: "Vx", unit: "V", v: ramp(1, 2) },
      { name: "Vy", unit: "V", v: ramp(2, 3) },
    ]);
    expect(firstPlot(ds, null)).toEqual({ yKeys: [0], y2Keys: null, logDecades: 0 });
  });

  it("a logger (time X) plots its temperature and pressure: nothing is a monitor there", () => {
    const ds = table({ name: "Time", unit: "s", v: ramp(0, 3600) }, [
      { name: "Temperature", unit: "K", v: ramp(300, 4) },
      { name: "Pressure", unit: "mbar", v: ramp(1e-3, 1e-6) },
    ]);
    expect(firstPlot(ds, null)).toEqual({ yKeys: null, y2Keys: [1], logDecades: 0 });
  });

  it("a logger in hours ('Elapsed (hr)') is a time X too", () => {
    const ds = table({ name: "Elapsed", unit: "hr", v: ramp(0, 48) }, [
      { name: "Signal", unit: "V", v: ramp(0, 1) },
      { name: "Temperature", unit: "K", v: ramp(300, 4) },
    ]);
    expect(firstPlot(ds, null)).toEqual({ yKeys: null, y2Keys: [1], logDecades: 0 });
  });

  it("monitor names match word starts only, and pressure against T is a measurement", () => {
    const t = ramp(250, 350);
    const ds = table({ name: "Temperature", unit: "K", v: t }, [
      { name: "Vapour Pressure", unit: "Pa", v: t.map((x) => Math.exp(x / 30)) },
      { name: "Attempt", unit: "Pa", v: t.map((x) => x * 2) },
    ]);
    expect(firstPlot(ds, null).yKeys).toBeNull();
  });

  it("a table without units still leaves a temperature monitor off (the only exception)", () => {
    const ds = table({ name: "field", unit: "", v: field }, [
      { name: "moment", unit: "", v: moment },
      { name: "temperature", unit: "", v: temp300.map((x, i) => x + i) },
    ]);
    expect(firstPlot(ds, null).yKeys).toEqual([0]);
  });

  it("an x, y, z map table plots z against x, never y as 50 flat lines", () => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let j = 0; j < 20; j++) for (let i = 0; i < 10; i++) [xs[xs.length], ys[ys.length]] = [i * 0.2, j * 0.2];
    const ds = table({ name: "x", unit: "mm", v: xs }, [
      { name: "y", unit: "mm", v: ys },
      { name: "signal", unit: "V", v: xs.map((x, k) => Math.sin(x) * Math.cos(ys[k])) },
    ]);
    expect(firstPlot(ds, null).yKeys).toEqual([1]);
  });

  it("a table without units is one group: every column, as before", () => {
    const ds = table({ name: "t", unit: "", v: ramp(0, 1) }, [
      { name: "a", unit: "", v: ramp(0, 1) },
      { name: "b", unit: "", v: ramp(5, 9) },
    ]);
    expect(firstPlot(ds, null)).toEqual({ yKeys: null, y2Keys: null, logDecades: 0 });
  });

  it("all monitors: the density default stands rather than an empty plot", () => {
    const ds = table({ name: "Field", unit: "Oe", v: field }, [{ name: "Temperature", unit: "K", v: temp300 }]);
    expect(firstPlot(ds, null).yKeys).toBeNull();
  });

  it("a hidden error column is kept in the Y set and never grouped", () => {
    const ds = table({ name: "Field", unit: "Oe", v: field }, [
      { name: "Moment", unit: "emu", v: moment },
      { name: "Moment err", unit: "emu", v: moment.map(() => 1e-6) },
      { name: "Temperature", unit: "K", v: temp300 },
    ]);
    expect(firstPlot(ds, null, [1]).yKeys).toEqual([0, 1]);
  });

  it("a categorical column leaves the default alone", () => {
    const ds = { ...VSM, cat_levels: { 1: ["a", "b"] } };
    expect(firstPlot(ds, null).yKeys).toBeNull();
  });

  it("honours a chosen X channel: its unit and temperature-ness", () => {
    // X = Temperature (channel 1): Moment plots; no other temperature to hide.
    expect(firstPlot(VSM, 1)).toEqual({ yKeys: null, y2Keys: null, logDecades: 0 });
  });
});

describe("auto log Y (firstPlot.logDecades)", () => {
  it("XRR: reflectivity over ~5 decades opens on log Y", () => {
    const q = ramp(0.01, 0.3);
    const ds = table({ name: "Qz", unit: "1/A", v: q }, [{ name: "R", unit: "", v: q.map((x) => Math.min(1, 2e-8 / x ** 4)) }]);
    expect(firstPlot(ds, null).logDecades).toBeGreaterThan(4);
  });

  it("R(T) through a superconducting transition, positive over 4 decades: log", () => {
    const t = ramp(2, 20);
    const ds = table({ name: "Temperature", unit: "K", v: t }, [
      { name: "Resistance", unit: "Ohm", v: t.map((x) => 1e-3 + 50 / (1 + Math.exp(-(x - 9) / 0.2))) },
    ]);
    expect(firstPlot(ds, null).logDecades).toBeCloseTo(4.7, 1);
  });

  it("the same transition measured with noise about zero stays linear", () => {
    const t = ramp(2, 20);
    const ds = table({ name: "Temperature", unit: "K", v: t }, [
      { name: "Resistance", unit: "Ohm", v: t.map((x, i) => (i % 2 ? -1e-3 : 1e-3) + 50 / (1 + Math.exp(-(x - 9) / 0.2))) },
    ]);
    expect(firstPlot(ds, null).logDecades).toBe(0);
  });

  it("an XRD scan with ~2.4 decades of peaks stays linear; a signed M(H) never logs", () => {
    const tt = ramp(10, 90);
    const ds = table({ name: "2Theta", unit: "deg", v: tt }, [
      { name: "Intensity", unit: "cts", v: tt.map((x) => 31 + 8000 / (1 + ((x - 44) / 0.1) ** 2)) },
    ]);
    expect(firstPlot(ds, null).logDecades).toBe(0);
    expect(firstPlot(VSM, null).logDecades).toBe(0);
  });

  it("only Y1 counts: a wide-span column left off never forces log", () => {
    const ds = table({ name: "Field", unit: "Oe", v: field }, [
      { name: "Moment", unit: "emu", v: moment },
      { name: "Temperature", unit: "K", v: field.map((_, i) => 10 ** (i % 6)) },
    ]);
    expect(firstPlot(ds, null).logDecades).toBe(0);
  });
});
