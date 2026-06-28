// Central app store (Zustand). Mirrors fermiviewer's single-hook convention.
// Holds loaded datasets, the active selection, panel + theme view state.

import { create } from "zustand";

import type { CorrectionsRequest } from "../lib/api";
import { applyCorrections as applyCorrectionsApi, uploadFile } from "../lib/api";
import { cloneDataStruct } from "../lib/dataset";
import { applyFormulas, baseColumns, recomputeData } from "../lib/formula";
import { lit, macroStep, type MacroStep } from "../lib/macro";
import type {
  Annotation,
  AxisFormat,
  BaselineOverlay,
  ChannelRole,
  ComputedColumn,
  CorrectionParams,
  Dataset,
  FitOverlay,
  PeakOverlay,
  RefLine,
  RsmPeak,
  SeriesStyle,
} from "../lib/types";

/** Recompute a dataset's computed columns from its current base (no-op without
 *  formulas). Routed through after any base-data mutation (cell edit, corrections). */
const recompute = (d: Dataset): Dataset =>
  d.formulas?.length ? { ...d, data: recomputeData(d.data, d.formulas) } : d;

let _refSeq = 0;
let _annSeq = 0;

let _idSeq = 0;
const nextDatasetId = (): string => `ds-${Date.now().toString(36)}-${++_idSeq}`;

export type Theme = "dark" | "light";
export type Accent = "violet" | "teal" | "ocean" | "amber" | "rose";
export type Density = "compact" | "regular" | "comfy";
export type StageTab = "plot" | "map" | "worksheet";
export type PlotTool = "zoom" | "pan" | "cursor" | "region" | "measure" | "stats";

interface AppState {
  datasets: Dataset[];
  activeId: string | null;
  // Multi-selection for bulk ops (Delete key). `activeId` stays the plotted
  // "primary"; ctrl/shift-click extend `selectedIds` without changing the plot.
  selectedIds: string[];
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  stageTab: StageTab;
  theme: Theme;
  accent: Accent;
  density: Density;
  yLog: boolean;
  xLog: boolean;
  showGrid: boolean; // draw the plot grid lines
  showLegend: boolean; // show the floating legend overlay
  stackMode: boolean; // multi-panel: one stacked sub-plot per channel
  insetMode: boolean; // show a magnifier inset over the plot
  polarMode: boolean; // render the active series in polar (angle vs radius)
  xLim: [number, number] | null; // explicit X range (null = autoscale)
  yLim: [number, number] | null; // explicit Y range (null = autoscale)
  xFmt: AxisFormat; // X-axis tick number format
  yFmt: AxisFormat; // Y-axis tick number format (also applied to the secondary axis)
  plotTitle: string; // chart title rendered above the plot ("" = none)
  xAxisLabel: string; // override for the x-axis label ("" = auto from data)
  yAxisLabel: string; // override for the primary y-axis label ("" = auto)
  xKey: number | null; // value channel used as the plot x-axis (null = .time)
  yKeys: number[] | null; // which value channels to plot (null = all)
  y2Keys: number[] | null; // channels drawn on the secondary (right) Y axis
  refLines: RefLine[]; // fixed X/Y marker lines on the plot
  annotations: Annotation[]; // text labels pinned at data coordinates
  seriesStyles: Record<number, SeriesStyle>; // per-channel color/width/line overrides
  seriesLabels: Record<number, string>; // per-channel display-name overrides (legend rename)
  errKeys: Record<number, number>; // y-channel index → channel holding its ± error (error bars)
  seriesOrder: number[] | null; // explicit plotted-channel draw order (null = natural/yKeys order)
  hiddenChannels: number[]; // channels toggled off via the interactive legend (kept in payload, not drawn)
  waterfall: number; // waterfall offset as a fraction of the y-span (0 = off)
  plotTool: PlotTool;
  // Last x-range picked by the region rubber-band ([x_min,x_max]); the baseline
  // workshop consumes it then resets to null. Drag direction is normalized away.
  regionPicked: [number, number] | null;
  cmdkOpen: boolean;
  curveFitOpen: boolean;
  hysteresisOpen: boolean;
  peaksOpen: boolean;
  reflectivityOpen: boolean;
  baselineOpen: boolean;
  calculatorsOpen: boolean;
  magToolsOpen: boolean;
  rsmOpen: boolean;
  digitizerOpen: boolean;
  datasetMathOpen: boolean;
  figureBuilderOpen: boolean;
  waterfallOpen: boolean;
  fitOverlay: FitOverlay | null;
  peakOverlay: PeakOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  rsmPeaks: { datasetId: string; peaks: RsmPeak[] } | null; // markers on the 2D map
  mapMethod: string; // 2D-map regrid interpolation (natural/linear/nearest/idw)
  mapRes: number; // 2D-map grid resolution (nx = ny)
  // Macro recorder: when `macroRecording` is on, curated actions append a step;
  // the Inspector card exports `macroSteps` as a reproducible script.
  macroRecording: boolean;
  macroSteps: MacroStep[];
  status: string;

