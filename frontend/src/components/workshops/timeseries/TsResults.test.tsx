import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { fmtP, Summary } from "./TsResults";
import type { TsResult } from "./timeSeriesRun";

describe("time series p-value display (UX audit P2-10)", () => {
  it("shows an underflowed p as < 1e-16, never 0", () => {
    expect(fmtP(0)).toBe("< 1e-16");
    expect(fmtP(1e-20)).toBe("< 1e-16");
    expect(fmtP(0.0312)).toBe("0.0312");
    expect(fmtP(null)).toBe("—");
  });

  it("the Ljung-Box table uses it", () => {
    const r = { tab: "correlogram", data: { ljung_box: [{ lag: 10, q: 900, df: 10, p: 0 }] } } as unknown as TsResult;
    render(<Summary r={r} />);
    expect(screen.getByText("< 1e-16")).toBeTruthy();
  });
});
