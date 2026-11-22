// Test kit (lane WB4): make a dataset a PENDING lazy book whose resolve swaps in
// a fresh `.data` object and clears its row state, as the store's real
// `resolveDataset` does. The run key moves when that happens (it carries the
// data identity), so a tool must resolve first and only then launch its run.
// (Reads the store through `setState` updaters only: no `getState()` call.)
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

const realResolve = useApp.getInitialState().resolveDataset;

/** Restore the real `resolveDataset` (call from beforeEach). */
export const restoreResolve = (): void => useApp.setState({ resolveDataset: realResolve });

/** Replace `ds` in the store with a pending copy; `resolveDataset(ds.id)` then installs `ds` with new `.data`. */
export function makePending(ds: Dataset): void {
  const pending = { ...ds, data: { ...ds.data }, pending: { kind: "test" } as never };
  useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === ds.id ? pending : d)) }));
  useApp.setState({
    resolveDataset: async (id: string) => {
      let out: Dataset | undefined;
      useApp.setState((s) => {
        const live = s.datasets.find((d) => d.id === id);
        if (!live?.pending) { // the real one is a no-op once resolved
          out = live;
          return {};
        }
        out = { ...ds, data: { ...ds.data }, pending: undefined };
        return { datasets: s.datasets.map((d) => (d.id === id ? out! : d)) };
      });
      return out;
    },
  });
}
