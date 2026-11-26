import { describe, expect, it } from "vitest";

import { isDeleteKey } from "./deleteKey";

describe("isDeleteKey", () => {
  it("is true for plain and Shift Delete / Backspace", () => {
    for (const key of ["Delete", "Backspace"]) {
      expect(isDeleteKey({ key })).toBe(true);
      expect(isDeleteKey({ key, shiftKey: true } as KeyboardEvent)).toBe(true);
    }
  });
  it("is false once Ctrl, Cmd or Alt is held", () => {
    for (const key of ["Delete", "Backspace"]) {
      expect(isDeleteKey({ key, ctrlKey: true })).toBe(false);
      expect(isDeleteKey({ key, metaKey: true })).toBe(false);
      expect(isDeleteKey({ key, altKey: true })).toBe(false);
    }
  });
  it("is false for other keys", () => {
    expect(isDeleteKey({ key: "a" })).toBe(false);
    expect(isDeleteKey({ key: "Enter" })).toBe(false);
  });
});
