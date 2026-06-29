import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCalcHistory } from "./calcHistory";

// jsdom's localStorage is unavailable in this environment (a known quirk), so we
// install a deterministic in-memory mock to exercise the persistence path.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  useCalcHistory.setState({ history: [], favorites: [], seq: 0 });
});

const rec = (label: string, summary = "x"): void =>
  useCalcHistory.getState().record({ domain: "Electrical", label, summary });

describe("calcHistory store", () => {
  it("records newest-first with a unique id and a timestamp", () => {
    rec("Conductivity", "σ = 1000 S/cm");
    rec("Mobility", "μ = 42 cm²/Vs");
    const { history } = useCalcHistory.getState();
    expect(history).toHaveLength(2);
    expect(history[0].label).toBe("Mobility"); // most recent first
    expect(history[1].label).toBe("Conductivity");
    expect(history[0].id).not.toBe(history[1].id);
    expect(history[0].summary).toBe("μ = 42 cm²/Vs");
    expect(history[0].domain).toBe("Electrical");
    expect(typeof history[0].ts).toBe("string");
  });

  it("caps history at 100 (drops the oldest)", () => {
    for (let i = 0; i < 120; i++) rec(`calc ${i}`);
    const { history } = useCalcHistory.getState();
    expect(history).toHaveLength(100);
    expect(history[0].label).toBe("calc 119"); // newest kept
    expect(history[99].label).toBe("calc 20"); // oldest 20 dropped
  });

  it("persists to localStorage under qz.calcHistory", () => {
    rec("Conductivity", "σ = 1000");
    const saved = JSON.parse(localStorage.getItem("qz.calcHistory") ?? "{}");
    expect(saved.history).toHaveLength(1);
    expect(saved.history[0].summary).toBe("σ = 1000");
    expect(saved.seq).toBe(1);
  });

  it("toggleFavorite copies an entry into favorites, then unpins it", () => {
    rec("Hall effect", "R_H = -1e-5");
    const id = useCalcHistory.getState().history[0].id;

    useCalcHistory.getState().toggleFavorite(id);
    expect(useCalcHistory.getState().isFavorite(id)).toBe(true);
    expect(useCalcHistory.getState().favorites).toHaveLength(1);
    // pinning copies — the entry stays in history
    expect(useCalcHistory.getState().history).toHaveLength(1);

    useCalcHistory.getState().toggleFavorite(id); // unpin
    expect(useCalcHistory.getState().isFavorite(id)).toBe(false);
    expect(useCalcHistory.getState().favorites).toHaveLength(0);
  });

  it("toggleFavorite is a no-op for an unknown id", () => {
    useCalcHistory.getState().toggleFavorite("nope");
    expect(useCalcHistory.getState().favorites).toHaveLength(0);
  });

  it("caps favorites at 50", () => {
    for (let i = 0; i < 60; i++) {
      rec(`calc ${i}`);
      useCalcHistory.getState().toggleFavorite(useCalcHistory.getState().history[0].id);
    }
    expect(useCalcHistory.getState().favorites).toHaveLength(50);
  });

  it("clearHistory empties history but keeps favorites", () => {
    rec("Conductivity");
    const id = useCalcHistory.getState().history[0].id;
    useCalcHistory.getState().toggleFavorite(id);

    useCalcHistory.getState().clearHistory();
    expect(useCalcHistory.getState().history).toHaveLength(0);
    expect(useCalcHistory.getState().favorites).toHaveLength(1);
  });
});
