// lib/params.coerceParams — the last chokepoint between ParamDialog's local
// `values` state and a command that consumes the resolved params. P0.4
// finding 15 (2026-07-27): a ParamDialog render race (see
// components/overlays/ParamDialog.tsx's header comment) could hand
// runExportFigureCommand a `values` object missing every key except the one
// just edited; `(params.x_label as string).trim()` then threw on `undefined`
// OUTSIDE exportActive's own try/catch, and that rejection was swallowed by
// store/commands.ts's runAction — a silent "Export figure…" hang with zero
// network activity, no toast, no console error. The race itself is fixed at
// its source (ParamDialog now resets `values` synchronously during render,
// so no partial shape can reach coerceParams from THAT path any more), but
// coerceParams staying defensive protects every OTHER askParams() caller
// too — this is the "shape-safe for every format, not a special case" fix.

import { describe, expect, it } from "vitest";

import { coerceParams, type ParamField, type ParamValues } from "./params";

const FIELDS: ParamField[] = [
  { key: "fmt", label: "Format", type: "select", default: "pdf", options: ["pdf", "svg", "png", "tiff"] },
  { key: "style", label: "Style", type: "select", default: "default", options: ["default", "aps"] },
  { key: "dpi", label: "DPI", type: "number", default: 300 },
  { key: "title", label: "Title", type: "text", default: "" },
  { key: "x_label", label: "X label", type: "text", default: "" },
  { key: "y_label", label: "Y label", type: "text", default: "" },
];

describe("coerceParams", () => {
  it("returns every field's default when values is empty (the pre-effect-flush shape)", () => {
    const out = coerceParams({}, FIELDS);
    expect(out).toEqual({
      fmt: "pdf",
      style: "default",
      dpi: 300,
      title: "",
      x_label: "",
      y_label: "",
    });
  });

  it("fills in ONLY the missing keys when values has a partial edit (the exact race shape observed live: {fmt: 'svg'})", () => {
    const out = coerceParams({ fmt: "svg" }, FIELDS);
    expect(out).toEqual({
      fmt: "svg", // the user's edit survives
      style: "default",
      dpi: 300,
      title: "",
      x_label: "",
      y_label: "",
    });
  });

  it("still coerces an in-progress number string, falling back to the field default on non-finite input", () => {
    expect(coerceParams({ dpi: "600" }, FIELDS).dpi).toBe(600);
    expect(coerceParams({ dpi: "not-a-number" }, FIELDS).dpi).toBe(300);
  });

  it("preserves a legitimately-typed 0 (must not fall back to the default via `Number(v) || default`)", () => {
    const fields: ParamField[] = [{ key: "n", label: "N", type: "number", default: 42 }];
    expect(coerceParams({ n: "0" }, fields).n).toBe(0);
  });

  it("never drops a key that IS present in values, even if it equals the field's own default", () => {
    const out = coerceParams({ fmt: "pdf" }, FIELDS);
    expect(out.fmt).toBe("pdf");
    expect(Object.keys(out)).toHaveLength(FIELDS.length);
  });

  it("output always has exactly one key per field, regardless of how sparse `values` is", () => {
    const partials: ParamValues[] = [{}, { fmt: "svg" }, { fmt: "svg", dpi: "150" }, { y_label: "Q (nm^-1)" }];
    for (const partial of partials) {
      const out = coerceParams(partial, FIELDS);
      expect(Object.keys(out).sort()).toEqual(FIELDS.map((f) => f.key).sort());
    }
  });
});
