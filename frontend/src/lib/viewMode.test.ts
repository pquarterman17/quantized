import { afterEach, describe, expect, it } from "vitest";

import { isCalcOnlyView } from "./viewMode";

describe("isCalcOnlyView", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("is false with no query string", () => {
    window.history.pushState({}, "", "/");
    expect(isCalcOnlyView()).toBe(false);
  });

  it("is false for an unrelated view param", () => {
    window.history.pushState({}, "", "/?view=plot");
    expect(isCalcOnlyView()).toBe(false);
  });

  it("is true for ?view=calc", () => {
    window.history.pushState({}, "", "/?view=calc");
    expect(isCalcOnlyView()).toBe(true);
  });

  it("is true when combined with other params", () => {
    window.history.pushState({}, "", "/?harness&view=calc");
    expect(isCalcOnlyView()).toBe(true);
  });
});
