// P3.6: `/api/report/export` names every figure it could not render or embed
// in `X-Report-Warnings` (a JSON list, capped) + `X-Report-Warning-Count` (the
// true total). `reportExport` must hand those back after saving the file —
// the viewer surfaces them — and a malformed header must never throw once
// the download already happened.

import { afterEach, describe, expect, it, vi } from "vitest";

import { saveBlob } from "../download";
import { parseReportWarnings, reportExport } from "./reportExport";

vi.mock("../download", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  saveBlob: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("parseReportWarnings", () => {
  it("reads the list and the true count (which may exceed the listed texts)", () => {
    const h = new Headers({
      "X-Report-Warnings": JSON.stringify(["figure 'a' -- not embedded: bad spec"]),
      "X-Report-Warning-Count": "23",
    });
    expect(parseReportWarnings(h)).toEqual({
      warnings: ["figure 'a' -- not embedded: bad spec"],
      warningCount: 23,
    });
  });

  it("no headers = no warnings", () => {
    expect(parseReportWarnings(new Headers())).toEqual({ warnings: [], warningCount: 0 });
  });

  it("degrades a malformed header to the count, never throws", () => {
    const bad = new Headers({ "X-Report-Warnings": "{not json", "X-Report-Warning-Count": "2" });
    expect(parseReportWarnings(bad)).toEqual({ warnings: [], warningCount: 2 });
    const mixed = new Headers({ "X-Report-Warnings": JSON.stringify(["ok", 7, null]), "X-Report-Warning-Count": "x" });
    expect(parseReportWarnings(mixed)).toEqual({ warnings: ["ok"], warningCount: 1 });
  });
});

describe("reportExport", () => {
  it("saves the file AND resolves with the response's warnings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html></html>", {
        status: 200,
        headers: {
          "Content-Disposition": 'attachment; filename="r.html"',
          "X-Report-Warnings": JSON.stringify(["w1", "w2"]),
          "X-Report-Warning-Count": "2",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await reportExport({ title: "t", sections: [] }, "html", "r");
    expect(res).toEqual({ warnings: ["w1", "w2"], warningCount: 2 });
    expect(saveBlob).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveBlob).mock.calls[0][1]).toBe("r.html");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      report: { title: "t", sections: [] },
      format: "html",
      filename: "r",
    });
  });
});
