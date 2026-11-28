import { describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { guessLayerValues } from "./stackGuess";

const ds = (name: string, metadata: Record<string, unknown> = {}): Dataset => ({
  id: name, name, data: { time: [], values: [], labels: [], units: [], metadata },
});

describe("guessLayerValues", () => {
  it("prefers a varying numeric metadata value with a physical name", () => {
    const g = guessLayerValues([ds("a", { temperature: 10, n: 1 }), ds("b", { temperature: 20, n: 2 }), ds("c", { temperature: 30, n: 3 })]);
    expect(g).toMatchObject({ source: "metadata", label: "temperature", values: ["10", "20", "30"] });
  });

  it("takes the number in the names that varies between the maps", () => {
    const g = guessLayerValues([ds("scan_001_300K.dat"), ds("scan_001_350K.dat"), ds("scan_001_400K.dat")]);
    expect(g.source).toBe("names");
    expect(g.values).toEqual(["300", "350", "400"]);
  });

  it("falls back to the last number when the names have different shapes, and to nothing when no number differs", () => {
    expect(guessLayerValues([ds("run 1 at 5.5"), ds("x at 7"), ds("y 9")]).values).toEqual(["5.5", "7", "9"]);
    const none = guessLayerValues([ds("alpha"), ds("beta"), ds("gamma")]);
    expect(none).toMatchObject({ source: "none", values: ["", "", ""] });
    expect(guessLayerValues([ds("m_5"), ds("m_5"), ds("m_5")]).source).toBe("none");
  });

  it("has nothing to guess for zero layers, one layer, and two layers it can read, without throwing", () => {
    expect(guessLayerValues([]).source).toBe("none");
    expect(guessLayerValues([ds("a_1")]).values).toEqual([""]);
    expect(guessLayerValues([ds("a_1"), ds("a_2")]).values).toEqual(["1", "2"]);
  });
});
