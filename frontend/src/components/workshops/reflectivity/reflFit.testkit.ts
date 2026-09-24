// Shared fixtures for the reflectivity fit-record tests (P2.2 slice 3). Test
// support only: imported by *.test.ts files, never by app code.

import type { ReflFitResult, ReflPosteriorResult } from "../../../lib/api/reflectivity";
import type { Dataset, SldPreset } from "../../../lib/types";
import type { ReflFitRecord } from "./reflFitRecord";

/** The presets the workshop tests serve from a mocked /api/reflectivity/presets. */
export const TEST_PRESETS: SldPreset[] = [
  { name: "Air / Vacuum", formula: "", sldX: 0, sldN: 0, sldImag: 0, density: 0 },
  { name: "Nickel", formula: "Ni", sldX: 7.18e-5, sldN: 9.4e-6, sldImag: 5e-7, density: 8.9 },
  { name: "Silicon", formula: "Si", sldX: 2.007e-5, sldN: 2.073e-6, sldImag: 0, density: 2.33 },
  { name: "Silicon Oxide", formula: "SiO2", sldX: 1.888e-5, sldN: 3.47e-6, sldImag: 0, density: 2.2 },
];

const Q = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06];

/** An NCNR .refl-shaped dataset: Q, then [R, dR, dQ], with the parser's roles. */
export function xrrDataset(id = "xrr", over: Partial<Dataset> = {}): Dataset {
  return {
    id,
    name: "film.refl",
    data: {
      time: Q,
      values: Q.map((q, i) => [1 / (1 + 100 * q * i), 0.01, 1e-4]),
      labels: ["Intensity", "uncertainty", "resolution"],
      units: ["arb. units", "arb. units", "1/Ang"],
      metadata: { x_column_unit: "1/Ang" },
    },
    errorRoles: [
      { channel: 1, target: 0, axis: "y", side: "both" },
      { channel: 2, target: -1, axis: "x", side: "both" },
    ],
    ...over,
  };
}

/** A /api/reflectivity/fit response for the default Air / Ni / Si stack. */
export function fitResponse(over: Partial<ReflFitResult> = {}): ReflFitResult {
  return {
    parameters: [
      { name: "L1.thickness", value: 187.5, stderr: 0.8, vary: true, tie: null, at_bound: false },
      { name: "L1.roughness", value: 15, stderr: null, vary: true, tie: null, at_bound: true },
      { name: "L2.sld", value: 2.1e-5, stderr: null, vary: false, tie: null, at_bound: false },
      { name: "scale", value: 0.97, stderr: 0.01, vary: true, tie: null, at_bound: false },
    ],
    free: ["L1.thickness", "L1.roughness", "scale"],
    correlation: [],
    chi2: 12,
    reduced_chi2: 1.25,
    sum_sq_log: null,
    reduced_sum_sq_log: null,
    n_points: 6,
    n_free: 3,
    success: true,
    message: "converged",
    n_evaluations: 42,
    weighting: "dr",
    curves: [
      { label: "c", spin: null, q: [0.01, 0.03, 0.05], r: [1, 0.5, 0.2], dr: [0.01, 0.01, 0.01], model: [0.9, 0.4, 0.1], residual: [] },
    ],
    sld_profiles: [{ spin: null, z: [-10, 0, 10], sld: [0, 7e-5, 2e-5] }],
    warnings: ["parameters ended on a bound (errors not reported): L1.roughness"],
    ...over,
  };
}

/** A complete record: a free thickness and background, a tied and a fixed
 *  parameter with infinite bounds, a null stderr, and -0 in the model. */
