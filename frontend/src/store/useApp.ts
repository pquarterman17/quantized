// Central app store (Zustand). Mirrors fermiviewer's single-hook convention.
// Holds loaded datasets, the active selection, panel + theme view state.

import { create } from "zustand";

import { applyCorrections as applyCorrectionsApi, uploadFile } from "../lib/api";
import type {
  AxisFormat,
  BaselineOverlay,
  CorrectionParams,
  Dataset,
  FitOverlay,
  PeakOverlay,
  RefLine,
  SeriesStyle,
} from "../lib/types";

let _refSeq = 0;

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
  xLim: [number, number] | null; // explicit X range (null = autoscale)
  yLim: [number, number] | null; // explicit Y range (null = autoscale)
  xFmt: AxisFormat; // X-axis tick number format
  yFmt: AxisFormat; // Y-axis tick number format (also applied to the secondary axis)
  yKeys: number[] | null; // which value channels to plot (null = all)
  y2Keys: number[] | null; // channels drawn on the secondary (right) Y axis
  refLines: RefLine[]; // fixed X/Y marker lines on the plot
  seriesStyles: Record<number, SeriesStyle>; // per-channel color/width/line overrides
  waterfall: number; // waterfall offset as a fraction of the y-span (0 = off)
  plotTool: PlotTool;
  cmdkOpen: boolean;
  curveFitOpen: boolean;
  hysteresisOpen: boolean;
  peaksOpen: boolean;
  reflectivityOpen: boolean;
  baselineOpen: boolean;
  calculatorsOpen: boolean;
  magToolsOpen: boolean;
  fitOverlay: FitOverlay | null;
  peakOverlay: PeakOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  status: string;

  addDataset: (ds: Dataset) => void;
  importFiles: (files: File[]) => Promise<void>;
  setActive: (id: string) => void;
  removeDataset: (id: string) => void;
  renameDataset: (id: string, name: string) => void;
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
  setXLim: (xLim: [number, number] | null) => void;
  setYLim: (yLim: [number, number] | null) => void;
  setXFmt: (xFmt: AxisFormat) => void;
  setYFmt: (yFmt: AxisFormat) => void;
  setYKeys: (yKeys: number[] | null) => void;
  setY2Keys: (y2Keys: number[] | null) => void;
  addRefLine: (axis: "x" | "y", value: number) => void;
  removeRefLine: (id: string) => void;
  setSeriesStyle: (channel: number, patch: Partial<SeriesStyle>) => void;
  resetSeriesStyle: (channel: number) => void;
  setWaterfall: (waterfall: number) => void;
  setPlotTool: (tool: PlotTool) => void;
  setCmdk: (open: boolean) => void;
  setCurveFitOpen: (open: boolean) => void;
  setHysteresisOpen: (open: boolean) => void;
  setPeaksOpen: (open: boolean) => void;
  setReflectivityOpen: (open: boolean) => void;
  setBaselineOpen: (open: boolean) => void;
  setCalculatorsOpen: (open: boolean) => void;
  setMagToolsOpen: (open: boolean) => void;
  setFitOverlay: (overlay: FitOverlay | null) => void;
  setPeakOverlay: (overlay: PeakOverlay | null) => void;
  setBaselineOverlay: (overlay: BaselineOverlay | null) => void;
  setStatus: (status: string) => void;
}

// ── Appearance prefs persisted to localStorage (survive a reload) ──
const PREFS_KEY = "qz.prefs";
const THEMES = ["dark", "light"];
const ACCENTS = ["violet", "teal", "ocean", "amber", "rose"];
const DENSITIES = ["compact", "regular", "comfy"];

interface Prefs {
  theme: Theme;
  accent: Accent;
  density: Density;
}

function loadPrefs(): Prefs {
  const fb: Prefs = { theme: "dark", accent: "violet", density: "regular" };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Record<string, unknown>;
    return {
      theme: THEMES.includes(p.theme as string) ? (p.theme as Theme) : fb.theme,
      accent: ACCENTS.includes(p.accent as string) ? (p.accent as Accent) : fb.accent,
      density: DENSITIES.includes(p.density as string) ? (p.density as Density) : fb.density,
    };
  } catch {
    return fb;
  }
}

function applyDocAttrs(theme: Theme, accent: Accent, density: Density): void {
  const el = document.documentElement;
  el.dataset.theme = theme;
  el.dataset.accent = accent;
  el.dataset.density = density;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ theme, accent, density }));
  } catch {
    /* storage unavailable (private mode) — non-fatal */
  }
}

