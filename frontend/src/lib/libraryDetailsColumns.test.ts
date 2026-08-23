import { describe, expect, it } from "vitest";

import { defaultVisibleDetailsColumns, LIBRARY_DETAILS_COLUMNS } from "./libraryDetailsColumns";

describe("Details-view selectable columns (PR L, L0.56)", () => {
  it("the default-visible set is exactly the original seven columns — unchanged appearance until the user opts in", () => {
    expect([...defaultVisibleDetailsColumns()].sort()).toEqual(
      ["dataType", "dimensions", "location", "modified", "source", "tags", "type"].sort(),
    );
  });

  it("the three new project-metadata columns are discoverable but OFF by default", () => {
    for (const key of ["sample", "notes", "group"] as const) {
      const def = LIBRARY_DETAILS_COLUMNS.find((c) => c.key === key);
      expect(def).toBeDefined();
      expect(def!.defaultVisible).toBe(false);
    }
  });

  it("Name is not part of the toggleable set (mandatory identity column)", () => {
    expect(LIBRARY_DETAILS_COLUMNS.some((c) => (c.key as string) === "name")).toBe(false);
  });
});
