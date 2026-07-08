// Loads the bundled first-run sample dataset (`GET /api/samples/demo`, a
// synthetic VSM-like hysteresis loop parsed server-side through the ordinary
// import_auto path — see routes/samples.py) with an offline fallback to the
// purely client-side synthetic demo (`lib/demo.ts`). Kept as one small
// testable function so the App.tsx command-palette wiring that calls it
// stays thin (gap #41 follow-up: surface the bundled sample in the UI).

import { fetchDemoSample } from "./api";
import { makeDemoDataset } from "./demo";
import type { DataStruct } from "./types";

export interface SampleLoadResult {
  data: DataStruct;
  name: string;
  /** true when the real backend sample could not be fetched and the
   *  client-side synthetic demo was used instead. */
  offline: boolean;
}

/** Fetch the packaged sample dataset; on any failure (offline, no backend,
 *  missing/broken install) fall back to the synthetic client-side demo so
 *  the affordance still does something useful. */
export async function loadSampleDataset(): Promise<SampleLoadResult> {
  try {
    const data = await fetchDemoSample();
    return { data, name: "demo_vsm.csv", offline: false };
  } catch {
    return { data: makeDemoDataset(), name: "demo-offline.dat", offline: true };
  }
}
