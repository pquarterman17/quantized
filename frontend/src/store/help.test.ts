import { beforeEach, describe, expect, it } from "vitest";

import { openHelp, useHelp } from "./help";

beforeEach(() => useHelp.setState({ open: false, section: "search" }));

describe("useHelp", () => {
  it("starts closed on the search section", () => {
    expect(useHelp.getState().open).toBe(false);
    expect(useHelp.getState().section).toBe("search");
  });

  it("opens to the search section by default", () => {
    useHelp.getState().openHelp();
    expect(useHelp.getState().open).toBe(true);
    expect(useHelp.getState().section).toBe("search");
  });

  it("opens directly to a named section", () => {
    useHelp.getState().openHelp("shortcuts");
    expect(useHelp.getState().section).toBe("shortcuts");
  });

  it("switches section without closing", () => {
    useHelp.getState().openHelp();
    useHelp.getState().setSection("shortcuts");
    expect(useHelp.getState().open).toBe(true);
    expect(useHelp.getState().section).toBe("shortcuts");
  });

  it("closes", () => {
    useHelp.getState().openHelp();
    useHelp.getState().closeHelp();
    expect(useHelp.getState().open).toBe(false);
  });

  it("the imperative helper opens the store (the non-component call path)", () => {
    openHelp("shortcuts");
    expect(useHelp.getState().open).toBe(true);
    expect(useHelp.getState().section).toBe("shortcuts");
  });
});
