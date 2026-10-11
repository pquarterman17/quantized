import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetAnalysisCenterPreferencesForTests, useAnalysisCenter } from "./analysisCenter";

beforeEach(resetAnalysisCenterPreferencesForTests);

describe("Analysis Center preferences", () => {
  it("toggles favorites and persists only lightweight UI preferences", () => {
    useAnalysisCenter.getState().toggleFavorite("curvefit");
    expect(useAnalysisCenter.getState().favorites).toEqual(["curvefit"]);
    expect(localStorage.getItem("qz.analysis-center.v1")).toContain("curvefit");
    useAnalysisCenter.getState().toggleFavorite("curvefit");
    expect(useAnalysisCenter.getState().favorites).toEqual([]);
  });

  it("deduplicates and bounds recents with the newest tool first", () => {
    for (let index = 0; index < 15; index += 1) useAnalysisCenter.getState().recordUse(`tool-${index}`);
    useAnalysisCenter.getState().recordUse("tool-10");
    expect(useAnalysisCenter.getState().recent).toHaveLength(12);
    expect(useAnalysisCenter.getState().recent[0]).toBe("tool-10");
    expect(useAnalysisCenter.getState().recent.filter((id) => id === "tool-10")).toHaveLength(1);
  });

  it("bounds malformed persisted preferences before rendering them", async () => {
    localStorage.setItem("qz.analysis-center.v1", JSON.stringify({
      favorites: [...Array.from({ length: 120 }, (_, index) => `tool-${index}`), "x".repeat(129)],
      recent: Array.from({ length: 20 }, (_, index) => `recent-${index}`),
    }));
    vi.resetModules();
    const reloaded = await import("./analysisCenter");
    expect(reloaded.useAnalysisCenter.getState().favorites).toHaveLength(100);
    expect(reloaded.useAnalysisCenter.getState().recent).toHaveLength(12);
    expect(reloaded.useAnalysisCenter.getState().favorites).not.toContain("x".repeat(129));
  });
});