  addDataset: (ds: Dataset) => void;
  importFiles: (files: File[]) => Promise<void>;
  loadWorkspace: (datasets: Dataset[]) => void;
  setActive: (id: string) => void;
  toggleSelected: (id: string) => void;
  selectRange: (id: string) => void;
  removeDataset: (id: string) => void;
  removeSelected: () => void;
  duplicateDataset: (id: string) => void;
  moveDataset: (id: string, dir: -1 | 1) => void;
  renameDataset: (id: string, name: string) => void;
  setCellValue: (id: string, row: number, col: number, value: number) => void;
  addFormula: (id: string, name: string, expr: string) => void;
  removeFormula: (id: string, index: number) => void;
  setDatasetNotes: (id: string, notes: string) => void;
  addDatasetTag: (id: string, tag: string) => void;
  removeDatasetTag: (id: string, tag: string) => void;
  setDatasetGroup: (id: string, group: string) => void;
  applyCorrections: (
    id: string,
    params: CorrectionParams,
    bg?: { datasetId: string; interp: string },
  ) => Promise<void>;
  resetCorrections: (id: string) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  setStageTab: (tab: StageTab) => void;
  setTheme: (theme: Theme) => void;
  setAccent: (accent: Accent) => void;
  setDensity: (density: Density) => void;
  setYLog: (yLog: boolean) => void;
  setXLog: (xLog: boolean) => void;
  setShowGrid: (showGrid: boolean) => void;
  setShowLegend: (showLegend: boolean) => void;
  setStackMode: (stackMode: boolean) => void;
  setInsetMode: (insetMode: boolean) => void;
  setPolarMode: (polarMode: boolean) => void;
  setXLim: (xLim: [number, number] | null) => void;
  setYLim: (yLim: [number, number] | null) => void;
  setXFmt: (xFmt: AxisFormat) => void;
  setYFmt: (yFmt: AxisFormat) => void;
  setPlotTitle: (plotTitle: string) => void;
  setXAxisLabel: (xAxisLabel: string) => void;
  setYAxisLabel: (yAxisLabel: string) => void;
  setXKey: (xKey: number | null) => void;
  setYKeys: (yKeys: number[] | null) => void;
  setY2Keys: (y2Keys: number[] | null) => void;
  addRefLine: (axis: "x" | "y", value: number) => void;
  removeRefLine: (id: string) => void;
  updateRefLine: (id: string, value: number) => void;
  addAnnotation: (x: number, y: number, text: string) => void;
  removeAnnotation: (id: string) => void;
  setSeriesStyle: (channel: number, patch: Partial<SeriesStyle>) => void;
  resetSeriesStyle: (channel: number) => void;
  setSeriesLabel: (channel: number, label: string) => void;
  setErrKey: (channel: number, errChannel: number | null) => void;
  setChannelRole: (channel: number, role: ChannelRole | null) => void;
  setSeriesOrder: (order: number[] | null) => void;
  toggleHidden: (channel: number) => void;
  setWaterfall: (waterfall: number) => void;
  setPlotTool: (tool: PlotTool) => void;
  setRegionPicked: (range: [number, number] | null) => void;
  setCmdk: (open: boolean) => void;
  setCurveFitOpen: (open: boolean) => void;
  setHysteresisOpen: (open: boolean) => void;
  setPeaksOpen: (open: boolean) => void;
  setReflectivityOpen: (open: boolean) => void;
  setBaselineOpen: (open: boolean) => void;
  setCalculatorsOpen: (open: boolean) => void;
  setMagToolsOpen: (open: boolean) => void;
  setRsmOpen: (open: boolean) => void;
  setDigitizerOpen: (open: boolean) => void;
  setDatasetMathOpen: (open: boolean) => void;
  setFigureBuilderOpen: (open: boolean) => void;
  setWaterfallOpen: (open: boolean) => void;
  setFitOverlay: (overlay: FitOverlay | null) => void;
  setPeakOverlay: (overlay: PeakOverlay | null) => void;
  setBaselineOverlay: (overlay: BaselineOverlay | null) => void;
  setRsmPeaks: (rsmPeaks: { datasetId: string; peaks: RsmPeak[] } | null) => void;
  setMapMethod: (method: string) => void;
  setMapRes: (res: number) => void;
  startMacro: () => void;
  stopMacro: () => void;
  clearMacro: () => void;
  // Append a step IFF recording is on (callers invoke unconditionally — the
  // gate lives here so the "are we recording?" check isn't scattered).
  recordMacro: (label: string, code: string) => void;
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
  selectedIds: [],
  leftCollapsed: false,
  rightCollapsed: false,
  stageTab: "plot",
  theme: _initialPrefs.theme,
  accent: _initialPrefs.accent,
  density: _initialPrefs.density,
  yLog: false,
  xLog: false,
  showGrid: true,
  showLegend: true,
  stackMode: false,
  insetMode: false,
  polarMode: false,
  xLim: null,
  yLim: null,
  xFmt: { mode: "auto", digits: 2 },
  yFmt: { mode: "auto", digits: 2 },
  plotTitle: "",
  xAxisLabel: "",
  yAxisLabel: "",
  xKey: null,
  yKeys: null,
  y2Keys: null,
  refLines: [],
  annotations: [],
  seriesStyles: {},
  seriesLabels: {},
  errKeys: {},
  seriesOrder: null,
  hiddenChannels: [],
  waterfall: 0,
  plotTool: "zoom",
  regionPicked: null,
  cmdkOpen: false,
  curveFitOpen: false,
  hysteresisOpen: false,
  peaksOpen: false,
  reflectivityOpen: false,
  baselineOpen: false,
  calculatorsOpen: false,
  magToolsOpen: false,
  rsmOpen: false,
  digitizerOpen: false,
  datasetMathOpen: false,
  figureBuilderOpen: false,
  waterfallOpen: false,
  fitOverlay: null,
  peakOverlay: null,
  baselineOverlay: null,
  rsmPeaks: null,
  mapMethod: "natural",
  mapRes: 200,
  macroRecording: false,
  macroSteps: [],
  status: "starting…",

