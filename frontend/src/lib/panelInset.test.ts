// Panel insets (#15): the sanitizer (`.dwk`/undo-redo boundary) and the
// export wire builder, same screen/export parity discipline as the
// magnifier inset (`inset.test.ts`). These FAIL without the feature.
import { describe, expect, it } from "vitest";

import { DEFAULT_INSET_AT } from "./inset";
import { panelInsetWire, sanitizePanelInsets, type PanelInset } from "./panelInset";

const AT: PanelInset["at"] = [0.1, 0.2, 0.3, 0.4];

describe("sanitizePanelInsets", () => {
  it("drops a non-array input", () => {
    expect(sanitizePanelInsets(null)).toEqual([]);
    expect(sanitizePanelInsets(undefined)).toEqual([]);
    expect(sanitizePanelInsets("nope")).toEqual([]);
  });

  it("keeps a valid dataset entry and drops a mismatched series length", () => {
    const out = sanitizePanelInsets([
      {
        id: "p1",
        at: AT,
        content: { kind: "dataset", x: [0, 1, 2], series: [{ label: "s", y: [0, 1, 2] }] },
      },
      {
        id: "p2",
        at: AT,
        content: { kind: "dataset", x: [0, 1, 2], series: [{ label: "bad", y: [0, 1] }] },
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("p1");
    expect(out[0].content).toEqual({
      kind: "dataset",
      x: [0, 1, 2],
      series: [{ label: "s", y: [0, 1, 2] }],
    });
  });

  it("keeps a valid image entry and drops a non-data-URL", () => {
    const good = sanitizePanelInsets([
      { id: "p1", at: AT, content: { kind: "image", dataUrl: "data:image/png;base64,AAAA" } },
    ]);
    expect(good).toHaveLength(1);
    const bad = sanitizePanelInsets([
      { id: "p2", at: AT, content: { kind: "image", dataUrl: "not-a-data-url" } },
    ]);
    expect(bad).toHaveLength(0);
  });

  it("keeps a valid table entry and drops an entry with no rows", () => {
    const out = sanitizePanelInsets([
      { id: "p1", at: AT, content: { kind: "table", headers: ["a"], rows: [["1"]] } },
      { id: "p2", at: AT, content: { kind: "table", rows: [] } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toEqual({ kind: "table", headers: ["a"], rows: [["1"]] });
  });

  it("drops an entry missing id/at/content", () => {
    expect(sanitizePanelInsets([{ at: AT, content: { kind: "table", rows: [["1"]] } }])).toEqual([]);
    expect(sanitizePanelInsets([{ id: "p1", content: { kind: "table", rows: [["1"]] } }])).toHaveLength(1);
  });

  it("clamps a malformed placement rather than dropping the entry (lib/inset.ts's clampAt)", () => {
    const out = sanitizePanelInsets([
      { id: "p1", at: null, content: { kind: "table", rows: [["1"]] } },
    ]);
    expect(out[0].at).toEqual(DEFAULT_INSET_AT);
  });

  it("rejects an unknown content kind", () => {
    expect(sanitizePanelInsets([{ id: "p1", at: AT, content: { kind: "bogus" } }])).toEqual([]);
  });
});

describe("panelInsetWire", () => {
  it("wires a dataset panel inset (snake_case scale keys)", () => {
    const p: PanelInset = {
      id: "p1",
      at: AT,
      content: {
        kind: "dataset",
        x: [0, 1],
        series: [{ label: "fit", y: [1, 2], color: "#f00" }],
        xScale: "log",
        legend: true,
        title: "Other",
      },
    };
    expect(panelInsetWire(p)).toEqual({
      at: AT,
      content: {
        kind: "dataset",
        x: [0, 1],
        series: [{ label: "fit", y: [1, 2], color: "#f00" }],
        x_scale: "log",
        legend: true,
        title: "Other",
      },
    });
  });

  it("wires an image panel inset, stripping the data URL prefix and detecting the format", () => {
    const p: PanelInset = {
      id: "p1",
      at: AT,
      content: { kind: "image", dataUrl: "data:image/jpeg;base64,QQ==" },
    };
    expect(panelInsetWire(p)).toEqual({ at: AT, content: { kind: "image", data: "QQ==", format: "jpeg" } });
  });

  it("wires a table panel inset", () => {
    const p: PanelInset = {
      id: "p1",
      at: AT,
      content: { kind: "table", headers: ["a"], rows: [["1"]], title: "Fit" },
    };
    expect(panelInsetWire(p)).toEqual({
      at: AT,
      content: { kind: "table", headers: ["a"], rows: [["1"]], title: "Fit" },
    });
  });
});
