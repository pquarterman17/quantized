import { describe, expect, it } from "vitest";

import { parseCentreTable, pickRowCentres } from "./clusterCentres";

const ROWS = [[1, 10], [2, 20], [3, 30], [4, 40]];
// Worksheet rows 2, 5, 6 and 9 were clustered (the others are excluded or blank).
const SOURCE = [2, 5, 6, 9];

describe("pickRowCentres", () => {
  it("maps worksheet row numbers, not positions, onto the clustered rows", () => {
    expect(pickRowCentres("5, 9", 2, SOURCE, ROWS)).toEqual({ problem: null, centres: [[2, 20], [4, 40]] });
    expect(pickRowCentres("6 2", 2, SOURCE, ROWS)).toEqual({ problem: null, centres: [[3, 30], [1, 10]] });
  });
  it.each([
    ["", /Enter 2 worksheet row numbers/],
    ["1, 5", /Row 1 is not one of the clustered rows/],
    ["5", /needs exactly 2/],
    ["5, 5", /different rows/],
    ["5, x", /whole worksheet row numbers/],
    ["5, 2.5", /whole worksheet row numbers/],
  ])("refuses %j", (text, why) => {
    const got = pickRowCentres(text, 2, SOURCE, ROWS);
    expect(got.problem).toMatch(why);
  });
  it("refuses two rows with identical values", () => {
    expect(pickRowCentres("2, 5", 2, [2, 5], [[1, 1], [1, 1]]).problem).toMatch(/different from each other/);
  });
});

describe("parseCentreTable", () => {
  it("reads tabs, commas, semicolons and spaces, and ignores blank lines", () => {
    expect(parseCentreTable("1\t2\r\n\r\n3, 4\n", 2, 2)).toEqual({ problem: null, centres: [[1, 2], [3, 4]] });
    expect(parseCentreTable("1;2\n3 4", 2, 2)).toEqual({ problem: null, centres: [[1, 2], [3, 4]] });
    expect(parseCentreTable("1e-3 -2.5", 1, 2)).toEqual({ problem: null, centres: [[0.001, -2.5]] });
  });
  it.each([
    ["", 2, 2, /Enter the 2 starting centres/],
    ["1 2\n3", 2, 2, /Centre 2 has 1 value/],
    ["1 2\n3 x", 2, 2, /Centre 2 has a value that is not a number/],
    ["1 2", 2, 2, /1 line; k = 2 needs one per cluster/],
    ["1 2\n1 2", 2, 2, /different from each other/],
    ["1 Infinity", 1, 2, /not a number/],
  ])("refuses %j", (text, k, p, why) => {
    expect(parseCentreTable(text, k, p).problem).toMatch(why);
  });
});
