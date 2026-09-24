// P2.2 slice 4 — the DREAM posterior summary a fit record keeps: what is kept
// (intervals, R-hat, draw counts; never chains or bands), that it round-trips
// through the stored form and a .dwk-style JSON trip, that a record written
// before slice 4 still loads, and that a malformed summary costs the record
// its posterior only.

import { describe, expect, it } from "vitest";

import { bandDatasets, R_BAND_LABELS, SLD_BAND_LABELS } from "./reflDreamBands";
import { dreamResult, makeDataset, makeRecord } from "./reflFit.testkit";
import { decodeRecord, encodeRecord, recordsFor, withFitRecord, withPosterior } from "./reflFitRecord";
import { DREAM_DEFAULTS, decodePosterior, posteriorCaveat, posteriorSummary } from "./reflPosterior";

const RAN = "2026-09-24T12:00:00.000Z";

describe("the posterior summary", () => {
  it("keeps intervals, R-hat and counts — not the chains or the bands", () => {
    const s = posteriorSummary(dreamResult(), DREAM_DEFAULTS, RAN);
    expect(s.parameters[0].interval95).toEqual([185.9, 189]);
    expect(s.convergence).toMatchObject({ n_draws: 10000, n_chains: 10, burn: 200, thin: 1, rhat_max: 1.4, flagged: ["background"] });
    expect(s.settings).toEqual(DREAM_DEFAULTS);
    expect(JSON.stringify(s)).not.toMatch(/r_bands|sld_bands|lo95|median":\[/);
  });

  it("round-trips on its record through the stored form and JSON, NaN and -0 intact", () => {
    const s = posteriorSummary(dreamResult({ map_chi2: Number.NaN }), DREAM_DEFAULTS, RAN);
    s.parameters[1].interval68 = [-0, 2e-7];
    const rec = { ...makeRecord(), posterior: s };
    const back = decodeRecord(JSON.parse(JSON.stringify(encodeRecord(rec))));
    expect(back).toEqual(rec);
    expect(back!.posterior!.map_chi2).toBeNaN();
    expect(Object.is(back!.posterior!.parameters[1].interval68[0], -0)).toBe(true);
  });

  it("a record written before slice 4 loads without a posterior", () => {
    const legacy = encodeRecord(makeRecord());
    expect(legacy).not.toHaveProperty("posterior");
    const back = decodeRecord(legacy);
    expect(back).not.toBeNull();
    expect(back!.posterior).toBeUndefined();
  });

  it("a malformed posterior costs the record its posterior, never the record", () => {
    const good = posteriorSummary(dreamResult(), DREAM_DEFAULTS, RAN);
    for (const bad of [
      "garbage",
      { ...good, parameters: [] },
      { ...good, parameters: [{ ...good.parameters[0], interval95: [1] }] },
      { ...good, convergence: { ...good.convergence, stopped: "exploded" } },
      { ...good, convergence: { ...good.convergence, n_draws: -3 } },
    ]) {
      const stored = { ...(encodeRecord(makeRecord()) as object), posterior: bad };
      const back = decodeRecord(stored);
      expect(back).not.toBeNull();
      expect(back!.posterior).toBeUndefined();
    }
    expect(decodePosterior(undefined)).toBeUndefined();
  });

  it("is attached to every stored copy of its record, without mutating, and nowhere else", () => {
    const rec = makeRecord({}, ["a", "b"]);
    const other = { ...makeRecord(), id: "rfit-other" };
    const before = withFitRecord(withFitRecord([makeDataset("a"), makeDataset("b")], other), rec);
    const snapshot = JSON.stringify(before);
    const s = posteriorSummary(dreamResult(), DREAM_DEFAULTS, RAN);
    const after = withPosterior(before, rec.id, s);
    expect(JSON.stringify(before)).toBe(snapshot);
    for (const d of after) {
      expect(recordsFor(d).find((r) => r.id === rec.id)?.posterior).toEqual(s);
    }
    expect(recordsFor(after[0]).find((r) => r.id === "rfit-other")?.posterior).toBeUndefined();
    expect(withPosterior(before, "rfit-missing", s)).toBe(before);
  });

  it("says plainly when the intervals are not to be trusted", () => {
    const s = posteriorSummary(dreamResult(), DREAM_DEFAULTS, RAN);
    expect(posteriorCaveat(s)).toMatch(/R-hat above 1.2 for background/);
    expect(posteriorCaveat({ convergence: { ...s.convergence, stopped: "deadline" } })).toMatch(/time limit/);
    expect(posteriorCaveat({ convergence: { ...s.convergence, flagged: [], rhat_max: 1.05 } })).toBeNull();
  });
});

describe("uncertainty-band datasets", () => {
  it("carry the percentiles as columns, the fit's provenance and the band's", () => {
    const rec = makeRecord();
    const [r, sld] = bandDatasets(dreamResult(), rec, [makeDataset("xrr")], RAN);
    expect(r.name).toBe("xrr.refl — refl fit #1 R band");
    expect(r.data.labels).toEqual(R_BAND_LABELS);
    expect(r.data.values[0]).toEqual([1, 1, 0.9, 1.1, 0.95, 1.05]);
    expect(r.data.values[1][3]).toBeNaN(); // a null percentile is a gap, not 0
    expect(r.data.metadata.reflFit).toMatchObject({ fitId: rec.id, seq: 1, sourceIds: ["xrr"] });
    expect(r.data.metadata.band).toMatchObject({ percentiles: [2.5, 16, 50, 84, 97.5], draws: 200, ranAt: RAN, converged: false });
    expect(sld.data.labels).toEqual(SLD_BAND_LABELS);
    expect(sld.data.time).toEqual([-10, 0, 10]);
  });
});
