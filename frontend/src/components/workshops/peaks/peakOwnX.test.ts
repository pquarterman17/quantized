// Peak tools and the batch channel pickers follow a secondary-X Y's OWN X:
// points, the full-length overlay axis, the recorded x channel and the batch
// column names (T1,R1,T2,R2 with plot X = T1).
import { describe, expect, it } from "vitest";

import { R2, T2, t1r1t2r2 } from "../../../test/ownXFixture";
import { batchChannels } from "../peakwizard/peakBatchPrep";
import { integrateChannels, seriesFor } from "./batchIntegrate";
import type { Dataset } from "../../../lib/types";
import { overlayLayout, placeOverlay } from "../../../lib/overlayPlacement";
import { peakBinding, peakInputs } from "./peakInputs";

describe("secondary-X Y in the peak tools", () => {
  it("peakInputs: points, overlay axis and xKeyUsed all come from T2", () => {
    const pi = peakInputs(t1r1t2r2(), null, [2], null);
    expect(pi.x).toEqual(T2);
    expect(pi.y).toEqual(R2);
    expect(pi.fullX).toEqual(T2);
    expect(pi.xKeyUsed).toBe(1);
    expect(pi.yKeyUsed).toBe(2);
  });

  it("peakInputs: an R1 still reports the time axis", () => {
    const pi = peakInputs(t1r1t2r2(), null, [0], null);
    expect(pi.fullX).toEqual([1, 2, 3, 4]);
    expect(pi.xKeyUsed).toBeNull();
  });

  it("fallback (no effective Y): markers sit on the time axis the fit ran on, and the binding says so", () => {
    // Plot X = channel 0 and it is the only value channel, so no Y is effective
    // and the fit falls back to (time, channel 0). The overlay's X is that time
    // column -- not the requested channel-0 column.
    const ds: Dataset = {
      id: "fb",
      name: "fb.csv",
      data: { time: [1, 2, 3], values: [[10], [20], [30]], labels: ["A"], units: [""], metadata: {} },
    };
    const pi = peakInputs(ds, 0, null, null);
    expect(pi.x).toEqual([1, 2, 3]);
    expect(pi.fullX).toEqual([1, 2, 3]);
    expect(pi.xKeyUsed).toBeNull();
    // No Y is shown: the markers belong to no curve (-1), on time.
    expect(peakBinding(pi)).toEqual({ yKey: -1, xKey: null });
  });

  it("fallback markers draw on a view on time and not on a view on another X", () => {
    const ds: Dataset = {
      id: "fb",
      name: "fb.csv",
      data: { time: [1, 2, 3], values: [[10], [20], [30]], labels: ["A"], units: [""], metadata: {} },
    };
    const o = { datasetId: "fb", binding: peakBinding(peakInputs(ds, 0, null, null)), y: [null, 20, null] };
    const view = (xKey: number | null, shown: number[]) => overlayLayout(ds, xKey, undefined, shown);
    expect(placeOverlay(o, view(null, []))).toBe(o);
    expect(placeOverlay(o, view(0, []))).toBeNull();
  });

  it("peakBinding: no value channel is 'no curve' (-1), never channel 0", () => {
    expect(peakBinding({ xKeyUsed: 1, yKeyUsed: null })).toEqual({ yKey: -1, xKey: 1 });
    expect(peakBinding({ xKeyUsed: 1, yKeyUsed: 2 })).toEqual({ yKey: 2, xKey: 1 });
  });

  it("batch integrate: names T2 as X and integrates R2 against T2's rows", () => {
    const ds = t1r1t2r2();
    const ch = integrateChannels(ds, null, [2], null);
    expect(ch).toEqual({ xLabel: "T2", yLabel: "R2", xIndex: 1, yIndex: 2 });
    const s = seriesFor(ds, ch!);
    expect(s.x).toEqual(T2);
    expect(s.y).toEqual(R2);
  });

  it("peak wizard batch: the X it matches by name is T2", () => {
    expect(batchChannels(t1r1t2r2(), null, [2], null)).toEqual({ xLabel: "T2", yLabel: "R2", xIndex: 1, yIndex: 2 });
  });
});
