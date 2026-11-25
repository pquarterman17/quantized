// The lazy-only half of api.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the demo-sample fetch. Only lazy modules and tests call it.
// The code moved here verbatim and api.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import { getJSON } from "./api/http";
import type { DataStruct } from "./types";

/** The bundled first-run demo dataset (a synthetic VSM-like hysteresis loop,
 *  `GET /api/samples/demo`) — the real packaged sample, parsed server-side
 *  through the ordinary `import_auto` path, as opposed to the purely
 *  client-side `makeDemoDataset()` fallback used when offline. */
export function fetchDemoSample(): Promise<DataStruct> {
  return getJSON<DataStruct>("/api/samples/demo");
}
