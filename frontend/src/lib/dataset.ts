// Small pure helpers over DataStruct/Dataset. Kept out of the store so they can
// be unit-tested without a store instance.

import type { DataStruct } from "./types";

/** Deep-copy a DataStruct so the copy shares no mutable arrays with the source
 *  (duplicating a dataset must not alias the original's columns). */
export function cloneDataStruct(d: DataStruct): DataStruct {
  return {
    time: [...d.time],
    values: d.values.map((row) => [...row]),
    labels: [...d.labels],
    units: [...d.units],
    metadata: { ...d.metadata },
  };
}
