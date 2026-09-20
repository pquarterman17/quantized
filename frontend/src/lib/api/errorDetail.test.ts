// BUG-021 defect 1: FastAPI's 422 `detail` is an ARRAY of ValidationError
// objects, and `ensureOk`'s `as { detail?: string }` cast stringified it to
// `[object Object],[object Object],…`. These cover the formatter directly; the
// end-to-end assertion through `ensureOk` lives in `./http.test.ts`.

import { describe, expect, it } from "vitest";

import { formatErrorDetail } from "./errorDetail";

/** The exact body measured from `POST /api/magnetometry/subtract-background`
 *  with four NaN gaps in `moment` — see
 *  `tests/test_api_magnetometry.py::test_null_series_element_is_422_with_one_entry_per_null`,
 *  which pins the same shape from the backend side. */
const REAL_422 = [7, 8, 22, 31].map((i) => ({
  type: "float_type",
  loc: ["body", "moment", i],
  msg: "Input should be a valid number",
  input: null,
}));

describe("formatErrorDetail", () => {
  it("renders the real four-gap 422 readably instead of [object Object]", () => {
    const out = formatErrorDetail(REAL_422);
    expect(out).not.toContain("[object Object]");
    expect(out).toContain("body.moment.7: Input should be a valid number");
    // Three shown, and the total count kept honest.
    expect(out).toBe(
      "body.moment.7: Input should be a valid number; " +
        "body.moment.8: Input should be a valid number; " +
        "body.moment.22: Input should be a valid number (4 problems in total)",
    );
  });

  it("deduplicates identical lines and reports the true total, not a +N off the dedupe", () => {
    const many = Array.from({ length: 400 }, () => ({
      loc: ["body", "moment", 3],
      msg: "Input should be a valid number",
    }));
    expect(formatErrorDetail(many)).toBe(
      "body.moment.3: Input should be a valid number (400 problems in total)",
    );
  });

  it("omits the total when every entry is shown", () => {
    expect(
      formatErrorDetail([
        { loc: ["body", "a"], msg: "too small" },
        { loc: ["body", "b"], msg: "too big" },
      ]),
    ).toBe("body.a: too small; body.b: too big");
  });

  it("passes a plain string detail through", () => {
    expect(formatErrorDetail("need at least 3 data points")).toBe("need at least 3 data points");
  });

  it("formats a single object detail", () => {
    expect(formatErrorDetail({ loc: ["body", "x"], msg: "bad" })).toBe("body.x: bad");
    expect(formatErrorDetail({ msg: "no loc here" })).toBe("no loc here");
  });

  it("returns null for nothing worth showing, so the caller keeps its status line", () => {
    expect(formatErrorDetail(undefined)).toBeNull();
    expect(formatErrorDetail(null)).toBeNull();
    expect(formatErrorDetail("")).toBeNull();
    expect(formatErrorDetail([])).toBeNull();
  });

  it("falls back to JSON for an entry it cannot read — never [object Object]", () => {
    const out = formatErrorDetail([{ unexpected: 1 }]);
    expect(out).toBe('{"unexpected":1}');
    expect(out).not.toContain("[object Object]");
  });

  it("does not throw on a hostile body (cyclic object), it degrades", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(() => formatErrorDetail([cyclic])).not.toThrow();
    expect(() => formatErrorDetail(cyclic)).not.toThrow();
  });

  it("ignores a non-array loc rather than crashing on it", () => {
    expect(formatErrorDetail([{ loc: "body.x", msg: "bad" }])).toBe("bad");
  });
});
