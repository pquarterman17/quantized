import { describe, expect, it } from "vitest";

import type { DataStruct, Dataset } from "../../../lib/types";
import { wavelengthFromMetadata } from "../../../lib/xrdWavelength";
import {
  alignToRows,
  metadataWavelength,
  buildChannel,
  DEFAULT_SETTINGS,
  defaultChannels,
  defaultXKind,
  effectiveWeighting,
  spinFromLabel,
  twoThetaToQ,
  twoThetaWidthToDq,
  type ChannelBinding,
} from "./reflFitData";

function ds(id: string, data: Partial<DataStruct>, extra: Partial<Dataset> = {}): Dataset {
  return {
    id,
    name: id,
    data: { time: [], values: [], labels: [], units: [], metadata: {}, ...data },
    ...extra,
  } as Dataset;
}

const BIND: ChannelBinding = { datasetId: "a", rCol: 0, drCol: 1, dqCol: 2, dqIsFwhm: false, spin: "none" };

// q, then [R, dR, dQ] per row. Row 1 is non-finite, row 3 has R <= 0, row 5 is out of window.
const DATA: DataStruct = {
  time: [0.01, 0.02, 0.03, 0.04, 0.05, 0.3],
  values: [
    [1.0, 0.01, 1e-4],
    [Number.NaN, 0.01, 1e-4],
    [0.5, 0.005, 2e-4],
    [0, 0.001, 2e-4],
    [0.1, 0.002, 3e-4],
    [1e-6, 1e-7, 3e-4],
  ],
  labels: ["R", "dR", "dQ"],
  units: ["", "", "1/A"],
  metadata: {},
};

describe("metadataWavelength", () => {
  // The restated copy must agree with the app's one resolver on every edge
  // (see reflFitData.ts for why it is restated); the real one is the oracle.
  it.each([
    [undefined],
    [{}],
    [{ wavelength_a: 1.540598 }],
    [{ alpha_average: 1.5418 }],
    [{ wavelength_a: 1.540598, alpha_average: 1.5418 }],
    [{ wavelength_a: null, alpha_average: 0.7107 }],
    [{ wavelength_a: "0.7093" }],
    [{ wavelength_a: 0.15406 }], // nm by mistake: refused
    [{ wavelength_a: 154.06 }], // pm by mistake: refused
    [{ wavelength_a: 0.2 }],
    [{ wavelength_a: 10 }],
    [{ wavelength_a: 0.19999 }],
    [{ wavelength_a: 10.0001 }],
    [{ wavelength_a: 0, alpha_average: 1.5418 }],
    [{ wavelength_a: Number.NaN }],
    [{ wavelength_a: "abc" }],
    [{ k_alpha1: 1.5406 }], // no parser writes it; neither resolver reads it
  ] as [Record<string, unknown> | undefined][])("agrees with lib/xrdWavelength for %j", (meta) => {
    expect(metadataWavelength(meta)).toBe(wavelengthFromMetadata(meta));
  });
});

describe("2θ → Q", () => {
  it("matches a hand value: Cu Kα1, 2θ = 2° → Q = 4π/λ·sin 1°", () => {
    // 4π/1.5406 · sin(1°) = 0.142355840…  (computed independently)
    expect(twoThetaToQ(2, 1.5406)).toBeCloseTo(0.14235584019, 10);
    expect(twoThetaToQ(0, 1.5406)).toBe(0);
  });

  it("converts a 2θ width to a Q width at the local angle", () => {
    // 4π/λ · cos(1°) · (0.01°/2 in rad) = 7.11707e-4
    expect(twoThetaWidthToDq(2, 0.01, 1.5406)).toBeCloseTo(7.117069260558e-4, 12);
  });
});

