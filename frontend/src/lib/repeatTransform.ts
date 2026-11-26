// Which transforms `runTransform` registers for "Repeat last action": the
// single-input ones with no reference to another dataset, so the same settings
// can run on whatever is selected now. Joins, merges, algebra, splits and the
// like need a second input or change shape, and a signal recipe that reads a
// secondary source is excluded by the same rule (refsOf). Replays (a running
// pipeline) never register: they are not something the user just did.

import type { AppState } from "../store/useApp";
import type { RepeatEntry } from "./lastAction";
import { refsOf } from "./transformStepText";
import type { TransformParams } from "./transformRun";

const REPEATABLE_OPS: ReadonlySet<string> = new Set(["signal", "resample", "sigop", "clean"]);

type Runner = (
  s: () => AppState,
  p: TransformParams,
  primaryId: string,
  review?: undefined,
  signal?: undefined,
  options?: undefined,
  skipDuplicate?: boolean,
) => Promise<unknown>;

/** The repeat entry for transform `p`, or null when it cannot be repeated. */
export function repeatableTransform(
  s: () => AppState,
  p: TransformParams,
  title: string,
  run: Runner,
): RepeatEntry | null {
  if (!REPEATABLE_OPS.has(p.op) || refsOf(p).length > 0 || s().pipelineRunning) return null;
  return {
    label: title,
    run: async () => {
      const st = s();
      const ids = st.selectedIds.length ? st.selectedIds : st.activeId ? [st.activeId] : [];
      if (ids.length === 0) throw new Error("select a dataset first");
      // skipDuplicate: repeating on the same data with the same settings must not make a twin.
      for (const id of ids) await run(s, p, id, undefined, undefined, undefined, true);
    },
  };
}
