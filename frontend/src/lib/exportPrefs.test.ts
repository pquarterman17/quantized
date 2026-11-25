// PREFS_AUDIT lane 2: export defaults. Vector stays the default; every default
// is today's behaviour; a style preset's calibrated DPI WINS over the pref
// (owner decision 2026-11-25).

import { afterEach, describe, expect, it } from "vitest";

import { act, renderHook } from "@testing-library/react";

import {
  EXPORT_PREF_DEFAULTS,
  exportDpiFor,
  exportFormatFor,
  exportPrefsSlot,
  seedDocumentOutput,
  withExportPrefs,
} from "./exportPrefs";
import { writePrefSlot } from "./prefSlots";
import { useFigureBuilder } from "../components/workshops/figurebuilder/useFigureBuilder";
import { FIGURE_STYLE_DPI } from "./figureStyleDpi";

afterEach(() => exportPrefsSlot.reset());
const save = (patch: Partial<typeof EXPORT_PREF_DEFAULTS>) => exportPrefsSlot.save({ ...EXPORT_PREF_DEFAULTS, ...patch });

describe("defaults reproduce today's behaviour", () => {
  it("vector PDF, default style, no DPI pref, opaque, live text", () => {
    expect(EXPORT_PREF_DEFAULTS).toEqual({ format: "pdf", stylePreset: "default", dpi: 0, transparent: false, textAsPaths: false });
    expect(exportFormatFor()).toBe("pdf");
  });

  it("every surface keeps its own legacy DPI", () => {
    expect(exportDpiFor("default")).toBe(200); // the Figure Builder
    expect(exportDpiFor("default", 300)).toBe(300); // the quick Export dialog
    expect(exportDpiFor("aps", 300)).toBe(600);
    expect(exportDpiFor("not-a-style")).toBeUndefined();
  });

  it("a request is returned untouched (byte-identical)", () => {
    const body = { fmt: "svg", y_keys: [0] };
    expect(withExportPrefs(body)).toBe(body);
  });
});

describe("each pref applies", () => {
  it("default format, with a fallback to PDF where a panel lacks it", () => {
    save({ format: "svg" });
    expect(exportFormatFor()).toBe("svg");
    save({ format: "tiff" });
    expect(exportFormatFor(["pdf", "svg", "png"])).toBe("pdf");
  });

  it("transparent background and text-as-paths ride the request, only where unset", () => {
    save({ transparent: true, textAsPaths: true });
    expect(withExportPrefs({ fmt: "svg" })).toEqual({ fmt: "svg", transparent: true, svg_text_as_paths: true });
    expect(withExportPrefs({ fmt: "pdf" })).toEqual({ fmt: "pdf", transparent: true }); // paths are SVG-only
    expect(withExportPrefs({ fmt: "svg", transparent: false, svg_text_as_paths: false })).toEqual({
      fmt: "svg", transparent: false, svg_text_as_paths: false, // an explicit choice wins
    });
  });

  it("a stored value that is out of range or the wrong type fails closed", () => {
    writePrefSlot("qz.exportPrefs", { format: "gif", stylePreset: "nope", dpi: 5, transparent: "yes", textAsPaths: 1 });
    expect(exportPrefsSlot.load()).toEqual(EXPORT_PREF_DEFAULTS);
  });

});

describe("a style preset's calibrated DPI WINS (owner decision 2026-11-25)", () => {
  it("the pref applies only where the preset sets none", () => {
    save({ dpi: 450 });
    expect(exportDpiFor("default")).toBe(450); // the uncalibrated baseline
    expect(exportDpiFor("not-a-style")).toBe(450); // no preset DPI at all
    for (const [style, dpi] of Object.entries(FIGURE_STYLE_DPI)) {
      if (style !== "default") expect(exportDpiFor(style), style).toBe(dpi);
    }
  });

  it("the Figure Builder: a pref-set preset keeps its own DPI; the pref seeds the default preset", () => {
    save({ dpi: 450 });
    const { result } = renderHook(() => useFigureBuilder());
    expect(result.current.dpi).toBe(450);
    act(() => result.current.setStyle("aps"));
    expect(result.current.dpi).toBe(600); // calibrated wins
    act(() => result.current.setStyle("default"));
    expect(result.current.dpi).toBe(450);
  });

});

describe("a figure document with no output chosen (Publication Preview) reads the prefs", () => {
  const doc = (o: object = {}) => ({ id: "f", output: { format: "pdf", stylePreset: "default", dpi: 300, transparent: false, ...o } });

  it("unset prefs return the document itself", () => {
    const d = doc();
    expect(seedDocumentOutput(d, [])).toBe(d);
    expect(seedDocumentOutput(null, [])).toBeNull();
  });

  it("pristine output is seeded; the stored document is not rewritten", () => {
    save({ format: "svg", transparent: true, dpi: 450 });
    const d = doc();
    expect(seedDocumentOutput(d, [])?.output).toEqual({ format: "svg", stylePreset: "default", dpi: 450, transparent: true });
    expect(d.output.format).toBe("pdf");
  });

  it("a calibrated preset pref brings its own DPI, not the DPI pref", () => {
    save({ stylePreset: "nature", dpi: 450 });
    expect(seedDocumentOutput(doc(), [])?.output).toMatchObject({ stylePreset: "nature", dpi: 600 });
  });

  it("an edited output (touched, or any non-default value) is the document's own", () => {
    save({ format: "svg" });
    const own = doc({ format: "png" });
    expect(seedDocumentOutput(own, [])).toBe(own);
    const d = doc();
    expect(seedDocumentOutput(d, ["format"])?.output.format).toBe("pdf"); // the user picked PDF back on purpose
    expect(seedDocumentOutput(d, ["format"])?.output.transparent).toBe(false); // ...which says nothing about the other fields
    save({ format: "svg", transparent: true });
    expect(seedDocumentOutput(d, ["format"])?.output).toMatchObject({ format: "pdf", transparent: true });
  });
});
