import { beforeEach, describe, expect, it } from "vitest";

import { openHelp, useHelp } from "./help";

beforeEach(() => useHelp.setState({ open: false, section: "search", whatIsThis: false }));

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

describe("useHelp — what-is-this mode", () => {
  it("toggles inspect mode", () => {
    useHelp.getState().toggleWhatIsThis();
    expect(useHelp.getState().whatIsThis).toBe(true);
    useHelp.getState().toggleWhatIsThis();
    expect(useHelp.getState().whatIsThis).toBe(false);
  });

  it("turning on inspect mode closes the dialog (they are alternates)", () => {
    useHelp.getState().openHelp();
    useHelp.getState().toggleWhatIsThis();
    expect(useHelp.getState().whatIsThis).toBe(true);
    expect(useHelp.getState().open).toBe(false);
  });

  it("opening the dialog exits inspect mode", () => {
    useHelp.getState().setWhatIsThis(true);
    useHelp.getState().openHelp();
    expect(useHelp.getState().open).toBe(true);
    expect(useHelp.getState().whatIsThis).toBe(false);
  });

  it("setWhatIsThis sets it directly", () => {
    useHelp.getState().setWhatIsThis(true);
    expect(useHelp.getState().whatIsThis).toBe(true);
    useHelp.getState().setWhatIsThis(false);
    expect(useHelp.getState().whatIsThis).toBe(false);
  });
});
