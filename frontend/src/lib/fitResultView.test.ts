import { describe, expect, it } from "vitest";
import { paramUnit } from "./fitParamUnits";
import { fitDof, fitResultMarkdown, fitResultTsv, fitResultView } from "./fitResultView";

const result = { params: [9.0000000001, 0.5, 3], errors: [0.0123, 0.2, null], R2: 0.99987, chiSqRed: 1.2, RMSE: 0.05, AIC: -40, nPoints: 12, nFree: 3 };
const input = { model: "ExpDec1", names: ["y0", "A1", "t1"], result, xUnit: "K", yUnit: "emu" };

describe("paramUnit", () => {
  it("derives a unit only where the dimension is certain", () => {
    expect(paramUnit("ExpDec1", "t1", "s", "V")).toBe("s");
    expect(paramUnit("ExpDec1", "A1", "s", "V")).toBe("V");
    expect(paramUnit("Linear", "m", "s", "V")).toBe("V/s");
    expect(paramUnit("Gauss", "A", "nm", "cps")).toBe("cps·nm");
  });
  it("never guesses: unlisted model/parameter or a blank unit gives null", () => {
    expect(paramUnit("Hill", "n", "s", "V")).toBeNull();
    expect(paramUnit("ExpDec1", "zzz", "s", "V")).toBeNull();
    expect(paramUnit("ExpDec1", "t1", "", "V")).toBeNull();
    expect(paramUnit("Linear", "m", "", "V")).toBeNull();
  });
});

describe("fitResultView", () => {
  it("rounds to the error, adds the CI, the units, the dof and a 5-decimal R²", () => {
    const v = fitResultView(input);
    expect(v.paramRows[0]).toEqual(["y0", "9.000 ± 0.012", "[8.972, 9.028]", "emu"]);
    expect(v.paramRows[1]![1]).toBe("0.50 ± 0.20");
    expect(fitDof(result)).toBe(9);
    expect(v.statRows).toContainEqual(["dof", "9"]);
    expect(v.statRows).toContainEqual(["R²", "0.99987"]);
  });
  it("flags a singular covariance and names the parameter", () => {
    const v = fitResultView(input);
    expect(v.paramRows[2]).toEqual(["t1", "3 (no error)", "—", "K"]);
    expect(v.notes.join(" ")).toMatch(/Singular covariance: t1/);
  });
  it("a held parameter is 'fixed', not undetermined", () => {
    const v = fitResultView({ ...input, fixed: [false, false, true] });
    expect(v.paramRows[2]![1]).toBe("3 (fixed)");
    expect(v.notes).toEqual([]);
  });
  it("marks an exact fit instead of printing meaningless digits", () => {
    const v = fitResultView({ ...input, result: { ...result, R2: 1, errors: [8.7e-12, 1e-12, 1e-12] } });
    expect(v.statRows).toContainEqual(["R²", "≈1 (exact)"]);
    expect(v.notes[0]).toMatch(/^Exact fit/);
    expect(v.paramRows[0]![1]).not.toMatch(/0000000/);
    expect(v.paramRows[0]![2]).toBe("—");
  });
});

describe("copy serializers", () => {
  it("TSV: separate numeric columns for Excel, then the statistics", () => {
    const text = fitResultTsv(input);
    const rows = text.split("\n").map((l) => l.split("\t"));
    expect(rows[0]).toEqual(["Parameter", "Value", "Std. error", "95 % CI low", "95 % CI high", "Units"]);
    expect(rows[1]).toEqual(["y0", "9.000", "0.012", "8.972", "9.028", "emu"]);
    expect(rows[3]![1]).toBe("3");
    expect(rows.flat()).toContain("0.99987");
    expect(text).not.toMatch(/[±×]/);
  });
  it("Markdown: the displayed tables", () => {
    const md = fitResultMarkdown(input);
    expect(md).toContain("| Parameter | Value ± SE | 95 % CI | Units |");
    expect(md).toContain("| y0 | 9.000 ± 0.012 | [8.972, 9.028] | emu |");
    expect(md).toContain("| R² | 0.99987 |");
  });
  it("Markdown: escapes backslashes before pipes in cells", () => {
    const md = fitResultMarkdown({ ...input, names: ["a\\|b", "A1", "t1"] });
    expect(md).toContain("| a\\\\\\|b |");
  });
});
