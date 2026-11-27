// 3-D bars coloured by a TEXT column of the sheet (`ext.barColText`, by name):
// the panel offers it, the request carries sorted names and a code per kept row,
// and the scene draws palette colours with a legend. The screen/export
// agreement is pinned by the "bars coloured by a text column" case of the
// shared wire fixture (`plot3dKindsFixture.test.ts`, `tests/test_export_plot3d_kinds.py`).

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_MAP3D, sanitizeMap3d, type Map3dView } from "../../../lib/mapView3d";
import type { MapPayload } from "../../../lib/mapdataFetch";
import { useApp } from "../../../store/useApp";
import { mapFigureBody } from "../mapFigureExport";
import { view3dOptions } from "../map3dRequest";
import { readBarText } from "../map3dBarColour";
import Map3dExtFields from "../Map3dExtFields";
import { rgbOf } from "./renderExt3d";
import { hasColorbar, sceneFromBody, type BarScene } from "./scene3d";

const P: MapPayload = {
  xAxis: [0, 1], yAxis: [0, 1], zGrid: [[1, 2], [3, 4]], xLabel: "x", xUnit: "", yLabel: "y", yUnit: "", zLabel: "z", zUnit: "", zMin: 1, zMax: 4,
};
const VIEW = { cmap: "viridis" as const, logZ: false, colorLimits: null, contour: { on: false, levelCount: 0, scale: "linear" as const } };
// Six source rows; the text cell of row 3 is blank and row 4 has a gap in z.
const rows = [[0, 0, 1], [1, 0, 2], [0, 1, 3], [1, 1, 4], [2, 0, Number.NaN], [2, 1, 6]];
const metal = ["Ni", "Fe", "Ni", "", "Co", "Fe"];
const data = (text: Record<string, unknown[]> | undefined, extra: Record<string, unknown> = {}) => ({
  time: rows.map((_, i) => i), values: rows, labels: ["x", "y", "z"], units: ["", "", ""], metadata: text ? { text_columns: text } : {}, ...extra,
});
const body = (ext: Map3dView["ext"], text: Record<string, unknown[]> | undefined = { metal }, logZ = false) => {
  const v3: Map3dView = { ...DEFAULT_MAP3D, kind: "bars3d", ext };
  return mapFigureBody(P, { ...VIEW, logZ, view3d: v3, source: { data: data(text), keys: [0, 1, 2] as const } }, view3dOptions(v3, "png", "t"));
};

