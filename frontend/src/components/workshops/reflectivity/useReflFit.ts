// Reflectivity workshop — fit-mode state hook (P2.2 slice 2). Binds measured
// XRR/PNR data to the SAME layer model the Model mode edits (passed in from
// useReflectivity, never copied), runs POST /api/reflectivity/fit with an
// AbortController, overlays the fitted curve on the bound dataset, adds fit
// curves / SLD profiles to the library, and writes fitted values back.
// The rules (parameter names, bounds, channel building) live in the pure
// reflFitModel.ts / reflFitData.ts; the fit itself lives in calc/refl_fit.py.
//
// Store access is by selector only — no imperative store snapshot reads (the
// getState file-count ratchet in architecture.test.ts counts this file if it
// so much as names that call).

import { useEffect, useMemo, useRef, useState } from "react";

import { reflFit, type ReflFitResult } from "../../../lib/api/reflectivity";
import { defaultPlotView } from "../../../lib/plotview";
import { droppedRows } from "../../../lib/rowstate";
import type { DataStruct, Dataset, FitOverlay, SldPreset } from "../../../lib/types";
import { nextDatasetId, useApp } from "../../../store/useApp";
import {
  alignToRows,
  buildChannel,
  channelLambda,
  DEFAULT_SETTINGS,
  defaultChannels,
  defaultXKind,
  effectiveWeighting,
  MAX_CHANNELS,
  type BuiltChannel,
  type ChannelBinding,
  type FitDataSettings,
  type Weighting,
} from "./reflFitData";
import {
  applyBlockedReason,
  applyResults,
  buildParamRows,
  fittedGlobals,
  parseParamName,
  resolveLayer,
  setLayerParam,
  toRequestParams,
  validateRows,
  type FitGlobals,
  type FitParamRow,
  type ParamOverrides,
  type ParamSettings,
} from "./reflFitModel";
import type { ModelLayer, Radiation } from "./useReflectivity";

/** The slice of the Model-mode state the fit reads and writes. */
export interface ReflModelHandle {
  layers: ModelLayer[];
  presets: SldPreset[];
  radiation: Radiation;
  replaceLayers: (layers: ModelLayer[]) => void;
}

export interface ReflFitState {
  datasets: Dataset[];
  channels: ChannelBinding[];
  settings: FitDataSettings;
  weighting: Weighting; // effective (dr needs a dR column on every channel)
  /** λ used for 2θ → Q on channel 0 (override or metadata), null if unknown. */
  lambda: number | null;
  params: FitParamRow[];
  busy: boolean;
  error: string | null;
  result: ReflFitResult | null;
  /** Why "Apply to model" is unavailable (the stack or radiation changed
   *  since the fit), or null. */
  applyBlocked: string | null;
  curvesAdded: boolean;
  selectDataset: (id: string) => void;
  setChannel: (index: number, patch: Partial<ChannelBinding>) => void;
  addChannel: () => void;
  removeChannel: (index: number) => void;
  setSettings: (patch: Partial<FitDataSettings>) => void;
  setParam: (name: string, patch: Partial<ParamSettings> & { value?: number }) => void;
  run: () => Promise<void>;
  cancel: () => void;
  addCurves: () => string[];
  openLogPlot: () => void;
  applyToModel: () => void;
}

function initialChannels(ds: Dataset | undefined): ChannelBinding[] {
  return ds ? defaultChannels(ds) : [];
}

let _fitCounter = 0;

