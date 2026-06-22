// Central app store (Zustand). Mirrors fermiviewer's single-hook convention.
// Holds loaded datasets, the active selection, panel + theme view state.

import { create } from "zustand";

import { applyCorrections as applyCorrectionsApi, uploadFile } from "../lib/api";
import type { CorrectionParams, Dataset, FitOverlay, PeakOverlay } from "../lib/types";

let _idSeq = 0;
const nextDatasetId = (): string => `ds-${Date.now().toString(36)}-${++_idSeq}`;

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
  xLog: boolean;
  yKeys: number[] | null; // which value channels to plot (null = all)
  plotTool: PlotTool;
  cmdkOpen: boolean;
  curveFitOpen: boolean;
  hysteresisOpen: boolean;
  peaksOpen: boolean;
  fitOverlay: FitOverlay | null;
  peakOverlay: PeakOverlay | null;
  status: string;

  addDataset: (ds: Dataset) => void;
  importFiles: (files: File[]) => Promise<void>;
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
  setXLog: (xLog: boolean) => void;
  setYKeys: (yKeys: number[] | null) => void;
  setPlotTool: (tool: PlotTool) => void;
  setCmdk: (open: boolean) => void;
  setCurveFitOpen: (open: boolean) => void;
  setHysteresisOpen: (open: boolean) => void;
  setPeaksOpen: (open: boolean) => void;
  setFitOverlay: (overlay: FitOverlay | null) => void;
  setPeakOverlay: (overlay: PeakOverlay | null) => void;
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
  xLog: false,
  yKeys: null,
  plotTool: "zoom",
  cmdkOpen: false,
  curveFitOpen: false,
  hysteresisOpen: false,
  peaksOpen: false,
  fitOverlay: null,
  peakOverlay: null,
  status: "starting…",

  addDataset: (ds) =>
    set((s) => ({
      datasets: [...s.datasets, ds],
      activeId: ds.id,
      yKeys: null, // new dataset → plot all its channels
    })),

  // Upload + parse each picked/dropped file; add to the library (continues on a
  // per-file error so one bad file doesn't abort the batch).
  importFiles: async (files) => {
    let added = 0;
    let lastError = "";
    for (const file of files) {
      get().setStatus(`importing ${file.name}…`);
      try {
        const data = await uploadFile(file);
        get().addDataset({ id: nextDatasetId(), name: file.name, data });
        added += 1;
      } catch (e) {
        lastError = `${file.name}: ${e instanceof Error ? e.message : "error"}`;
      }
    }
    get().setStatus(
      lastError
        ? `imported ${added}/${files.length} — failed ${lastError}`
        : `imported ${added} file${added === 1 ? "" : "s"}`,
    );
  },
  setActive: (id) => set({ activeId: id, yKeys: null }),
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
  setXLog: (xLog) => set({ xLog }),
  setYKeys: (yKeys) => set({ yKeys }),
  setPlotTool: (plotTool) => set({ plotTool }),
  setCmdk: (cmdkOpen) => set({ cmdkOpen }),
  setCurveFitOpen: (curveFitOpen) => set({ curveFitOpen }),
  setHysteresisOpen: (hysteresisOpen) => set({ hysteresisOpen }),
  setPeaksOpen: (peaksOpen) => set({ peaksOpen }),
  setFitOverlay: (fitOverlay) => set({ fitOverlay }),
  setPeakOverlay: (peakOverlay) => set({ peakOverlay }),
  setStatus: (status) => set({ status }),
}));

/** Convenience selector: the currently active dataset (or null). */
export function useActiveDataset(): Dataset | null {
  return useApp((s) => s.datasets.find((d) => d.id === s.activeId) ?? null);
}
