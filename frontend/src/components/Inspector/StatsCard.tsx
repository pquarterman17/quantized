// Inspector card: descriptive statistics of the active dataset's first channel,
// fetched from /api/stats/descriptive whenever the active dataset (or its
// corrected data) changes. Read-only — belongs inline, not in a floating window.

import { useEffect, useState } from "react";

import { statsDescriptive } from "../../lib/api";
import { fmtNum } from "../../lib/format";
import type { CalcResult, Dataset } from "../../lib/types";
import { Card, MetaRow } from "../primitives";

const ROWS: [string, string][] = [
  ["Mean", "mean"],
  ["Std", "std"],
  ["Min", "min"],
  ["Max", "max"],
  ["Median", "median"],
  ["N", "N"],
];

export default function StatsCard({ active }: { active: Dataset | null }) {
  const [stats, setStats] = useState<CalcResult | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setError(false);
    if (!active) return;
    const y = active.data.values.map((row) => row[0]);
    statsDescriptive(y)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const channel = active?.data.labels[0] ?? "—";

  return (
    <Card title="Statistics">
      {!active && <MetaRow label="—" value="no dataset" />}
      {active && error && <MetaRow label="—" value="unavailable offline" />}
      {active && !error && (
        <>
          <MetaRow label="Channel" value={channel} title={channel} />
          {ROWS.map(([label, key]) => (
            <MetaRow key={key} label={label} value={stats ? fmtNum(stats[key]) : "…"} />
          ))}
        </>
      )}
    </Card>
  );
}
