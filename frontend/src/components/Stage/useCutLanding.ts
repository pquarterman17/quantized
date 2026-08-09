// Shared "land a backend cut result as a library dataset" helper
// (RSM_CUTS_PLAN item 8): extracted out of useMapCuts.ts's private
// land()/busy pair so ONE landing implementation serves the map cut tool
// (H/V/segment/projection, this file's original owner), the ROI cuts
// workshop (box/sector, workshops/roicuts/useRoiCuts.ts), and item 6's
// canvas commit path once it lands — three copies of the addDataset +
// setStatus + error-handling contract would drift against each other.
// Pure orchestration only: request shaping stays where it already lives
// (lib/mapcuts.ts for line/segment cuts, lib/roi.ts for box/ruler/sector) —
// this hook only knows how to land an already-built DataStruct promise.

import { useState } from "react";

import { cutName } from "../../lib/mapcuts";
import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";

let _seq = 0;

export interface CutLandingState {
  busy: boolean;
  /** Await `promise`, add the resulting DataStruct to the library (name
   *  prefixed with `namePrefix` when given — item 9's batch tool needs
   *  "<dataset>: " ahead of each cut's own label so N results stay
   *  distinguishable in the library list), and report status via
   *  `setStatus`. A no-op while a PREVIOUS `land()` on this same hook
   *  instance is still in flight (mirrors useMapCuts' original single-
   *  flight guard — one cut in the air per mounted tool at a time); a
   *  sequential caller (item 9's batch loop) awaits each call in turn, so
   *  `busy` has already cleared before the next one starts. */
  land: (promise: Promise<DataStruct>, namePrefix?: string) => Promise<void>;
}

export function useCutLanding(): CutLandingState {
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const [busy, setBusy] = useState(false);

  async function land(promise: Promise<DataStruct>, namePrefix?: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const data = await promise;
      const name = namePrefix ? `${namePrefix}${cutName(data)}` : cutName(data);
      addDataset({ id: `cut-${++_seq}`, name, data });
      setStatus(`cut added: ${name}`);
    } catch (e) {
      setStatus(e instanceof Error ? `cut failed: ${e.message}` : "cut failed");
    } finally {
      setBusy(false);
    }
  }

  return { busy, land };
}
