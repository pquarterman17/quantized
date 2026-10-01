// MapStage's regridded payload, fetched on a dataset / channel / gridding
// change. Moved out of MapStage.tsx (its line ceiling) when it gained `fresh`.
//
// AbortController (item 16) cancels a SUPERSEDED request outright instead of
// only discarding its result, so the 2θ/ω ⇄ Q toggle stops racing itself; an
// abort never triggers the offline fallback/status (see fetchMap's doc).
//
// The previous payload stays painted while the next one loads, so `payload`
// can belong to OTHER inputs for a moment. `fresh` says whether it was
// fetched for the current ones: an export must not send the previous
// dataset's grid under the current dataset's name and view.

import { useEffect, useState } from "react";

import { fetchMap, type MapPayload } from "../../lib/mapdataFetch";
import type { Dataset } from "../../lib/types";

interface Loaded {
  payload: MapPayload | null;
  active: Dataset | null;
  keys: readonly [number, number, number] | null;
  method: string;
  res: number;
}

export function useMapPayload(
  active: Dataset | null,
  enoughChannels: boolean,
  keys: readonly [number, number, number],
  method: string,
  res: number,
  setStatus: (status: string) => void,
): { payload: MapPayload | null; fresh: boolean } {
  const [loaded, setLoaded] = useState<Loaded>({ payload: null, active: null, keys: null, method: "", res: 0 });
  useEffect(() => {
    let cancelled = false;
    if (!active || !enoughChannels) {
      setLoaded({ payload: null, active, keys, method, res });
      return;
    }
    const controller = new AbortController();
    fetchMap(active.data, keys[0], keys[1], keys[2], { method, nx: res, ny: res }, controller.signal)
      .then((p) => {
        if (cancelled) return;
        setLoaded({ payload: p, active, keys, method, res });
        if (p.fallback) setStatus(`backend unavailable — offline grid, ${p.fallback.nx}×${p.fallback.ny}`);
      })
      .catch(() => {}); // aborted (superseded) -- nothing to show
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [active, enoughChannels, keys, method, res, setStatus]);
  const fresh = loaded.active === active && loaded.keys === keys && loaded.method === method && loaded.res === res;
  return { payload: loaded.payload, fresh };
}
