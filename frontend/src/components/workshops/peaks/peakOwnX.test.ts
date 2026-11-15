// Peak tools and the batch channel pickers follow a secondary-X Y's OWN X:
// points, the full-length overlay axis, the recorded x channel and the batch
// column names (T1,R1,T2,R2 with plot X = T1).
import { describe, expect, it } from "vitest";

import { R2, T2, t1r1t2r2 } from "../../../test/ownXFixture";
import { batchChannels } from "../peakwizard/peakBatchPrep";
import { integrateChannels, seriesFor } from "./batchIntegrate";
import { peakInputs } from "./peakInputs";

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
