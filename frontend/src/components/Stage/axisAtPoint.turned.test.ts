// Double-clicking an axis gutter on a TURNED plot (horizontal bars / Exchange
// X-Y) opens the axis that is drawn there: the bottom gutter now carries Y, the
// left one X, and Y2 sits across the top.
import { beforeEach, describe, expect, it } from "vitest";

import { useFigureDialog } from "../../store/figureDialogs";
import { axisAtPoint, openAxisAt } from "./axisAtPoint";

const over = { left: 100, right: 500, top: 50, bottom: 300 };
const root = { left: 0, right: 560, top: 0, bottom: 360 };

beforeEach(() => useFigureDialog.setState({ open: null }));

describe("axisAtPoint turned", () => {
  it("bottom = Y, left = X, top = Y2 (only when drawn), right = nothing", () => {
    expect(axisAtPoint(over, root, 300, 330, true, true)).toBe("y");
    expect(axisAtPoint(over, root, 60, 150, true, true)).toBe("x");
    expect(axisAtPoint(over, root, 300, 20, true, true)).toBe("y2");
    expect(axisAtPoint(over, root, 300, 20, false, true)).toBeNull();
    expect(axisAtPoint(over, root, 540, 150, true, true)).toBeNull();
  });
  it("upright is as before", () => {
    expect(axisAtPoint(over, root, 300, 330, true)).toBe("x");
    expect(axisAtPoint(over, root, 60, 150, true)).toBe("y");
  });
});

describe("openAxisAt on an exchanged graph", () => {
  it("the left axis (X) opens the X dialog, the bottom one (Y) the Y dialog", () => {
    openAxisAt(over, root, 60, 150, false, [], true);
    expect(useFigureDialog.getState().open).toEqual({ kind: "axis", axis: "x" });
    openAxisAt(over, root, 300, 330, false, [], true);
    expect(useFigureDialog.getState().open).toEqual({ kind: "axis", axis: "y" });
  });
  it("and upright is as before", () => {
    openAxisAt(over, root, 60, 150, false, []);
    expect(useFigureDialog.getState().open).toEqual({ kind: "axis", axis: "y" });
  });
});