describe("buildChannel", () => {
  it("sends only usable points and records their dataset rows", () => {
    const b = buildChannel(DATA, new Set(), BIND, { ...DEFAULT_SETTINGS, qMax: 0.1 }, "dr", null, "x");
    expect(b.rows).toEqual([0, 2, 3, 4]); // R = 0 is fine for dR weighting
    expect(b.channel.q).toEqual([0.01, 0.03, 0.04, 0.05]);
    expect(b.channel.dr).toEqual([0.01, 0.005, 0.001, 0.002]);
    expect(b.channel.q_max).toBe(0.1);
  });

  it("drops R <= 0 for log weighting and does not send dR", () => {
    const b = buildChannel(DATA, new Set(), BIND, { ...DEFAULT_SETTINGS, qMax: 0.1 }, "log", null, "x");
    expect(b.rows).toEqual([0, 2, 4]);
    expect(b.channel.dr).toBeNull();
  });

  it("honours excluded/filtered rows", () => {
    const b = buildChannel(DATA, new Set([2]), BIND, DEFAULT_SETTINGS, "dr", null, "x");
    expect(b.rows).not.toContain(2);
  });

  it("never sends a dQ column and a dQ/Q resolution together", () => {
    const withCol = buildChannel(DATA, new Set(), BIND, { ...DEFAULT_SETTINGS, resolution: 0.02 }, "dr", null, "x");
    expect(withCol.channel.dq).not.toBeNull();
    expect(withCol.channel.resolution).toBeNull();
    const noCol = buildChannel(DATA, new Set(), { ...BIND, dqCol: null }, { ...DEFAULT_SETTINGS, resolution: 0.02 }, "dr", null, "x");
    expect(noCol.channel.dq).toBeNull();
    expect(noCol.channel.resolution).toBe(0.02);
    expect(noCol.channel.dq_is_fwhm).toBe(false);
    const off = buildChannel(DATA, new Set(), { ...BIND, dqCol: null }, DEFAULT_SETTINGS, "dr", null, "x");
    expect(off.channel.resolution).toBeNull();
  });

  it("carries spin and the FWHM flag", () => {
    const b = buildChannel(DATA, new Set(), { ...BIND, spin: "-", dqIsFwhm: true }, DEFAULT_SETTINGS, "dr", null, "x");
    expect(b.channel.spin).toBe("-");
    expect(b.channel.dq_is_fwhm).toBe(true);
    const n = buildChannel(DATA, new Set(), BIND, DEFAULT_SETTINGS, "dr", null, "x");
    expect(n.channel.spin).toBeNull();
  });

  it("converts 2θ data to Q (and dQ) with the given wavelength", () => {
    const tth: DataStruct = { ...DATA, time: [1, 2, 3], values: [[1, 0.1, 0.01], [0.5, 0.05, 0.01], [0.2, 0.02, 0.01]] };
    const b = buildChannel(tth, new Set(), BIND, { ...DEFAULT_SETTINGS, xKind: "twotheta" }, "dr", 1.5406, "x");
    expect(b.channel.q[1]).toBeCloseTo(0.14235584019, 10);
    expect(b.channel.dq![1]).toBeCloseTo(7.117069260558e-4, 12);
  });

  it("refuses 2θ data when the wavelength is unknown", () => {
    expect(() => buildChannel(DATA, new Set(), BIND, { ...DEFAULT_SETTINGS, xKind: "twotheta" }, "dr", null, "x")).toThrow(
      /wavelength is unknown/,
    );
  });

  it("refuses a window with fewer than two usable points", () => {
    expect(() =>
      buildChannel(DATA, new Set(), BIND, { ...DEFAULT_SETTINGS, qMin: 0.045, qMax: 0.06 }, "dr", null, "x"),
    ).toThrow(/fewer than 2/);
  });
});

describe("effectiveWeighting / alignToRows", () => {
  it("falls back to log unless every channel has dR", () => {
    expect(effectiveWeighting("dr", [BIND])).toBe("dr");
    expect(effectiveWeighting("dr", [BIND, { ...BIND, drCol: null }])).toBe("log");
    expect(effectiveWeighting("log", [BIND])).toBe("log");
  });

  it("maps the fitted curve back to dataset rows, null elsewhere", () => {
    const sent = { q: [0.01, 0.03, 0.04, 0.05], rows: [0, 2, 3, 4] };
    // the backend dropped q = 0.04 (its own mask) — alignment walks by value
    const y = alignToRows({ q: [0.01, 0.03, 0.05], model: [0.9, 0.4, null] }, sent, 6);
    expect(y).toEqual([0.9, null, 0.4, null, null, null]);
  });
});

describe("prefill", () => {
  it("binds an NCNR .refl from its recorded error roles", () => {
    const refl = ds(
      "r",
      { labels: ["Intensity", "uncertainty", "resolution"], units: ["arb. units", "arb. units", "1/Ang"], metadata: { x_column_unit: "1/Ang" } },
      {
        errorRoles: [
          { channel: 1, target: 0, axis: "y", side: "both" },
          { channel: 2, target: -1, axis: "x", side: "both" },
        ],
      },
    );
    expect(defaultChannels(refl)).toEqual([
      { datasetId: "r", rCol: 0, drCol: 1, dqCol: 2, dqIsFwhm: false, spin: "none" },
    ]);
    expect(defaultXKind(refl.data)).toBe("q");
  });

  it("splits an NCNR .pnr into one channel per spin state", () => {
    const pnr = ds("p", {
      labels: ["dQ", "Rpp", "dRpp", "Rmm", "dRmm"],
      units: ["A-1", "arb. units", "arb. units", "arb. units", "arb. units"],
    });
    expect(defaultChannels(pnr)).toEqual([
      { datasetId: "p", rCol: 1, drCol: 2, dqCol: 0, dqIsFwhm: false, spin: "+" },
      { datasetId: "p", rCol: 3, drCol: 4, dqCol: 0, dqIsFwhm: false, spin: "-" },
    ]);
  });

  it("reads spin from reflectometry labels", () => {
    expect(spinFromLabel("R++")).toBe("+");
    expect(spinFromLabel("Rmm")).toBe("-");
    expect(spinFromLabel("Rpm")).toBe("none");
    expect(spinFromLabel("Intensity")).toBe("none");
  });

  it("treats an XRD pattern with a wavelength as 2θ", () => {
    expect(defaultXKind({ ...DATA, metadata: { wavelength_a: 1.5406 } })).toBe("twotheta");
  });
});
