// AICc model quick-scan (GOTO #6) — state hook for ModelScanSection. Owns the
// one-shot scan call: posts the plotted X / primary-Y over the active dataset's
// ANALYSIS rows (#50/#53, via the shared selectedFitData bridge — the same
// channels + rows every Curve Fit path uses) to /api/fitting/scan, letting the
// backend pick the default registry candidate set (param count < n/3) and
// adding every saved custom equation model (lib/fitmodels) as an extra
// candidate. The hook lives in CurveFitPanel (not the section view) so ranked
// results survive the registry-mode <-> custom-mode flip a row-click apply can
// trigger.

import { useState } from "react";

import { scanFitModels, type ScanEntry } from "../../../lib/api";
import { loadCustomModels } from "../../../lib/fitmodels";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { selectedFitData } from "./fitSelection";

export interface ModelScanState {
  hasDataset: boolean;
  /** Ranked entries (successes ascending by AICc, failures last), or null
   *  before the first scan / after clear. */
  results: ScanEntry[] | null;
  busy: boolean;
  error: string | null;
  scan: () => Promise<void>;
  clear: () => void;
}

export function useModelScan(): ModelScanState {
  const active = useActiveDataset();
  const [results, setResults] = useState<ScanEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function scan(): Promise<void> {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      // Resolve a still-pending dataset first (#38), then scan the plotted
      // X/primary-Y over the analysis view (#50/#53) — the same channels + rows
      // the plot shows and every Curve Fit path uses. Read the selection after
      // the await in case the plotted channels changed while a lazy Origin book
      // resolved.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const state = useApp.getState();
      const d = selectedFitData(ds, state.xKey, state.yKeys, state.seriesOrder);
      if (!d) return;
      const equations = loadCustomModels().map((m) => ({
        name: m.name,
        equation: m.equation,
        guesses: m.guesses,
      }));
      const r = await scanFitModels({
        x: d.x,
        y: d.y,
        ...(equations.length > 0 ? { equations } : {}),
      });
      setResults(r.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "scan failed");
    } finally {
      setBusy(false);
    }
  }

  function clear(): void {
    setResults(null);
    setError(null);
  }

  return { hasDataset: active != null, results, busy, error, scan, clear };
}