const _initialPrefs = loadPrefs();

export const useApp = create<AppState>((set, get) => ({
  datasets: [],
  activeId: null,
  leftCollapsed: false,
  rightCollapsed: false,
  stageTab: "plot",
  theme: _initialPrefs.theme,
  accent: _initialPrefs.accent,
  density: _initialPrefs.density,
  yLog: false,
  xLog: false,
  xLim: null,
  yLim: null,
  xFmt: { mode: "auto", digits: 2 },
  yFmt: { mode: "auto", digits: 2 },
  yKeys: null,
  y2Keys: null,
  refLines: [],
  seriesStyles: {},
  waterfall: 0,
  plotTool: "zoom",
  cmdkOpen: false,
  curveFitOpen: false,
  hysteresisOpen: false,
  peaksOpen: false,
  reflectivityOpen: false,
  baselineOpen: false,
  calculatorsOpen: false,
  magToolsOpen: false,
  fitOverlay: null,
  peakOverlay: null,
  baselineOverlay: null,
  status: "starting…",

  addDataset: (ds) =>
    set((s) => ({
      datasets: [...s.datasets, ds],
      activeId: ds.id,
      yKeys: null, // new dataset → plot all its channels
      y2Keys: null, // and reset the secondary-axis assignment
      seriesStyles: {}, // styles are keyed by channel index → reset per dataset
      xLim: null, // and autoscale both axes
      yLim: null,
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
  setActive: (id) =>
    set({ activeId: id, yKeys: null, y2Keys: null, seriesStyles: {}, xLim: null, yLim: null }),
  removeDataset: (id) =>
    set((s) => {
      const datasets = s.datasets.filter((d) => d.id !== id);
      const activeId =
        s.activeId === id ? (datasets[0]?.id ?? null) : s.activeId;
      return { datasets, activeId };
    }),
  renameDataset: (id, name) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id ? { ...d, name: name.trim() || d.name } : d,
      ),
    })),

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
  setXLim: (xLim) => set({ xLim }),
  setYLim: (yLim) => set({ yLim }),
  setXFmt: (xFmt) => set({ xFmt }),
  setYFmt: (yFmt) => set({ yFmt }),
  setYKeys: (yKeys) => set({ yKeys }),
  setY2Keys: (y2Keys) => set({ y2Keys }),
  addRefLine: (axis, value) =>
    set((s) => ({ refLines: [...s.refLines, { id: `ref-${++_refSeq}`, axis, value }] })),
  removeRefLine: (id) => set((s) => ({ refLines: s.refLines.filter((r) => r.id !== id) })),
  setSeriesStyle: (channel, patch) =>
    set((s) => ({
      seriesStyles: { ...s.seriesStyles, [channel]: { ...s.seriesStyles[channel], ...patch } },
    })),
  resetSeriesStyle: (channel) =>
    set((s) => {
      const next = { ...s.seriesStyles };
      delete next[channel];
      return { seriesStyles: next };
    }),
  setWaterfall: (waterfall) => set({ waterfall }),
  setPlotTool: (plotTool) => set({ plotTool }),
  setCmdk: (cmdkOpen) => set({ cmdkOpen }),
  setCurveFitOpen: (curveFitOpen) => set({ curveFitOpen }),
  setHysteresisOpen: (hysteresisOpen) => set({ hysteresisOpen }),
  setPeaksOpen: (peaksOpen) => set({ peaksOpen }),
  setReflectivityOpen: (reflectivityOpen) => set({ reflectivityOpen }),
  setBaselineOpen: (baselineOpen) => set({ baselineOpen }),
  setCalculatorsOpen: (calculatorsOpen) => set({ calculatorsOpen }),
  setMagToolsOpen: (magToolsOpen) => set({ magToolsOpen }),
  setFitOverlay: (fitOverlay) => set({ fitOverlay }),
  setPeakOverlay: (peakOverlay) => set({ peakOverlay }),
  setBaselineOverlay: (baselineOverlay) => set({ baselineOverlay }),
  setStatus: (status) => set({ status }),
}));

// Apply the persisted appearance to <html> on load (set* only ran on change,
// so without this the first paint had no theme/accent/density attributes).
applyDocAttrs(_initialPrefs.theme, _initialPrefs.accent, _initialPrefs.density);

/** Convenience selector: the currently active dataset (or null). */
export function useActiveDataset(): Dataset | null {
  return useApp((s) => s.datasets.find((d) => d.id === s.activeId) ?? null);
}
