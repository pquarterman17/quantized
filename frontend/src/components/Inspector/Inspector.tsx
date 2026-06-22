// Right panel: stacked Cards. Metadata + Corrections + Axes + Appearance are
// wired; Corrections posts to /api/corrections/apply via the store.

import CorrectionsCard from "./CorrectionsCard";
import StatsCard from "./StatsCard";
import { Card, MetaRow, Select } from "../primitives";
import {
  type Accent,
  type Density,
  type Theme,
  useActiveDataset,
  useApp,
} from "../../store/useApp";

const THEMES: Theme[] = ["dark", "light"];
const ACCENTS: Accent[] = ["violet", "teal", "ocean", "amber", "rose"];
const DENSITIES: Density[] = ["compact", "regular", "comfy"];
const opts = (xs: string[]) => xs.map((v) => ({ value: v, label: v }));

export default function Inspector() {
  const active = useActiveDataset();
  const yLog = useApp((s) => s.yLog);
  const setYLog = useApp((s) => s.setYLog);
  const xLog = useApp((s) => s.xLog);
  const setXLog = useApp((s) => s.setXLog);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const accent = useApp((s) => s.accent);
  const setAccent = useApp((s) => s.setAccent);
  const density = useApp((s) => s.density);
  const setDensity = useApp((s) => s.setDensity);

  return (
    <aside className="qzk-inspector">
      <Card title="Scan metadata">
        {active ? (
          <>
            <MetaRow label="Name" value={active.name} title={active.name} />
            <MetaRow label="Points" value={active.data.time.length} />
            <MetaRow label="Channels" value={active.data.labels.length} />
            <MetaRow label="Units" value={active.data.units.join(", ") || "—"} />
          </>
        ) : (
          <MetaRow label="—" value="no dataset" />
        )}
      </Card>

      <CorrectionsCard key={active?.id ?? "none"} active={active} />

      <StatsCard active={active} />

      <Card title="Axes">
        <label className="qz-check">
          <input
            type="checkbox"
            checked={xLog}
            onChange={(e) => setXLog(e.target.checked)}
          />
          Log X axis
        </label>
        <label className="qz-check">
          <input
            type="checkbox"
            checked={yLog}
            onChange={(e) => setYLog(e.target.checked)}
          />
          Log Y axis
        </label>
      </Card>

      <Card title="Appearance">
        <label className="qzk-field-lbl">Theme</label>
        <Select
          options={opts(THEMES)}
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
        />
        <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
          Accent
        </label>
        <Select
          options={opts(ACCENTS)}
          value={accent}
          onChange={(e) => setAccent(e.target.value as Accent)}
        />
        <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
          Density
        </label>
        <Select
          options={opts(DENSITIES)}
          value={density}
          onChange={(e) => setDensity(e.target.value as Density)}
        />
      </Card>
    </aside>
  );
}
