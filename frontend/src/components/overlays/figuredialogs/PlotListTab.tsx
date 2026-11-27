// The plot list (plan item 43): every plot window with its dataset, the
// columns it draws and the worksheet rows it draws, so a book's several plots
// can be told apart and compared at a glance. Row numbers are worksheet rows
// (1-based), as the plot's own row-window chip shows them.

import { effectiveChannels } from "../../../lib/plotdata";
import { displayedWindowTitle } from "../../../lib/plotWindows";
import { plotRowRangeState } from "../../../lib/plotRowRangeState";
import { plotWindowView } from "../../../store/windowDocuments";
import { useApp } from "../../../store/useApp";

export default function PlotListTab({ onShow }: { onShow: () => void }) {
  const windows = useApp((s) => s.plotWindows);
  const datasets = useApp((s) => s.datasets);
  const focused = useApp((s) => s.focusedWindowId);
  const liveX = useApp((s) => s.xKey);
  const liveY = useApp((s) => s.yKeys);
  const liveOrder = useApp((s) => s.seriesOrder);
  const liveRows = useApp((s) => s.rowRange);
  const focusWindow = useApp((s) => s.focusWindow);
  const plots = windows.filter((w) => w.kind === "plot");
  if (plots.length === 0) return <p className="qzk-helptext">No plots are open.</p>;
  return (
    <table className="qzk-plotlist" style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ textAlign: "left" }}><th>Plot</th><th>X</th><th>Y</th><th>Rows</th><th /></tr>
      </thead>
      <tbody>
        {plots.map((w) => {
          const ds = datasets.find((d) => d.id === w.datasetId);
          const stored = plotWindowView(w);
          const view = w.id === focused ? { xKey: liveX, yKeys: liveY, seriesOrder: liveOrder, rowRange: liveRows } : stored;
          const name = (c: number) => ds?.data.labels[c] ?? `column ${c + 1}`;
          const ys = ds ? effectiveChannels(ds.data, view.yKeys, view.xKey, ds.channelRoles, view.seriesOrder).map(name) : [];
          const rows = ds ? plotRowRangeState(view.rowRange, ds.data.time.length).label || "every row" : "";
          const title = displayedWindowTitle(w, datasets);
          return (
            <tr key={w.id}>
              <td>{title}{w.id === focused && <span className="qzk-ds-meta"> (focused)</span>}</td>
              <td>{ds ? (view.xKey === null ? "own X" : name(view.xKey)) : ""}</td>
              <td>{ds ? ys.join(", ") : "source missing"}</td>
              <td>{rows}</td>
              <td>
                <button type="button" className="qz-btn" aria-label={`Show ${title}`} onClick={() => { focusWindow(w.id); onShow(); }}>Show</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
