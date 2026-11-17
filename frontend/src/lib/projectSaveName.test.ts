// UX9-I: Save offers the project's or the dataset's name, not `workspace.dwk`.
import { describe, expect, it } from "vitest";

import { dwkNameFrom, projectSaveName } from "./projectSaveName";

const ds = (id: string, name: string) => ({ id, name });

describe("projectSaveName", () => {
  it("prefers the open project's own name", () => {
    expect(projectSaveName({ currentProject: { name: "run7.dwk" }, datasets: [ds("a", "a.csv")], activeId: "a" })).toBe("run7.dwk");
  });

  it("else names the file after the active dataset, then the first", () => {
    const datasets = [ds("a", "sample7.csv"), ds("b", "MvsT 300K.dat")];
    expect(projectSaveName({ currentProject: null, datasets, activeId: "b" })).toBe("MvsT 300K.dwk");
    expect(projectSaveName({ currentProject: null, datasets, activeId: null })).toBe("sample7.dwk");
  });

  it("is null for an empty session (the caller keeps workspace.dwk)", () => {
    expect(projectSaveName({ currentProject: null, datasets: [], activeId: null })).toBeNull();
  });

  it("makes a usable file name out of any dataset name", () => {
    expect(dwkNameFrom("a/b:c?.csv")).toBe("a_b_c_.dwk");
    expect(dwkNameFrom("Book1")).toBe("Book1.dwk");
    expect(dwkNameFrom("  .csv")).toBeNull();
    expect(dwkNameFrom("///")).toBeNull();
  });
});

describe("dwkNameFrom (Windows-safe)", () => {
  it("prefixes reserved device names and caps the length", () => {
    expect(dwkNameFrom("CON.csv")).toBe("_CON.dwk");
    expect(dwkNameFrom("nul")).toBe("_nul.dwk");
    expect(dwkNameFrom("a".repeat(300) + ".csv")?.length).toBeLessThanOrEqual(124);
  });
});