export function makeRecord(over: Partial<ReflFitRecord> = {}, datasetIds: string[] = ["xrr"]): ReflFitRecord {
  return {
    version: 1,
    id: "rfit-abc-1",
    seq: 1,
    fittedAt: "2026-09-24T10:00:00.000Z",
    request: {
      parameters: [
        { name: "L1.thickness", value: 200, vary: true, min: 100, max: 300, tie: null },
        { name: "L1.roughness", value: 5, vary: false, min: -Infinity, max: Infinity, tie: null },
        { name: "L2.roughness", value: 3, vary: false, min: 0, max: 15, tie: "L1.roughness" },
        { name: "scale", value: 1, vary: false, min: 0.5, max: 2, tie: null },
        { name: "background", value: 0, vary: true, min: 0, max: 1e-4, tie: null },
      ],
      channels: datasetIds.map((id, i) => ({
        datasetId: id,
        rCol: 0,
        drCol: 1,
        dqCol: null,
        dqIsFwhm: false,
        spin: datasetIds.length > 1 ? (i === 0 ? "+" : "-") : "none",
        datasetName: `${id}.refl`,
        rLabel: "R",
        drLabel: "dR",
        dqLabel: null,
        lambda: null,
        digest: "abc",
      })),
      settings: { xKind: "q", lambda: null, qMin: 0.01, qMax: null, weighting: "dr", resolution: 0 },
      weighting: "dr",
    },
    model: {
      layers: [
        { preset: "Air / Vacuum", thickness: 0, roughness: 0, sld: 0 },
        { preset: "Nickel", thickness: 200, roughness: 5, sld: 0 },
        { preset: "Silicon", thickness: 0, roughness: 3, sld: 0, isld: 0, msld: -0 },
      ],
      radiation: "xray",
    },
    result: {
      parameters: [
        { name: "L1.thickness", value: 187.5, stderr: 0.8, vary: true, tie: null, at_bound: false },
        { name: "L1.roughness", value: 5, stderr: null, vary: false, tie: null, at_bound: false },
        { name: "background", value: 1e-7, stderr: null, vary: true, tie: null, at_bound: true },
      ],
      free: ["L1.thickness", "background"],
      correlation: [
        [1, null],
        [null, 1],
      ],
      chi2: 12,
      reduced_chi2: 1.25,
      sum_sq_log: null,
      reduced_sum_sq_log: null,
      n_points: 60,
      n_free: 2,
      success: true,
      message: "ok",
      n_evaluations: 42,
      weighting: "dr",
      warnings: ["parameters ended on a bound (errors not reported): background"],
      objective: { label: "reduced χ²", value: 1.25 },
    },
    ...over,
  };
}

/** A two-column (R, dR) dataset, optionally carrying stored fit records. */
export function makeDataset(id: string, reflFits?: unknown[]): Dataset {
  return {
    id,
    name: `${id}.refl`,
    data: { time: [0.01, 0.02], values: [[1, 0.1], [0.5, 0.1]], labels: ["R", "dR"], units: ["", ""], metadata: {} },
    ...(reflFits ? { reflFits } : {}),
  };
}

/** A finished DREAM job's result for `makeRecord` (P2.2 slice 4): one
 *  well-mixed parameter, one flagged at a bound, and one null band point. */
export function dreamResult(over: Partial<ReflPosteriorResult> = {}): ReflPosteriorResult {
  return {
    parameters: [
      { name: "L1.thickness", tie: null, median: 187.4, interval68: [186.6, 188.2], interval95: [185.9, 189], map: 187.5, rhat: 1.01, rhat_flag: false, at_bound: false },
      { name: "background", tie: null, median: 1e-7, interval68: [0, 2e-7], interval95: [0, 4e-7], map: 1e-7, rhat: 1.4, rhat_flag: true, at_bound: true },
    ],
    free: ["L1.thickness", "background"],
    correlation: [
      [1, -0.3],
      [-0.3, 1],
    ],
    map_chi2: 12.1,
    n_points: 60,
    convergence: {
      converged: false, rhat_threshold: 1.2, rhat_max: 1.4, flagged: ["background"], stopped: "completed",
      burn: 200, burn_requested: 200, thin: 1, n_chains: 10, n_generations: 1200, n_generations_requested: 1200,
      n_draws: 10000, n_band_draws: 200, n_evaluations: 12050, seed: 1, reproducible: true,
    },
    r_bands: [
      { label: "c", spin: null, q: [0.01, 0.02], r: [1, 0.5], dr: [0.01, 0.01], lo95: [0.9, 0.4], lo68: [0.95, 0.45], median: [1, 0.5], hi68: [1.05, 0.55], hi95: [1.1, null] },
    ],
    sld_bands: [{ spin: null, z: [-10, 0, 10], lo95: [0, 1, 2], lo68: [0, 1, 2], median: [0, 1, 2], hi68: [0, 1, 2], hi95: [0, 1, 2] }],
    warnings: ["R-hat above 1.2 (the chains have not mixed) for: background; sample longer or constrain the model"],
    ...over,
  };
}
