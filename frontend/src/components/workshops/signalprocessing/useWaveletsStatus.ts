// The wavelet methods need the optional PyWavelets extra. While a wavelet
// method is picked, ask the server once whether it is installed; `null` =
// unknown (still loading or the probe failed: the run itself reports it).

import { useEffect, useState } from "react";

import { waveletsStatus, type WaveletsStatus } from "../../../lib/api/wavelets";

export function useWaveletsStatus(needed: boolean): WaveletsStatus | null {
  const [status, setStatus] = useState<WaveletsStatus | null>(null);
  useEffect(() => {
    if (!needed || status) return;
    let live = true;
    waveletsStatus().then((s) => { if (live) setStatus(s); }, () => undefined);
    return () => { live = false; };
  }, [needed, status]);
  return status;
}
