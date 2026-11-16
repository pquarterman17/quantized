// The worksheet column menu's "Modeling type" pick: a thin store-level wrapper
// so the menu component never reaches into the store itself
// (architecture.test's getState()-in-render ratchet).

import type { ModelingType } from "../lib/types";
import { useApp } from "./useApp";

/** Override a set of columns' modeling type (`null` clears back to
 *  auto-inferred) as ONE undo step, like the header selection it came from. */
export function setColumnsModelingType(datasetId: string, cols: readonly number[], t: ModelingType | null): void {
  if (cols.length === 1) return useApp.getState().setChannelType(datasetId, cols[0], t);
  const s = useApp.getState();
  if (!s.datasets.some((d) => d.id === datasetId)) return;
  s.recordHistory("channel type");
  useApp.setState((st) => ({
    datasets: st.datasets.map((d) => {
      if (d.id !== datasetId) return d;
      const next = { ...(d.channelTypes ?? {}) };
      for (const c of cols) {
        if (t == null) delete next[c];
        else next[c] = t;
      }
      return { ...d, channelTypes: Object.keys(next).length ? next : undefined };
    }),
  }));
  const lit = t == null ? "null" : JSON.stringify(t);
  useApp.getState().recordMacro(
    `Channels ${cols.join(", ")} type → ${t ?? "auto"}`,
    cols.map((c) => `qz.setChannelType(${c}, ${lit})`).join("; "),
  );
}