export function useReflFit(model: ReflModelHandle): ReflFitState {
  const { layers, presets, radiation, replaceLayers } = model;
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const resolveDataset = useApp((s) => s.resolveDataset);
  const setFitOverlay = useApp((s) => s.setFitOverlay);
  const addDataset = useApp((s) => s.addDataset);
  const createWindow = useApp((s) => s.createWindow);
  const setStatus = useApp((s) => s.setStatus);

  const [channels, setChannels] = useState<ChannelBinding[]>(() =>
    initialChannels(datasets.find((d) => d.id === activeId)),
  );
  const [settings, setSettingsState] = useState<FitDataSettings>(() => {
    const ds = datasets.find((d) => d.id === activeId);
    return ds ? { ...DEFAULT_SETTINGS, xKind: defaultXKind(ds.data) } : DEFAULT_SETTINGS;
  });
  const [overrides, setOverrides] = useState<ParamOverrides>({ layerCount: layers.length, byName: {} });
  const [globals, setGlobals] = useState<FitGlobals>({ scale: 1, background: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReflFitResult | null>(null);
  // The stack + radiation the result's positional names refer to.
  const [basis, setBasis] = useState<{ layers: ModelLayer[]; radiation: Radiation } | null>(null);
  const [curveIds, setCurveIds] = useState<string[]>([]);
  const fitOverlay = useApp((s) => s.fitOverlay);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const selectSeqRef = useRef(0);
  // The overlay object this hook last set, so clearing never removes an
  // overlay another workshop has drawn since.
  const ownOverlayRef = useRef<FitOverlay | null>(null);

  // Closing the workshop mid-fit abandons the request rather than leaving it
  // to land in an unmounted hook.
  useEffect(() => () => abortRef.current?.abort(), []);

  const weighting = effectiveWeighting(settings.weighting, channels);
  const withMsld = channels.some((c) => c.spin !== "none");
  const params = useMemo(
    () => buildParamRows(layers.map((l) => resolveLayer(l, presets, radiation)), overrides, globals, withMsld),
    [layers, presets, radiation, overrides, globals, withMsld],
  );
  const firstData = datasets.find((d) => d.id === channels[0]?.datasetId)?.data;
  const lambda = channelLambda(settings, firstData);

  const applyBlocked = result && basis ? applyBlockedReason(basis, layers, radiation) : null;

  function clearResult(): void {
    setResult(null);
    setBasis(null);
    setCurveIds([]);
    setError(null);
    // A stale fitted curve must not outlive its result on the plot.
    if (ownOverlayRef.current && fitOverlay === ownOverlayRef.current) setFitOverlay(null);
    ownOverlayRef.current = null;
  }

  /** Abandon an in-flight fit: its data binding is about to change, so a
   *  late response must not land as the result of the new choice. */
  function invalidateRun(): void {
    if (!abortRef.current) return;
    abortRef.current.abort();
    abortRef.current = null;
    runIdRef.current++;
    setBusy(false);
  }

  function prefill(ds: Dataset): void {
    const next = defaultChannels(ds);
    setChannels(next.length ? next : [{ datasetId: ds.id, rCol: 0, drCol: null, dqCol: null, dqIsFwhm: false, spin: "none" }]);
    setSettingsState((s) => ({ ...s, xKind: defaultXKind(ds.data), weighting: "dr" }));
  }

  function selectDataset(id: string): void {
    const ds = datasets.find((d) => d.id === id);
    if (!ds) return;
    const seq = ++selectSeqRef.current;
    invalidateRun();
    prefill(ds);
    clearResult();
    // A lazy (not yet fetched) dataset has no columns to suggest from yet:
    // fetch it, then prefill again unless the user has picked another since.
    if (ds.pending) {
      void resolveDataset(id)
        .then((full) => {
          if (full && seq === selectSeqRef.current) prefill(full);
        })
        .catch(() => {
          /* run() resolves again and reports a failure there */
        });
    }
  }

  function setChannel(index: number, patch: Partial<ChannelBinding>): void {
    invalidateRun();
    setChannels((cs) =>
      cs.map((c, i) => {
        if (i !== index) return c;
        if (patch.datasetId && patch.datasetId !== c.datasetId) {
          // A new dataset for this channel: take its suggested columns for THIS
          // channel's spin (a PNR file suggests one channel per spin state), and
          // keep the spin.
          const ds = datasets.find((d) => d.id === patch.datasetId);
          const sugs = ds ? defaultChannels(ds) : [];
          const sug = sugs.find((s) => s.spin === c.spin) ?? sugs[0];
          return sug ? { ...sug, spin: c.spin } : { ...c, datasetId: patch.datasetId, rCol: 0, drCol: null, dqCol: null };
        }
        return { ...c, ...patch };
      }),
    );
  }

  function addChannel(): void {
    invalidateRun();
    setChannels((cs) => {
      if (cs.length === 0 || cs.length >= MAX_CHANNELS) return cs;
      const last = cs[cs.length - 1];
      // A second curve is almost always the other spin state of a PNR pair.
      const lastSpin = last.spin === "none" ? "+" : last.spin;
      const head = cs.map((c, i) => (i === cs.length - 1 ? { ...c, spin: lastSpin } : c));
      return [...head, { ...last, spin: lastSpin === "+" ? "-" : "+" }];
    });
  }

  function removeChannel(index: number): void {
    invalidateRun();
    setChannels((cs) => (cs.length <= 1 ? cs : cs.filter((_, i) => i !== index)));
  }

  function setSettings(patch: Partial<FitDataSettings>): void {
    invalidateRun();
    setSettingsState((s) => ({ ...s, ...patch }));
  }

  function setParam(name: string, patch: Partial<ParamSettings> & { value?: number }): void {
    const { value, ...rest } = patch;
    if (value !== undefined && Number.isFinite(value)) {
      if (name === "scale" || name === "background") setGlobals((g) => ({ ...g, [name]: value }));
      else if (parseParamName(name)) replaceLayers(setLayerParam(layers, presets, radiation, name, value));
    }
    if (Object.keys(rest).length === 0) return;
    setOverrides((o) => {
      const byName = o.layerCount === layers.length ? o.byName : {};
      return { layerCount: layers.length, byName: { ...byName, [name]: { ...byName[name], ...rest } } };
    });
  }

  async function run(): Promise<void> {
    if (busy) return;
    if (channels.length === 0) {
      setError("choose a dataset to fit");
      return;
    }
    const problem = validateRows(params);
    if (problem) {
      setError(problem);
      return;
    }
    const id = ++runIdRef.current;
    const fitBasis = { layers, radiation };
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    clearResult();
    try {
      const built: BuiltChannel[] = [];
      const sizes: number[] = [];
      for (const [i, b] of channels.entries()) {
        const ds = await resolveDataset(b.datasetId);
        if (!ds) throw new Error(`channel ${i + 1}: its dataset is no longer in the library`);
        const label = `${ds.name} · ${ds.data.labels[b.rCol] ?? "R"}${b.spin === "none" ? "" : ` (${b.spin})`}`;
        const lam = settings.xKind === "twotheta" ? channelLambda(settings, ds.data) : null;
        built.push(buildChannel(ds.data, droppedRows(ds), b, settings, weighting, lam, label));
        sizes.push(ds.data.time.length);
      }
      if (controller.signal.aborted) return;
      const res = await reflFit(
        { parameters: toRequestParams(params), channels: built.map((b) => b.channel), weighting },
        controller.signal,
      );
      if (id !== runIdRef.current) return;
      setResult(res);
      setBasis(fitBasis);
      const first = res.curves[0];
      if (first) {
        const sent = { q: built[0].channel.q, rows: built[0].rows };
        const overlay: FitOverlay = { datasetId: channels[0].datasetId, y: alignToRows(first, sent, sizes[0]) };
        ownOverlayRef.current = overlay;
        setFitOverlay(overlay);
      }
      setStatus(`reflectivity fit — ${res.success ? "converged" : "did not converge"} after ${res.n_evaluations} evaluations`);
    } catch (e) {
      if (id !== runIdRef.current) return;
      if (controller.signal.aborted) setStatus("reflectivity fit cancelled");
      else setError(e instanceof Error ? e.message : "reflectivity fit failed");
    } finally {
      if (id === runIdRef.current) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }

  function cancel(): void {
    abortRef.current?.abort();
  }

  function addCurves(): string[] {
    if (!result) return [];
    if (curveIds.length) return curveIds;
    const n = ++_fitCounter;
    const meta = { source: "reflectivity-fit", weighting: result.weighting, radiation };
    const ids: string[] = [];
    const add = (name: string, data: DataStruct): void => {
      const id = nextDatasetId();
      addDataset({ id, name, data });
      ids.push(id);
    };
    for (const c of result.curves) {
      add(`Refl fit ${n} · ${c.label}`, {
        time: c.q,
        values: c.q.map((_, k) => [c.r[k], c.model[k] ?? Number.NaN]),
        labels: ["R", "R fit"],
        units: ["", ""],
        metadata: { ...meta, spin: c.spin },
      });
    }
    for (const p of result.sld_profiles) {
      add(`Refl fit ${n} · SLD${p.spin ? ` (${p.spin})` : ""}`, {
        time: p.z,
        values: p.sld.map((v) => [v ?? Number.NaN]),
        labels: ["SLD"],
        units: ["Å⁻²"],
        metadata: { ...meta, spin: p.spin },
      });
    }
    setCurveIds(ids);
    setStatus(`added ${ids.length} reflectivity-fit datasets`);
    return ids;
  }

  function openLogPlot(): void {
    const ids = addCurves();
    if (!ids.length) return;
    createWindow(ids[0], { ...defaultPlotView(), yScale: "log" }, "Reflectivity fit");
  }

  function applyToModel(): void {
    if (!result || !basis) return;
    const blocked = applyBlockedReason(basis, layers, radiation);
    if (blocked) {
      setError(`cannot apply: ${blocked}`);
      return;
    }
    const next = applyResults(layers, presets, radiation, result.parameters);
    replaceLayers(next);
    // Applying turns moved-SLD rows manual; the result still describes this
    // (same-order) stack, so re-applying stays allowed.
    setBasis({ layers: next, radiation });
    setGlobals((g) => fittedGlobals(result.parameters, g));
    setStatus("applied the fitted values to the layer model");
  }

  return {
    datasets,
    channels,
    settings,
    weighting,
    lambda,
    params,
    busy,
    error,
    result,
    applyBlocked,
    curvesAdded: curveIds.length > 0,
    selectDataset,
    setChannel,
    addChannel,
    removeChannel,
    setSettings,
    setParam,
    run,
    cancel,
    addCurves,
    openLogPlot,
    applyToModel,
  };
}
