// Column switcher (ORIGIN_GAP_PLAN #54) — JMP-style: flip the plot through
// one Y channel at a time (◀ ▶ / dropdown) without touching the channel
// checkboxes. "Solo" = every other plotted channel is hidden via the same
// hiddenChannels state the interactive legend uses; ✕/Show-all restores.
// Pure UI — the engine is the store's soloChannel action (tested there).

import { effectiveChannels } from "../../../lib/plotdata";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";

export default function ColumnSwitcher() {
  const setOpen = useApp((s) => s.setColumnSwitcherOpen);
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const yKeys = useApp((s) => s.yKeys);
  const xKey = useApp((s) => s.xKey);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const seriesLabels = useApp((s) => s.seriesLabels);
  const hiddenChannels = useApp((s) => s.hiddenChannels);
  const solo = useApp((s) => s.soloChannel);

  const active = datasets.find((d) => d.id === activeId) ?? null;
  const plotted = active
    ? effectiveChannels(active.data, yKeys, xKey, active.channelRoles, seriesOrder)
    : [];
  const visible = plotted.filter((c) => !hiddenChannels.includes(c));
  // "Current" only when exactly one channel is soloed; otherwise mixed/all.
  const current = visible.length === 1 && plotted.length > 1 ? visible[0] : null;

  const name = (c: number) => seriesLabels[c] ?? active?.data.labels[c] ?? `ch ${c}`;

  const step = (dir: 1 | -1) => {
    if (plotted.length < 2) return;
    const at = current == null ? (dir === 1 ? -1 : 0) : plotted.indexOf(current);
    solo(plotted[(at + dir + plotted.length) % plotted.length]);
  };

  return (
    <ToolWindow title="Column switcher" width={280} onClose={() => setOpen(false)}>
      {!active || plotted.length < 2 ? (
        <div style={{ color: "var(--text-faint)" }}>
          Needs a dataset with at least two plotted channels.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Button onClick={() => step(-1)} title="Previous channel (wraps)">
              ◀
            </Button>
            <Select
              style={{ flex: 1 }}
              value={current == null ? "" : String(current)}
              onChange={(e) => solo(e.target.value === "" ? null : Number(e.target.value))}
              title="Solo one channel — every other series is hidden until you step on or show all"
              options={[
                { value: "", label: `All (${plotted.length})` },
                ...plotted.map((c) => ({ value: String(c), label: name(c) })),
              ]}
            />
            <Button onClick={() => step(1)} title="Next channel (wraps)">
              ▶
            </Button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <span style={{ color: "var(--text-dim)" }}>
              {current == null ? "showing all channels" : `solo: ${name(current)}`}
            </span>
            <Button onClick={() => solo(null)} disabled={current == null}>
              Show all
            </Button>
          </div>
        </>
      )}
    </ToolWindow>
  );
}
