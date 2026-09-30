// Spin asymmetry, pure half: reading one spin channel (R and its dR) from a
// dataset, pairing R++ with R-- on one shared Q grid (refused, never
// resampled, when the grids differ), and the derived SA(Q) dataset with its
// error binding and provenance.

import { describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { asymmetryStruct, defaultChannels, pairChannels, readChannel, spinRequest } from "./spinAsymmetry";

function ds(id: string, q: number[], cols: Record<string, number[]>): Dataset {
  const labels = Object.keys(cols);
  return {
    id, name: `${id}.datA`,
    data: {
      time: q, values: q.map((_, i) => labels.map((l) => cols[l][i])), labels,
      units: labels.map(() => ""), metadata: { x_column_name: "Q", x_column_unit: "1/Å" },
    },
  };
}

const PP = ds("pp", [0.01, 0.02, 0.03], { R: [0.9, 0.5, 0.1], dR: [0.01, 0.01, 0.01] });
const MM = ds("mm", [0.01, 0.02, 0.03], { R: [0.7, 0.5, 0.3], dR: [0.02, 0.02, 0.02] });

describe("defaultChannels", () => {
  it("picks the first value column and the error column bound to it", () => {
    expect(defaultChannels(PP)).toEqual({ col: 0, errCol: 1 });
    expect(defaultChannels(ds("x", [1], { R: [1] }))).toEqual({ col: 0, errCol: null });
  });
});

describe("readChannel + pairChannels", () => {
  it("pairs two channels on one Q grid, carrying dR", () => {
    const pair = pairChannels(readChannel(PP, 0, 1), readChannel(MM, 0, 1));
    expect(pair).toEqual({
      q: [0.01, 0.02, 0.03], rpp: [0.9, 0.5, 0.1], rmm: [0.7, 0.5, 0.3],
      dpp: [0.01, 0.01, 0.01], dmm: [0.02, 0.02, 0.02],
    });
  });

  it("drops rows with no finite Q, and sends no dR when a channel has none", () => {
    const gap = ds("g", [0.01, Number.NaN, 0.03], { R: [1, 2, 3] });
    expect(readChannel(gap, 0, null)).toEqual({ q: [0.01, 0.03], r: [1, 3], dr: null });
    const pair = pairChannels(readChannel(gap, 0, null), readChannel(ds("h", [0.01, 0.03], { R: [4, 5] }), 0, null));
    expect(pair).not.toHaveProperty("error");
    expect(pair).toMatchObject({ dpp: undefined, dmm: undefined });
  });

  it("refuses channels on different Q grids, never resampling them", () => {
    const other = ds("o", [0.01, 0.025, 0.03], { R: [1, 1, 1] });
    expect(pairChannels(readChannel(PP, 0, null), readChannel(other, 0, null)))
      .toEqual({ error: "R++ and R-- are on different Q grids; interpolate one onto the other first" });
  });
});

describe("spinRequest", () => {
  it("sends only rows JSON can carry and remembers where they sit", () => {
    const { body, rows } = spinRequest({
      q: [1, 2, 3], rpp: [0.9, Number.NaN, 0.1], rmm: [0.7, 0.5, 0.3], dpp: [0.01, 0.01, 0.01],
    });
    expect(rows).toEqual([0, 2]);
    expect(body).toEqual({ r_pp: [0.9, 0.1], r_mm: [0.7, 0.3], dr_pp: [0.01, 0.01] });
  });
});

describe("asymmetryStruct", () => {
  it("is SA with dSA bound as its error, on Q, recording both sources", () => {
    const { data, errorRoles } = asymmetryStruct(
      [0.01, 0.02, 0.03], [0, 2], { asymmetry: [0.125, null], d_asymmetry: [0.01, null], n_valid: 1 },
      { pp: { dataset: PP, col: 0 }, mm: { dataset: MM, col: 0 } },
    );
    expect(data.time).toEqual([0.01, 0.02, 0.03]);
    expect(data.values).toEqual([[0.125, 0.01], [Number.NaN, Number.NaN], [Number.NaN, Number.NaN]]);
    expect(data.labels).toEqual(["SA", "dSA"]);
    expect(data.metadata).toMatchObject({
      reduction: "spin_asymmetry", x_column_name: "Q", x_column_unit: "1/Å",
      spinAsymmetry: {
        formula: "(R++ - R--)/(R++ + R--)", n_valid: 1,
        pp: { id: "pp", name: "pp.datA", channel: "R" }, mm: { id: "mm", name: "mm.datA", channel: "R" },
      },
    });
    expect(errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });
});
