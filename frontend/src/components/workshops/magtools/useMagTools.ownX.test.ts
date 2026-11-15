// The magnetometry tools read a secondary-X Y against its OWN X column.
import { describe, expect, it } from "vitest";

import { R2, T2, t1r1t2r2 } from "../../../test/ownXFixture";
import { magXY, sourceUnits } from "./useMagTools";

describe("magXY / sourceUnits on a secondary-X Y", () => {
  it("returns T2's values against R2, not the plot's T1", () => {
    const { x, y, yKey } = magXY(t1r1t2r2(), null, [2], null);
    expect({ x, y, yKey }).toEqual({ x: T2, y: R2, yKey: 2 });
  });

  it("takes the field unit from the Y's own X (T2 is Oe; the plot's T1 is K)", () => {
    const ds = t1r1t2r2();
    ds.data = { ...ds.data, labels: ["R1", "Field", "R2"] }; // detectMagXKind needs a field-like name
    expect(sourceUnits(ds, null, [2], null)).toMatchObject({ fromField: "Oe", xLabel: "Field", xUnit: "Oe" });
  });

  it("an R1 read still uses T1", () => {
    expect(magXY(t1r1t2r2(), null, [0], null).x).toEqual([1, 2, 3, 4]);
  });
});
