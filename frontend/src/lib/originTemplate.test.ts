// MAIN_PLAN #5 (.otp/.otpu template import, frontend half): the upload client,
// the GraphTemplate sanitizer + provenance tag, the never-clobber unique
// naming, and the file-open branch (importOriginTemplateFiles — what the
// App.tsx "Import Origin template…" command runs) landing results in the SAME
// localStorage-backed graph-templates store the Figure Builder reads.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadGraphTemplates, saveGraphTemplate } from "./figuredoc";
import {
  importOriginTemplateFile,
  importOriginTemplateFiles,
  sanitizeImportedTemplate,
  uniqueTemplateName,
  uploadOriginTemplate,
} from "./originTemplate";

// The backend route's real response shape (routes/import_template.py →
// io/origin_project/templates.py::read_origin_template).
const WIRE = {
  name: "SLD_DoubleY",
  style: "default",
  overrides: { x_lim: [0, 1], legend: { show: true, loc: "upper right" } },
  seriesStyles: [{ color: "#FF0000", width: 0, marker: true }, null],
};

function stubFetchOk(body: unknown) {
  const mock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function stubFetch422(detail: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      json: () => Promise.resolve({ detail }),
    }),
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("sanitizeImportedTemplate", () => {
  it("passes a template-shaped response through and tags its provenance", () => {
    const t = sanitizeImportedTemplate(WIRE, "fallback");
    expect(t).toEqual({ ...WIRE, source: "origin" });
  });

  it("keeps honestly-partial responses partial (null overrides/seriesStyles)", () => {
    const t = sanitizeImportedTemplate(
      { name: "PNR", style: "default", overrides: null, seriesStyles: [{ color: "#000000" }] },
      "fallback",
    );
    expect(t?.overrides).toBeNull();
    expect(t?.seriesStyles).toHaveLength(1);
  });

  it("falls back to the file stem when the response has no usable name", () => {
    expect(sanitizeImportedTemplate({ style: "default" }, "MyTemplate")?.name).toBe("MyTemplate");
  });

  it("rejects non-template shapes", () => {
    expect(sanitizeImportedTemplate(null, "x")).toBeNull();
    expect(sanitizeImportedTemplate([1, 2], "x")).toBeNull();
    expect(sanitizeImportedTemplate("nope", "x")).toBeNull();
    expect(sanitizeImportedTemplate({}, "")).toBeNull(); // no name anywhere
  });
});

describe("uniqueTemplateName", () => {
  it("keeps an unclaimed name", () => {
    expect(uniqueTemplateName("a", new Set(["b"]))).toBe("a");
  });

  it("numbers a clash without ever reusing a taken candidate", () => {
    expect(uniqueTemplateName("a", new Set(["a"]))).toBe("a (2)");
    expect(uniqueTemplateName("a", new Set(["a", "a (2)"]))).toBe("a (3)");
  });
});

describe("importOriginTemplateFile (upload → sanitize → store)", () => {
  it("uploads to the template route and lands the tagged template in the saved store", async () => {
    const mock = stubFetchOk(WIRE);
    const file = new File(["bytes"], "SLD_DoubleY.otp");
    const t = await importOriginTemplateFile(file);
    expect(mock).toHaveBeenCalledWith(
      "/api/import/template/upload",
      expect.objectContaining({ method: "POST" }),
    );
    expect(t.name).toBe("SLD_DoubleY");
    expect(t.source).toBe("origin");
    const stored = loadGraphTemplates();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual({ ...WIRE, source: "origin" });
  });

  it("re-importing appends a numbered copy instead of clobbering the earlier import", async () => {
    stubFetchOk(WIRE);
    await importOriginTemplateFile(new File(["b"], "SLD_DoubleY.otp"));
    const second = await importOriginTemplateFile(new File(["b"], "SLD_DoubleY.otp"));
    expect(second.name).toBe("SLD_DoubleY (2)");
    expect(loadGraphTemplates().map((t) => t.name)).toEqual(["SLD_DoubleY", "SLD_DoubleY (2)"]);
  });

  it("never overwrites a USER-saved template with the same name", async () => {
    saveGraphTemplate({ name: "SLD_DoubleY", style: "aps", overrides: null, seriesStyles: null });
    stubFetchOk(WIRE);
    await importOriginTemplateFile(new File(["b"], "SLD_DoubleY.otp"));
    const byName = Object.fromEntries(loadGraphTemplates().map((t) => [t.name, t]));
    expect(byName["SLD_DoubleY"].style).toBe("aps"); // the user's, untouched
    expect(byName["SLD_DoubleY (2)"].source).toBe("origin");
  });

  it("surfaces the backend's 422 detail (honest decode failures)", async () => {
    stubFetch422("no graph layer or curve style could be decoded");
    await expect(importOriginTemplateFile(new File(["b"], "workbook.otp"))).rejects.toThrow(
      /no graph layer/,
    );
    expect(loadGraphTemplates()).toHaveLength(0);
  });

  it("rejects a non-template-shaped 200 response without storing anything", async () => {
    stubFetchOk([1, 2, 3]);
    await expect(importOriginTemplateFile(new File(["b"], "t.otpu"))).rejects.toThrow(
      /did not decode/,
    );
    expect(loadGraphTemplates()).toHaveLength(0);
  });
});

describe("importOriginTemplateFiles (the file-open branch)", () => {
  it("imports each picked file independently — one failure never blocks the rest", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(WIRE) })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: () => Promise.resolve({ detail: "not a template" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...WIRE, name: "PNR-SF" }),
      });
    vi.stubGlobal("fetch", mock);
    const imported = await importOriginTemplateFiles([
      new File(["a"], "SLD_DoubleY.otp"),
      new File(["b"], "broken.otp"),
      new File(["c"], "PNR-SF.otpu"),
    ]);
    expect(imported.map((t) => t.name)).toEqual(["SLD_DoubleY", "PNR-SF"]);
    expect(loadGraphTemplates().map((t) => t.name)).toEqual(["SLD_DoubleY", "PNR-SF"]);
  });
});

describe("uploadOriginTemplate", () => {
  it("posts the file's bytes as multipart form data", async () => {
    const mock = stubFetchOk(WIRE);
    await uploadOriginTemplate(new File(["b"], "t.otp"));
    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
  });
});