describe("the request", () => {
  it("sends sorted names, a code per kept source row, the column's name, and counts the rows left out", () => {
    const b = body({ barColText: "metal" });
    expect(b.bar_group_names).toEqual(["Fe", "Ni"]); // the names of the kept rows only
    // Kept rows 0, 1, 2, 5 (row 3 has a blank cell, row 4 a gap in z); Fe=0, Ni=1.
    expect(b.bar_group).toEqual([1, 0, 1, 0]);
    expect(b.x_axis).toEqual([0, 1, 0, 2]);
    expect(b.bar_group_label).toBe("metal");
    expect(b.bar_cval).toBeUndefined();
    expect(b.note).toContain("2 rows not drawn");
  });

  it("the scene draws palette colours and a legend, no colour bar, one bar per kept row", () => {
    const s = sceneFromBody(body({ barColText: "metal" })) as BarScene;
    expect(s.bx).toHaveLength(4);
    expect(hasColorbar(s)).toBe(false);
    expect(s.colour!.names).toEqual(["Fe", "Ni"]);
    expect(s.colour!.used).toEqual([0, 1]);
    expect(s.colour!.groupLabel).toBe("metal");
    expect(rgbOf(s, 0)).toEqual([255, 127, 14]); // row 0 is Ni, code 1: the palette's second colour
    expect(rgbOf(s, 1)).toEqual([31, 119, 180]); // Fe, code 0
  });

  it("a text column that is gone fails closed: the bars keep their height colouring", () => {
    const b = body({ barColText: "metal" }, { other: metal });
    expect(b.bar_group).toBeUndefined();
    expect(b.bar_cval).toBeUndefined();
  });

  it("a number pick wins over a stored text pick, and a fixed colour with a text pick is refused as the route does", () => {
    expect(readBarText({ barCol: 2, barColText: "metal" })).toBeNull();
    expect(readBarText({ barColText: "metal" })).toBe("metal");
    expect(sceneFromBody(body({ barColText: "metal", barColor: "#112233" }))).toEqual({ error: expect.stringContaining("not both") });
  });

  it("more than ten levels is refused with the count, never recoloured", () => {
    const names = Array.from({ length: 11 }, (_, i) => `L${i}`);
    const r = Array.from({ length: 11 }, (_, i) => [i, 0, i + 1]);
    const v3: Map3dView = { ...DEFAULT_MAP3D, kind: "bars3d", ext: { barColText: "m" } };
    const d = { time: r.map((_, i) => i), values: r, labels: ["x", "y", "z"], units: ["", "", ""], metadata: { text_columns: { m: names } } };
    const b = mapFigureBody(P, { ...VIEW, view3d: v3, source: { data: d, keys: [0, 1, 2] as const } }, view3dOptions(v3, "png", "t"));
    expect(sceneFromBody(b)).toEqual({ error: expect.stringMatching(/1 to 10 colour categories; this column has 11/) });
  });

  it("is stored by its (long) name and survives the sanitiser", () => {
    const ext = { barColText: "sample_material_name" };
    expect(sanitizeMap3d({ kind: "bars3d", ext })?.ext).toEqual(ext);
  });
});

describe("the panel", () => {
  function setup(ext?: Map3dView["ext"], text: Record<string, unknown[]> | null = { metal }) {
    useApp.getState().loadWorkspace({ datasets: [{ id: "d", name: "d.dat", data: data(text ?? undefined) }], activeId: "d" });
    const edit = vi.fn();
    render(<Map3dExtFields datasetId="d" view3d={{ ...DEFAULT_MAP3D, kind: "bars3d", ext }} edit={edit} />);
    return { edit, select: screen.getByLabelText("Bar colour column") as HTMLSelectElement };
  }

  it("lists the sheet's text columns after the numbers, by name", () => {
    const { select } = setup();
    expect(Array.from(select.options).map((o) => o.text)).toEqual(["Height", "X (first column)", "x", "y", "z", "metal (text)"]);
  });

  it("offers none when the sheet has no text column", () => {
    const { select } = setup(undefined, null);
    expect(Array.from(select.options).map((o) => o.text)).not.toContain("metal (text)");
  });

  it("a text pick clears the fixed colour and the number pick; a number pick or Height clears the text pick", () => {
    const a = setup({ barColor: "#4c78a8", barCol: 2, barW: 0.5 });
    fireEvent.change(a.select, { target: { value: "t:metal" } });
    expect(a.edit).toHaveBeenLastCalledWith({ ext: { barW: 0.5, barColText: "metal" } });
  });

  it("shows a stored text pick as the selection; a number pick and Height drop it", () => {
    const { edit, select } = setup({ barColText: "metal" });
    expect(select.value).toBe("t:metal");
    fireEvent.change(select, { target: { value: "3" } });
    expect(edit).toHaveBeenLastCalledWith({ ext: { barCol: 3 } });
    fireEvent.change(select, { target: { value: "" } });
    expect(edit).toHaveBeenLastCalledWith({ ext: undefined });
  });

  it("a fixed colour replaces a text pick", () => {
    const { edit } = setup({ barColText: "metal" });
    fireEvent.click(screen.getByLabelText("Bar colour: fixed colour"));
    expect(edit).toHaveBeenLastCalledWith({ ext: { barColor: "#4c78a8" } });
  });
});
