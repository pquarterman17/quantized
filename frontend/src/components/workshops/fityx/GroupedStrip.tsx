// Fit Y by X — oneway leg's grouped-points display: one horizontal strip per
// level, dots positioned by value (pctPosition, the same helper Distribution's
// BoxStrip uses) with a small deterministic jitter so overlapping values are
// visible. Deliberately modest (DOM, not canvas) — a quick "does this group
// separate?" look, not a publication plot (that's Graph Builder's job).

import { pctPosition } from "../../../lib/distribution";
import type { OnewayGroup } from "./useFitYByX";

/** Deterministic pseudo-jitter in [0, 1) from an index — stable across
 *  renders/tests, unlike Math.random(). */
function jitter(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export default function GroupedStrip({ groups }: { groups: OnewayGroup[] }) {
  const all = groups.flatMap((g) => g.values).filter(Number.isFinite);
  if (all.length === 0) return null;
  const lo = Math.min(...all);
  const hi = Math.max(...all);

  return (
    <div aria-label="grouped points" style={{ marginTop: 8 }}>
      {groups.map((g, gi) => (
        <div
          key={g.label}
          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: gi === 0 ? 0 : 4 }}
        >
          <span
            style={{
              width: 72,
              flexShrink: 0,
              fontSize: 11,
              color: "var(--text-faint)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={g.label}
          >
            {g.label}
          </span>
          <div style={{ position: "relative", height: 14, flex: 1, background: "var(--surface-3)" }}>
            {g.values.map((v, i) => (
              <span
                key={i}
                title={String(v)}
                style={{
                  position: "absolute",
                  left: `${pctPosition(v, lo, hi)}%`,
                  top: 2 + jitter(gi * 1000 + i) * 10,
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  transform: "translateX(-2px)",
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
