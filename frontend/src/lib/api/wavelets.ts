// `/api/transform/wavelets/status`: whether the optional PyWavelets extra is
// installed. Its own module (not lib/api/sigop.ts) so only the lazy Signal
// Processing wavelet methods import it. Cached for the page's life: installing
// the extra restarts the server, which reloads the page.

import { getJSON } from "./http";
import type { components } from "./schema";

export type WaveletsStatus = components["schemas"]["WaveletsStatus"];

let cached: Promise<WaveletsStatus> | null = null;

export function waveletsStatus(): Promise<WaveletsStatus> {
  cached ??= getJSON<WaveletsStatus>("/api/transform/wavelets/status").catch((e: unknown) => {
    cached = null; // a failed probe is retried, never remembered
    throw e;
  });
  return cached;
}

/** Test seam: forget the cached answer. */
export function resetWaveletsStatus(): void {
  cached = null;
}
