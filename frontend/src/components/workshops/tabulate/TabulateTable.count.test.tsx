// Tabulate's "count" stat is an integer: it ignores the Scientific / 3 sf pref
// that the real-valued stats (mean) follow (P0-2).
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import TabulateTable from "./TabulateTable";
import { setFormatOpts } from "../../../lib/format";
import type { TabRow } from "../../../lib/tabulate";

afterEach(() => setFormatOpts(6, "auto"));

describe("TabulateTable counts", () => {
  it("prints count as an integer and mean through fmtNum under Scientific / 3 sf", () => {
    setFormatOpts(3, "scientific");
    const rows = [{ levels: [0], values: [{ count: 201, mean: 201 }] }] as unknown as TabRow[];
    render(<TabulateTable groupLabels={["g"]} valueLabels={["v"]} statKeys={["count", "mean"]} rows={rows} levelLabel={() => "a"} />);
    expect(screen.getByText("201")).toBeTruthy();
    expect(screen.getByText("2.01e+2")).toBeTruthy();
  });
});
