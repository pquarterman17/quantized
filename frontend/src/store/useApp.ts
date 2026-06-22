// Central app store (Zustand). Mirrors fermiviewer's single-hook convention.
// Holds loaded datasets, the active selection, panel + theme view state.

import { create } from "zustand";

import { applyCorrections as applyCorrectionsApi } from "../lib/api";
import type { CorrectionParams, Dataset } from "../lib/types";

export type Theme = "dark" | "light";
export type Accent = "violet" | "teal" | "ocean" | "amber" | "rose";
export type Density = "compact" | "regular" | "comfy";
export type StageTab = "plot" | "worksheet";
export type PlotTool = "zoom" | "pan" | "cursor";

interface AppState {
  datasets: Dataset[];
  activeId: string | null;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  stageTab: StageTab;
  theme: Theme;
  accent: Accent;
  density: Density;
  yLog: boolean;
  plotTool: PlotTool;
  cmdkOpen: boolean;
  status: string;

  addDataset: (ds: Dataset) => void;
  setActive: (id: string) => void;
  removeDataset: (id: string) => void;
  applyCorrections: (id: string, params: CorrectionParams) => Promise<void>;
  resetCorrections: (id: string) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  setStageTab: (tab: StageTab) => void;
  setTheme: (theme: Theme) => void;
  setAccent: (accent: Accent) => void;
  setDensity: (density: Density) => void;
  setYLog: (yLog: boolean) => void;
  setPlotTool: (tool: PlotTool) => void;
  setCmdk: (open: boolean) => void;
  setStatus: (status: string) => void;
}

function applyDocAttrs(theme: Theme, accent: Accent, density: Density): void {
  const el = document.documentElement;
  el.dataset.theme = theme;
  el.dataset.accent = accent;
  el.dataset.density = density;
}

export const useApp = create<AppState>((set, get) => ({
  datasets: [],
  activeId: null,
  leftCollapsed: false,
  rightCollapsed: false,
  stageTab: "plot",
  theme: "dark",
  accent: "violet",
  density: "regular",
  yLog: false,
  plotTool: "zoom",
  cmdkOpen: false,
  status: "starting…",

  addDataset: (ds) =>
    set((s) => ({
      datasets: [...s.datasets, ds],
      activeId: ds.id,
    })),
  setActive: (id) => set({ activeId: id }),
  removeDataset: (id) =>
    set((s) => {
      const datasets = s.datasets.filter((d) => d.id !== id);
      const activeId =
        s.activeId === id ? (datasets[0]?.id ?? null) : s.activeId;
      return { datasets, activeId };
    }),

  // Corrections always apply to the pristine `raw`, never to an already-
  // corrected `data` (the MATLAB pipeline is replace, not accumulate). The
  // first import becomes `raw`; re-applying with new params re-derives `data`.
  applyCorrections: async (id, params) => {
    const ds = get().datasets.find((d) => d.id === id);
    if (!ds) return;
    const raw = ds.raw ?? ds.data;
    try {
      const corrected = await applyCorrectionsApi({ dataset: raw, params });
      set((s) => ({
        datasets: s.datasets.map((d) =>
          d.id === id ? { ...d, data: corrected, raw, corrections: params } : d,
        ),
      }));
    } catch (e) {
      get().setStatus(
        `corrections failed: ${e instanceof Error ? e.message : "error"}`,
      );
    }
  },
  resetCorrections: (id) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id && d.raw
          ? { ...d, data: d.raw, raw: undefined, corrections: undefined }
          : d,
      ),
    })),
  toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),
  setStageTab: (stageTab) => set({ stageTab }),
  setTheme: (theme) => {
    applyDocAttrs(theme, get().accent, get().density);
    set({ theme });
  },
  setAccent: (accent) => {
    applyDocAttrs(get().theme, accent, get().density);
    set({ accent });
  },
  setDensity: (density) => {
    applyDocAttrs(get().theme, get().accent, density);
    set({ density });
  },
  setYLog: (yLog) => set({ yLog }),
  setPlotTool: (plotTool) => set({ plotTool }),
  setCmdk: (cmdkOpen) => set({ cmdkOpen }),
  setStatus: (status) => set({ status }),
}));

/** Convenience selector: the currently active dataset (or null). */
export function useActiveDataset(): Dataset | null {
  return useApp((s) => s.datasets.find((d) => d.id === s.activeId) ?? null);
}