  addDataset: (ds) =>
    set((s) => ({
      datasets: [...s.datasets, ds],
      activeId: ds.id,
      selectedIds: [ds.id], // a fresh import is the sole selection
      xKey: null, // new dataset → x-axis back to .time
      yKeys: null, // new dataset → plot all its channels
      y2Keys: null, // and reset the secondary-axis assignment
      seriesStyles: {}, // styles are keyed by channel index → reset per dataset
      seriesLabels: {}, // legend renames are channel-keyed → reset per dataset
      errKeys: {}, // error-bar pairings are channel-keyed → reset per dataset
      seriesOrder: null, // draw order is channel-keyed → reset per dataset
      hiddenChannels: [], // legend show/hide is channel-keyed → reset per dataset
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
        get().recordMacro(`Import ${file.name}`, `qz.import(${lit(file.name)})`);
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
  // Replace the whole library with a restored workspace (from a .dwk file).
  // Resets every per-dataset view (channels, styles, axis limits) and drops the
  // overlays/markers tied to the old datasets — same hygiene as setActive.
  loadWorkspace: (datasets) =>
    set({
      datasets,
      activeId: datasets[0]?.id ?? null,
      selectedIds: datasets[0] ? [datasets[0].id] : [],
      xKey: null,
      yKeys: null,
      y2Keys: null,
      seriesStyles: {},
      seriesLabels: {},
      errKeys: {},
      seriesOrder: null,
      hiddenChannels: [],
      xLim: null,
      yLim: null,
      fitOverlay: null,
      peakOverlay: null,
      baselineOverlay: null,
      rsmPeaks: null,
      status: `loaded workspace — ${datasets.length} dataset${datasets.length === 1 ? "" : "s"}`,
    }),
  setActive: (id) =>
    set({
      activeId: id,
      selectedIds: [id], // plain click collapses the selection to this one row
      xKey: null,
      yKeys: null,
      y2Keys: null,
      seriesStyles: {},
      seriesLabels: {},
      errKeys: {},
      seriesOrder: null,
      hiddenChannels: [],
      xLim: null,
      yLim: null,
      rsmPeaks: null,
    }),
  // Ctrl/Cmd-click: add or remove a row from the multi-selection WITHOUT changing
  // the plotted/active dataset (the plot only follows a plain click).
  toggleSelected: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),
  // Shift-click: select the contiguous range from the anchor (activeId) to `id`
  // in library order. Doesn't move the active selection (the plot stays put).
  selectRange: (id) =>
    set((s) => {
      const order = s.datasets.map((d) => d.id);
      const anchor = s.activeId ?? id;
      const a = order.indexOf(anchor);
      const b = order.indexOf(id);
      if (a < 0 || b < 0) return { selectedIds: [id] };
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return { selectedIds: order.slice(lo, hi + 1) };
    }),
  removeDataset: (id) =>
    set((s) => {
      const datasets = s.datasets.filter((d) => d.id !== id);
      const activeId =
        s.activeId === id ? (datasets[0]?.id ?? null) : s.activeId;
      const selectedIds = s.selectedIds.filter((x) => x !== id);
      return { datasets, activeId, selectedIds };
    }),
  // Delete key: remove every selected dataset (falling back to the active one if
  // nothing is multi-selected); reselect the first survivor so the plot recovers.
  removeSelected: () =>
    set((s) => {
      const ids = new Set(
        s.selectedIds.length ? s.selectedIds : s.activeId ? [s.activeId] : [],
      );
      if (ids.size === 0) return {};
      const datasets = s.datasets.filter((d) => !ids.has(d.id));
      const activeId =
        s.activeId && !ids.has(s.activeId) ? s.activeId : (datasets[0]?.id ?? null);
      return { datasets, activeId, selectedIds: activeId ? [activeId] : [] };
    }),

  // Deep-copy a dataset (incl. raw/corrections/bgRef) as an independent "(copy)"
  // — for trying different corrections/formulas while keeping the original.
  // Lands right after the source and becomes active, resetting per-dataset view.
  duplicateDataset: (id) =>
    set((s) => {
      const idx = s.datasets.findIndex((d) => d.id === id);
      if (idx < 0) return {};
      const src = s.datasets[idx];
      const clone: Dataset = {
        id: nextDatasetId(),
        name: `${src.name} (copy)`,
        data: cloneDataStruct(src.data),
        ...(src.raw ? { raw: cloneDataStruct(src.raw) } : {}),
        ...(src.corrections ? { corrections: { ...src.corrections } } : {}),
        ...(src.bgRef ? { bgRef: { ...src.bgRef } } : {}),
        ...(src.notes ? { notes: src.notes } : {}),
        ...(src.tags?.length ? { tags: [...src.tags] } : {}),
        ...(src.group ? { group: src.group } : {}),
        ...(src.formulas?.length ? { formulas: src.formulas.map((f) => ({ ...f })) } : {}),
        ...(src.channelRoles ? { channelRoles: { ...src.channelRoles } } : {}),
      };
      const datasets = [...s.datasets];
      datasets.splice(idx + 1, 0, clone);
      return {
        datasets,
        activeId: clone.id,
        selectedIds: [clone.id],
        xKey: null,
        yKeys: null,
        y2Keys: null,
        seriesStyles: {},
        errKeys: {},
        hiddenChannels: [],
        xLim: null,
        yLim: null,
        rsmPeaks: null,
      };
    }),
  // Reorder the library by swapping a dataset with its neighbor (dir -1 = up,
  // +1 = down). No-op at the ends or for an unknown id. Order drives the list and
  // the consolidated-export column order; the active selection is unaffected.
  moveDataset: (id, dir) =>
    set((s) => {
      const i = s.datasets.findIndex((d) => d.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.datasets.length) return {};
      const datasets = [...s.datasets];
      [datasets[i], datasets[j]] = [datasets[j], datasets[i]];
      return { datasets };
    }),
  renameDataset: (id, name) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id ? { ...d, name: name.trim() || d.name } : d,
      ),
    })),
  // Edit a single worksheet cell in place (col < 0 = the x/time column). Rebuilds
  // the dataset's arrays immutably (DataStruct stays frozen-by-contract) so the
  // plot + stats recompute live. Computed columns (the last `formulas.length`)
  // are read-only — a recompute would overwrite them — so an edit there is a
  // no-op. Editing a base cell recomputes the computed columns. Recovery of the
  // original is via Duplicate.
  setCellValue: (id, row, col, value) => {
    const ds = get().datasets.find((d) => d.id === id);
    if (!ds) return;
    const baseCount = ds.data.labels.length - (ds.formulas?.length ?? 0);
    if (col >= baseCount) return; // computed column — read-only
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const data =
          col < 0
            ? { ...d.data, time: d.data.time.map((t, i) => (i === row ? value : t)) }
            : {
                ...d.data,
                values: d.data.values.map((r, i) =>
                  i === row ? r.map((v, c) => (c === col ? value : v)) : r,
                ),
              };
        return recompute({ ...d, data });
      }),
    }));
    get().recordMacro(
      `Edit ${ds.name} [${row},${col}]`,
      `qz.setCell(${lit(ds.name)}, ${row}, ${col}, ${lit(value)})`,
    );
  },
  // Append a computed column (formula) to a dataset and evaluate it. The column
  // lands as the last column of `data` and recomputes whenever the base changes.
  // Strips the OLD computed columns first, then reapplies the grown list.
  addFormula: (id, name, expr) => {
    const ds = get().datasets.find((d) => d.id === id);
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const base = baseColumns(d.data, d.formulas?.length ?? 0);
        const formulas: ComputedColumn[] = [...(d.formulas ?? []), { name, expr }];
        return { ...d, formulas, data: applyFormulas(base, formulas) };
      }),
    }));
    if (ds) get().recordMacro(`Add column ${name}`, `qz.addColumn(${lit(name)}, ${lit(expr)})`);
  },
  // Remove the computed column at `index` (in the formulas list). Strips the OLD
  // computed columns, then reapplies the shrunk list (NaN-stable indices).
  removeFormula: (id, index) =>
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id || !d.formulas) return d;
        const base = baseColumns(d.data, d.formulas.length);
        const formulas = d.formulas.filter((_, i) => i !== index);
        return {
          ...d,
          formulas: formulas.length ? formulas : undefined,
          data: applyFormulas(base, formulas),
        };
      }),
    })),
  // Attach free-text notes to a dataset (blank clears). Per-dataset, so it lives
  // on the object (round-trips through .dwk) rather than the transient view state.
  setDatasetNotes: (id, notes) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id ? { ...d, notes: notes.trim() ? notes : undefined } : d,
      ),
    })),
  // Add a trimmed, de-duplicated tag to a dataset (blank or duplicate = no-op).
  addDatasetTag: (id, tag) =>
    set((s) => {
      const t = tag.trim();
      if (!t) return {};
      return {
        datasets: s.datasets.map((d) => {
          if (d.id !== id) return d;
          const tags = d.tags ?? [];
          return tags.includes(t) ? d : { ...d, tags: [...tags, t] };
        }),
      };
    }),
  // Remove a tag; the list drops to undefined when it empties (keeps .dwk clean).
  removeDatasetTag: (id, tag) =>
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id || !d.tags) return d;
        const tags = d.tags.filter((x) => x !== tag);
        return { ...d, tags: tags.length ? tags : undefined };
      }),
    })),
  // Assign a dataset to a (trimmed) group; blank clears it back to Ungrouped.
  setDatasetGroup: (id, group) =>
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id ? { ...d, group: group.trim() ? group.trim() : undefined } : d,
      ),
    })),

  // Corrections always apply to the pristine `raw`, never to an already-
  // corrected `data` (the MATLAB pipeline is replace, not accumulate). The
  // first import becomes `raw`; re-applying with new params re-derives `data`.
  // An optional `bg` picks another loaded dataset as the reference background
  // (step 4 of the pipeline): we forward its CURRENT `data` + the interp method
  // so the golden /api/corrections/apply does the interpolated subtraction.
  applyCorrections: async (id, params, bg) => {
    const ds = get().datasets.find((d) => d.id === id);
    if (!ds) return;
    const raw = ds.raw ?? ds.data;
    // Resolve the background only if it points at a real, different dataset.
    const bgDs =
      bg && bg.datasetId !== id
        ? get().datasets.find((d) => d.id === bg.datasetId)
        : undefined;
    const bgRef = bgDs ? { datasetId: bgDs.id, interp: bg!.interp } : undefined;
    const req: CorrectionsRequest = { dataset: raw, params };
    if (bgDs) {
      req.bg_dataset = bgDs.data;
      req.bg_interp = bg!.interp;
    }
    try {
      const corrected = await applyCorrectionsApi(req);
      // Recompute any computed columns from the freshly-corrected base.
      set((s) => ({
        datasets: s.datasets.map((d) =>
          d.id === id ? recompute({ ...d, data: corrected, raw, corrections: params, bgRef }) : d,
        ),
      }));
      get().recordMacro(
        `Corrections → ${ds.name}`,
        bgDs
          ? `qz.applyCorrections(${lit(ds.name)}, ${lit(params)}, ${lit({ bg: bgDs.name, interp: bg!.interp })})`
          : `qz.applyCorrections(${lit(ds.name)}, ${lit(params)})`,
      );
    } catch (e) {
      get().setStatus(
        `corrections failed: ${e instanceof Error ? e.message : "error"}`,
      );
    }
  },
  resetCorrections: (id) => {
    const ds = get().datasets.find((d) => d.id === id);
    set((s) => ({
      datasets: s.datasets.map((d) =>
        d.id === id && d.raw
          ? recompute({ ...d, data: d.raw, raw: undefined, corrections: undefined, bgRef: undefined })
          : d,
      ),
    }));
    if (ds?.raw) get().recordMacro(`Reset corrections → ${ds.name}`, `qz.resetCorrections(${lit(ds.name)})`);
  },
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
  setYLog: (yLog) => {
    set({ yLog });
    get().recordMacro(`Y axis ${yLog ? "log" : "linear"}`, `qz.setYLog(${yLog})`);
  },
  setXLog: (xLog) => {
    set({ xLog });
    get().recordMacro(`X axis ${xLog ? "log" : "linear"}`, `qz.setXLog(${xLog})`);
  },
  setShowGrid: (showGrid) => set({ showGrid }),
  setShowLegend: (showLegend) => set({ showLegend }),
  setStackMode: (stackMode) => set({ stackMode }),
  setInsetMode: (insetMode) => set({ insetMode }),
  setPolarMode: (polarMode) => set({ polarMode }),
  setXLim: (xLim) => set({ xLim }),
  setYLim: (yLim) => set({ yLim }),
  setXFmt: (xFmt) => set({ xFmt }),
  setYFmt: (yFmt) => set({ yFmt }),
  setPlotTitle: (plotTitle) => {
    set({ plotTitle });
    get().recordMacro(`Title → ${plotTitle || "(none)"}`, `qz.setPlotTitle(${lit(plotTitle)})`);
  },
  setXAxisLabel: (xAxisLabel) => set({ xAxisLabel }),
  setYAxisLabel: (yAxisLabel) => set({ yAxisLabel }),
  setXKey: (xKey) => {
    set({ xKey });
    get().recordMacro(`X axis → channel ${xKey ?? "time"}`, `qz.setXKey(${lit(xKey)})`);
  },
  setYKeys: (yKeys) => {
    set({ yKeys });
    get().recordMacro(`Y channels → ${yKeys ? yKeys.join(",") : "all"}`, `qz.setYKeys(${lit(yKeys)})`);
  },
  setY2Keys: (y2Keys) => {
    set({ y2Keys });
    get().recordMacro(
      `Y2 channels → ${y2Keys ? y2Keys.join(",") : "none"}`,
      `qz.setY2Keys(${lit(y2Keys)})`,
    );
  },
  addRefLine: (axis, value) =>
    set((s) => ({ refLines: [...s.refLines, { id: `ref-${++_refSeq}`, axis, value }] })),
  removeRefLine: (id) => set((s) => ({ refLines: s.refLines.filter((r) => r.id !== id) })),
  // Move a reference line to a new value (drag commit). No-op for an unknown id.
  updateRefLine: (id, value) =>
    set((s) => ({ refLines: s.refLines.map((r) => (r.id === id ? { ...r, value } : r)) })),
  addAnnotation: (x, y, text) =>
    set((s) => ({
      annotations: [...s.annotations, { id: `ann-${++_annSeq}`, x, y, text }],
    })),
  removeAnnotation: (id) =>
    set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })),
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
  // Rename a channel's legend/series label. Blank (or whitespace) clears the
  // override, reverting to the dataset's own label.
  setSeriesLabel: (channel, label) =>
    set((s) => {
      const next = { ...s.seriesLabels };
      const t = label.trim();
      if (t) next[channel] = t;
      else delete next[channel];
      return { seriesLabels: next };
    }),
  setErrKey: (channel, errChannel) =>
    set((s) => {
      const next = { ...s.errKeys };
      if (errChannel == null) delete next[channel];
      else next[channel] = errChannel;
      return { errKeys: next };
    }),
  // Set (or clear, role=null) a column role on the ACTIVE dataset. Roles live on
  // the dataset (persist across switches + round-trip .dwk); the map empties to
  // undefined to keep saved files clean.
  setChannelRole: (channel, role) => {
    const id = get().activeId;
    if (id == null) return;
    set((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id) return d;
        const next = { ...(d.channelRoles ?? {}) };
        if (role == null) delete next[channel];
        else next[channel] = role;
        return { ...d, channelRoles: Object.keys(next).length ? next : undefined };
      }),
    }));
    get().recordMacro(
      `Channel ${channel} role → ${role ?? "data"}`,
      `qz.setChannelRole(${channel}, ${lit(role)})`,
    );
  },
  // Persist an explicit plotted-channel draw order (a permutation of the current
  // plotted channels). effectiveChannels reorders by it; stale entries (channels
  // no longer plotted) are ignored and newly-plotted channels append in order.
  setSeriesOrder: (seriesOrder) => set({ seriesOrder }),
  toggleHidden: (channel) =>
    set((s) => ({
      hiddenChannels: s.hiddenChannels.includes(channel)
        ? s.hiddenChannels.filter((c) => c !== channel)
        : [...s.hiddenChannels, channel],
    })),
  setWaterfall: (waterfall) => {
    set({ waterfall });
    get().recordMacro(`Waterfall → ${waterfall}`, `qz.setWaterfall(${waterfall})`);
  },
  setPlotTool: (plotTool) => set({ plotTool }),
  setRegionPicked: (regionPicked) => set({ regionPicked }),
  setCmdk: (cmdkOpen) => set({ cmdkOpen }),
  setCurveFitOpen: (curveFitOpen) => set({ curveFitOpen }),
  setHysteresisOpen: (hysteresisOpen) => set({ hysteresisOpen }),
  setPeaksOpen: (peaksOpen) => set({ peaksOpen }),
  setReflectivityOpen: (reflectivityOpen) => set({ reflectivityOpen }),
  setBaselineOpen: (baselineOpen) => set({ baselineOpen }),
  setCalculatorsOpen: (calculatorsOpen) => set({ calculatorsOpen }),
  setRsmOpen: (rsmOpen) => set({ rsmOpen }),
  setDigitizerOpen: (digitizerOpen) => set({ digitizerOpen }),
  setDatasetMathOpen: (datasetMathOpen) => set({ datasetMathOpen }),
  setFigureBuilderOpen: (figureBuilderOpen) => set({ figureBuilderOpen }),
  setWaterfallOpen: (waterfallOpen) => set({ waterfallOpen }),
  setMagToolsOpen: (magToolsOpen) => set({ magToolsOpen }),
  setFitOverlay: (fitOverlay) => set({ fitOverlay }),
  setPeakOverlay: (peakOverlay) => set({ peakOverlay }),
  setBaselineOverlay: (baselineOverlay) => set({ baselineOverlay }),
  setRsmPeaks: (rsmPeaks) => set({ rsmPeaks }),
  setMapMethod: (mapMethod) => set({ mapMethod }),
  setMapRes: (mapRes) => set({ mapRes }),
  // ── Macro recorder ──────────────────────────────────────────────────────
  startMacro: () => set({ macroRecording: true }),
  stopMacro: () => set({ macroRecording: false }),
  clearMacro: () => set({ macroSteps: [], macroRecording: false }),
  recordMacro: (label, code) =>
    set((s) => (s.macroRecording ? { macroSteps: [...s.macroSteps, macroStep(label, code)] } : {})),
  setStatus: (status) => set({ status }),
}));

// Apply the persisted appearance to <html> on load (set* only ran on change,
// so without this the first paint had no theme/accent/density attributes).
applyDocAttrs(_initialPrefs.theme, _initialPrefs.accent, _initialPrefs.density);

/** Convenience selector: the currently active dataset (or null). */
export function useActiveDataset(): Dataset | null {
  return useApp((s) => s.datasets.find((d) => d.id === s.activeId) ?? null);
}
