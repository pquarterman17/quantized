// Test helper: what routes/_datasetrows.gather_xy reads for a by-handle fit
// body -- the rows of its [start, count] runs in the X and Y channel (-1 =
// time). Compared as JSON with the x/y the array path posts, it pins that a
// by-handle request names exactly the doubles the array request carried
// (JSON writes -0 as 0, as the server's gather does).
import type { DataStruct } from "../lib/types";

export function gatherRows(
  data: DataStruct,
  body: { x_channel: number; y_channel: number; rows: [number, number][] },
): { x: unknown[]; y: unknown[] } {
  const col = (c: number, r: number): unknown => (c === -1 ? data.time[r] : data.values[r]![c]);
  const x: unknown[] = [];
  const y: unknown[] = [];
  for (const [start, count] of body.rows) {
    for (let r = start; r < start + count; r++) {
      x.push(col(body.x_channel, r));
      y.push(col(body.y_channel, r));
    }
  }
  return { x, y };
}
